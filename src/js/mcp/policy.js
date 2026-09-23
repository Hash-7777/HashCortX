// ============================================================
// mcp/policy.js — what a connected system's tool may do, and who sees it
//
// A connected system — a company's ERP, say — offers its records to an agent
// as tools. Everything about one of those tools comes from the system: its
// name, what it says it does, the shape of what it takes, and the notes it
// attaches saying whether it only reads. None of that is taken on trust.
//
//   A tool READS only when nothing about it says otherwise: a name made of
//   reading words and nothing that changes things, or the system's own note
//   that it only reads and a name that does not contradict it. Anything else
//   CHANGES records, and every call to it is asked about, each time.
//
//   A tool is pinned to the definition the person switched on. If the system
//   later describes it differently — another description, other arguments —
//   it is off again until the person looks at it and switches it back on, so
//   a tool cannot be approved as one thing and used as another.
//
//   What a tool says about itself reaches a model only as a short description,
//   with any line addressed to AI systems left out; what it hands back reaches
//   a model framed as material to read, not instructions (js/chat/sources.js).
//
//   A system's records are offered to models on this computer only, unless the
//   person allowed that system's records to go to cloud models.
//
// Pure. Published as window.HCMcpPolicy. Checked by scripts/checks/mcp-policy.mjs.
// ============================================================
(function () {
  "use strict";

  const CHANGE_WORDS = new Set(("create add insert new update edit modify set patch put write save store delete remove destroy drop purge " +
    "archive unarchive cancel post send submit approve reject confirm validate pay refund call execute exec run invoke import upload " +
    "move transfer merge reset clear lock unlock assign unassign close reopen publish unpublish apply mark register book order install " +
    "uninstall enable disable grant revoke invite email notify schedule trigger sync commit").split(" "));
  const READ_WORDS = new Set(("get list search find read fetch count describe show view lookup query aggregate browse check " +
    "summarize summarise explain inspect retrieve").split(" "));

  const MAX_DESCRIPTION = 500;
  const MAX_SCHEMA_CHARS = 8000;
  const MAX_RESULT_CHARS = 20000;

  /** A tool's name as words: "createRecord" and "create_record" both read "create record". */
  function wordsOf(name) {
    return String(name || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  /** Whether a tool only reads. When in doubt, it changes. */
  function onlyReads(tool) {
    const words = wordsOf(tool && tool.name);
    if (!words.length || words.some((w) => CHANGE_WORDS.has(w))) return false;
    const a = (tool && tool.annotations) || {};
    if (a.destructiveHint === true || a.readOnlyHint === false) return false;
    if (a.readOnlyHint === true) return true;
    return READ_WORDS.has(words[0]);
  }

  /** JSON with its keys in order, so the same definition always reads the same. */
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  /** Everything about a tool that the person approved. Compared whole, not by a hash. */
  function definitionOf(tool) {
    const t = tool || {};
    return stable({ name: t.name || "", title: t.title || "", description: t.description || "", inputSchema: t.inputSchema || {}, annotations: t.annotations || {} });
  }

  /** The name a model calls the tool by: the system and the tool, in the characters every provider takes. */
  function exposedName(connId, toolName) {
    const part = (s, n) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, n);
    return `sys_${part(connId, 12) || "x"}_${part(toolName, 44) || "tool"}`.slice(0, 64);
  }

  /** Text from a system, with control characters and lines addressed to AI systems left out. */
  function clean(text, max) {
    const t = String(text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    const S = typeof window !== "undefined" && window.HCSources;
    const marked = S ? S.mark(t) : t;
    return marked.length > max ? `${marked.slice(0, max)}…` : marked;
  }

  /**
   * The tool as a model is told it, or null when it cannot be offered: its
   * arguments too large to send, or not an object.
   */
  function offerOf(conn, tool) {
    const schema = tool && tool.inputSchema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
    const params = { ...schema, type: "object" };
    delete params.$schema;
    delete params.$id;
    if (!params.properties || typeof params.properties !== "object") params.properties = {};
    if (stable(params).length > MAX_SCHEMA_CHARS) return null;
    const reads = onlyReads(tool);
    const said = clean(tool.description || tool.title || "", MAX_DESCRIPTION);
    return {
      type: "function",
      function: {
        name: exposedName(conn.id, tool.name),
        description: `${conn.name}: ${said || tool.name}${reads ? "" : " (Changes records: the person approves each call.)"}`,
        parameters: params,
      },
    };
  }

  /** Whether a system's records may go to this model. */
  function mayReach(conn, modelValue) {
    const cloud = /^cloud:/.test(String(modelValue || ""));
    return !cloud || !!(conn && conn.allowCloud);
  }

  /** What a tool handed back, as text: its words, its data, and a note for anything that is not text. */
  function textOf(result) {
    const r = result || {};
    const parts = [];
    for (const item of Array.isArray(r.content) ? r.content : []) {
      if (item && item.type === "text") parts.push(String(item.text || ""));
      else if (item && item.type === "resource" && item.resource && typeof item.resource.text === "string") parts.push(item.resource.text);
      else if (item && item.type) parts.push(`[${item.type === "image" ? "an image" : `a ${item.type}`} the system returned was left out]`);
    }
    if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent, null, 2));
    let text = parts.join("\n\n").trim() || "(the system returned nothing)";
    if (r.isError) text = `The system reported an error: ${text}`;
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n… [${(text.length - MAX_RESULT_CHARS).toLocaleString("en-US")} more characters not shown]` : text;
  }

  /** What a change will send, shown whole to the person before it is sent. */
  function previewOf(args) {
    try { return JSON.stringify(args || {}, null, 2); } catch { return String(args); }
  }

  window.HCMcpPolicy = { onlyReads, wordsOf, definitionOf, stable, exposedName, clean, offerOf, mayReach, textOf, previewOf, MAX_RESULT_CHARS };
})();
