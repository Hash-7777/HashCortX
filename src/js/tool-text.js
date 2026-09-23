// ============================================================
// tool-text.js — a tool call a model wrote in its words
//
// A local model is taught one way of calling a tool by the family it comes
// from, and it writes that way whether or not the server running it turns the
// call into the field meant for it. The app read three of those ways — bare
// JSON, a json code block and one pair of tags — so a model from any other
// family had its call shown to the person as the answer, and the tool never
// ran.
//
// The ways local models write a call are read here:
//
//   <tool_call>{"name": …, "arguments": …}</tool_call>, one or several
//   <|tool_call|>…<|/tool_call|>, and a list after <|tool_call|>
//   <function=name>{…}</function>, and <function=name> with one
//   <parameter=key>value</parameter> per argument, closing tags optional
//   [TOOL_CALLS] [{…}]   and   [TOOL_CALLS]name[ARGS]{…}
//   <|python_tag|>{"name": …, "parameters": …}   and   name.call(a="…")
//   functools[{…}]
//   the call tokens with a separator between the name and its arguments
//   a tool_code block holding name(a="…")
//   bare JSON or a json block, at the start or the end of the reply
//
// and the keys each spells a call with: name, tool, tool_name, action; and
// arguments, parameters, args, tool_input, action_input, input — or the
// arguments written beside the name.
//
// A call is kept only when it names a tool the caller offered. Marked calls
// count wherever they sit, because the mark says what they are. An unmarked
// block counts only at the start or end of the reply, so an answer that shows
// an example among its words is left alone.
//
// Pure. Published as window.HCToolText. Checked by scripts/checks/tool-text.mjs.
// ============================================================
(function () {
  "use strict";

  const NAME_KEYS = ["name", "tool", "tool_name", "action", "function_name"];
  const ARG_KEYS = ["arguments", "parameters", "args", "tool_input", "action_input", "input", "params"];

  function parseJson(text) {
    const t = String(text || "").trim();
    if (!t) return undefined;
    try { return JSON.parse(t); } catch { /* try the first whole value in it */ }
    const start = t.search(/[[{]/);
    if (start < 0) return undefined;
    const end = closing(t, start);
    if (end < 0) return undefined;
    try { return JSON.parse(t.slice(start, end + 1)); } catch { return undefined; }
  }

  /** Where the bracket opened at `start` closes, strings respected, or -1. */
  function closing(t, start) {
    const open = t[start];
    const shut = { "{": "}", "[": "]", "(": ")" }[open];
    let depth = 0;
    let quote = null;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === open) depth++;
      else if (c === shut && --depth === 0) return i;
    }
    return -1;
  }

  const argsOf = (raw) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = parseJson(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    return {};
  };

  /** One call in any of the shapes models write it, as { name, arguments }, or null. */
  function callOf(c) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return null;
    const fn = c.function && typeof c.function === "object" ? c.function : c;
    let name = NAME_KEYS.map((k) => fn[k]).find((v) => typeof v === "string" && v.trim());
    if (!name && typeof c.function === "string") name = c.function;
    if (!name) return null;
    const key = ARG_KEYS.find((k) => fn[k] !== undefined);
    let args;
    if (key) args = argsOf(fn[key]);
    else {
      // The arguments written beside the name.
      args = {};
      for (const [k, v] of Object.entries(fn)) if (!NAME_KEYS.includes(k) && k !== "id" && k !== "type" && k !== "function") args[k] = v;
    }
    return { name: String(name).trim(), arguments: args };
  }

  /** Every call in a parsed value: one, a list, or a list under tool_calls. */
  function callsOfValue(v) {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.flatMap(callsOfValue);
    if (typeof v === "object" && Array.isArray(v.tool_calls)) return v.tool_calls.flatMap(callsOfValue);
    const one = callOf(v);
    return one ? [one] : [];
  }

  function literal(v) {
    const t = v.trim();
    if (/^(['"])[\s\S]*\1$/.test(t)) return t.slice(1, -1).replace(/\\(['"\\])/g, "$1").replace(/\\n/g, "\n");
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
    if (/^(True|true)$/.test(t)) return true;
    if (/^(False|false)$/.test(t)) return false;
    if (/^(None|null)$/.test(t)) return null;
    const j = parseJson(t.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null"));
    return j === undefined ? t : j;
  }

  /** Keyword arguments written the way Python writes a call: a="x", n=3. */
  function kwargs(text) {
    const out = {};
    const rx = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|\{[^}]*\}|[^,)]+)/g;
    let m;
    while ((m = rx.exec(text))) out[m[1]] = literal(m[2]);
    return out;
  }

  /** Calls written as Python: name(a="x"), name.call(a="x"), print(tools.name(a="x")). */
  function pythonCalls(text, names) {
    const out = [];
    const rx = /([A-Za-z_][\w.]*)\s*\(/g;
    let m;
    while ((m = rx.exec(text))) {
      const path = m[1].split(".").filter(Boolean);
      if (path.length > 1 && path[path.length - 1] === "call") path.pop();
      const name = path[path.length - 1];
      if (!names.has(name)) continue;
      const open = m.index + m[0].length - 1;
      const end = closing(text, open);
      if (end < 0) continue;
      out.push({ name, arguments: kwargs(text.slice(open + 1, end)) });
      rx.lastIndex = end + 1;
    }
    return out;
  }

  /** Arguments written one tag each: <parameter=key>value</parameter>, the closing tag optional. */
  function parameters(body) {
    const out = {};
    for (const m of body.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|(?=<\/function>)|$)/g)) {
      const v = m[2].trim();
      const j = /^[[{]|^-?\d+(?:\.\d+)?$|^(?:true|false|null)$/.test(v) ? parseJson(v) : undefined;
      out[m[1]] = j === undefined ? v : j;
    }
    return out;
  }

  const TAGGED = [
    /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g,
    /<\|tool_call\|>\s*([\s\S]*?)\s*(?:<\|\/tool_call\|>|<\|end\|>|$)/g,
    /<function_call>\s*([\s\S]*?)\s*(?:<\/function_call>|$)/g,
    /<tool_calls?>\s*([\s\S]*?)\s*<\/tool_calls?>/g,
  ];

  /** Calls marked as calls, wherever they sit. */
  function marked(text, names) {
    for (const rx of TAGGED) {
      const found = [...text.matchAll(rx)].flatMap((m) => callsOfValue(parseJson(m[1])));
      if (found.length) return found;
    }
    const fnTags = [...text.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|(?=<function=)|$)/g)]
      .map((m) => ({ name: m[1], arguments: /<parameter=/.test(m[2]) ? parameters(m[2]) : argsOf(m[2]) }));
    if (fnTags.length) return fnTags;
    const listed = text.indexOf("[TOOL_CALLS]");
    if (listed >= 0) {
      const rest = text.slice(listed + "[TOOL_CALLS]".length).trim();
      if (/^[[{]/.test(rest)) return callsOfValue(parseJson(rest));
      const out = [];
      for (const part of rest.split("[TOOL_CALLS]")) {
        const m = /^\s*([\w.-]+)\s*\[ARGS\]\s*([\s\S]*)$/.exec(part);
        if (m) out.push({ name: m[1], arguments: argsOf(m[2]) });
      }
      if (out.length) return out;
    }
    const pyTag = text.indexOf("<|python_tag|>");
    if (pyTag >= 0) {
      const rest = text.slice(pyTag + "<|python_tag|>".length).replace(/<\|eom_id\|>|<\|eot_id\|>/g, "").trim();
      const json = rest.split(/;\s*(?=\{)/).flatMap((p) => callsOfValue(parseJson(p)));
      return json.length ? json : pythonCalls(rest, names);
    }
    const fnTools = /functools\s*(\[[\s\S]*\])/.exec(text);
    if (fnTools) return callsOfValue(parseJson(fnTools[1]));
    if (/<｜tool▁call▁begin｜>/.test(text)) {
      const out = [];
      for (const block of text.split("<｜tool▁call▁begin｜>").slice(1)) {
        const body = block.split("<｜tool▁call▁end｜>")[0];
        const pieces = body.split("<｜tool▁sep｜>").map((p) => p.trim());
        const name = pieces.map((p) => p.split(/\s|\n/)[0]).find((p) => names.has(p));
        const brace = body.indexOf("{");
        if (name) out.push({ name, arguments: brace >= 0 ? argsOf(body.slice(brace, closing(body, brace) + 1)) : {} });
      }
      if (out.length) return out;
    }
    const code = window.HCFences && window.HCFences.splitFences
      ? window.HCFences.splitFences(text).filter((p) => p.type === "code" && /^(tool_code|tool_call|tool)$/i.test(String(p.lang || "")))
      : [];
    for (const block of code) {
      const json = callsOfValue(parseJson(block.code));
      const found = json.length ? json : pythonCalls(block.code, names);
      if (found.length) return found;
    }
    return [];
  }

  /** An unmarked call: the whole reply, or a block at its start or end. */
  function unmarked(text) {
    const parts = window.HCFences && window.HCFences.splitFences
      ? window.HCFences.splitFences(text).filter((p) => p.type === "code" || String(p.text || "").trim())
      : [{ type: "text", text }];
    const edge = [parts[parts.length - 1], parts[0]].find((p) => p && p.type === "code");
    const body = (edge ? edge.code : text).trim();
    if (!/^[[{]/.test(body)) return [];
    const parsed = parseJson(body);
    // A whole value, not the first object inside some prose.
    try { JSON.parse(body); } catch { return []; }
    return callsOfValue(parsed);
  }

  /** Thinking written at the start of a reply, between think tags, is not part of it. */
  const withoutThinking = (text) => String(text || "").replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");

  /**
   * The tool calls a reply wrote in its words, to tools in `names`, as
   * [{ name, arguments }]. Empty when there are none, or when any unmarked
   * one names a tool that was not offered.
   */
  function callsIn(text, names) {
    const known = new Set(names || []);
    const t = withoutThinking(text).trim();
    if (!known.size || !t) return [];
    const tagged = marked(t, known);
    if (tagged.length) return tagged.filter((c) => known.has(c.name));
    const plain = unmarked(t);
    return plain.length && plain.every((c) => known.has(c.name)) ? plain : [];
  }

  window.HCToolText = { callsIn, callOf, parseJson, kwargs, withoutThinking };
})();
