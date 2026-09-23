// ============================================================
// mcp/records.js — reading a connected system's records
//
// What any mode that reads a connected system shares: which system a request
// means, which systems a model may read, reading with only a system's reading
// tools — the model chooses the tool and its arguments, the app reads, asking
// first — and the records that came back, as plain objects.
//
// A filter the person never asked for is dropped before the system is read
// (saidOnly), and the same read made twice is read once. The request is about
// records, so the first step must read some (js/chat/decide.js needsTool).
//
// Used by the ERP (js/systems/connected.js) and Finance
// (js/finance/connected.js). Pure apart from what it is handed. Published as
// window.HCMcpRecords. Checked by scripts/checks/systems-connected.mjs.
// ============================================================
(function () {
  "use strict";

  const MAX_ROWS = 500;

  /** A name as it is compared: lower case, letters and digits only, no plural s. */
  function norm(s) {
    let t = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
    else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    return t;
  }

  /** Which connected system a request means: the one it names, or the only one there is. */
  function pick(text, systems) {
    const list = Array.isArray(systems) ? systems : [];
    const said = norm(text);
    const named = list.filter((s) => s && s.name && said.includes(norm(s.name)))
      .sort((a, b) => norm(b.name).length - norm(a.name).length);
    if (named.length) return named[0];
    return list.length === 1 ? list[0] : null;
  }

  /** A value as a record cell: a pair such as [7, "Delta Foods"] is its name. */
  function cellOf(v) {
    if (Array.isArray(v) && v.length === 2 && typeof v[1] === "string") return v[1];
    if (v === false) return "";
    return v;
  }

  const isRecord = (v) => v && typeof v === "object" && !Array.isArray(v);

  /** Records from a JSON value: a list of them, or the first list of them inside an object. */
  function fromValue(v) {
    if (Array.isArray(v)) return v.filter(isRecord);
    if (isRecord(v)) {
      for (const key of ["records", "items", "results", "data", "rows", "result"]) {
        if (Array.isArray(v[key])) return v[key].filter(isRecord);
      }
      const list = Object.values(v).find((x) => Array.isArray(x) && x.some(isRecord));
      if (list) return list.filter(isRecord);
      return [v];
    }
    return [];
  }

  /** The records a tool handed back, as plain objects; none when it handed back words. */
  function rowsOf(result) {
    const r = result || {};
    let rows = r.structuredContent !== undefined ? fromValue(r.structuredContent) : [];
    if (!rows.length) {
      const text = (Array.isArray(r.content) ? r.content : []).filter((c) => c && c.type === "text").map((c) => String(c.text || "")).join("\n");
      let whole = null;
      try { whole = JSON.parse(text); } catch { whole = null; }
      if (whole !== null) rows = fromValue(whole);
      if (!rows.length) {
        for (const line of text.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try { const v = JSON.parse(t); if (isRecord(v)) rows.push(v); } catch { /* not a record */ }
        }
      }
      if (!rows.length) {
        const s = text.indexOf("["), e = text.lastIndexOf("]");
        if (s >= 0 && e > s) { try { rows = fromValue(JSON.parse(text.slice(s, e + 1))); } catch { rows = []; } }
      }
    }
    return rows.slice(0, MAX_ROWS);
  }


  /** Every text and number inside a value, for matching against the person's words. */
  const leaves = (v) => (v && typeof v === "object" ? Object.values(v).flatMap(leaves) : [v]).filter((x) => typeof x === "string" || typeof x === "number");

  /**
   * A call's arguments as the person asked for them: a filter they never said
   * is not used. The tool's required arguments always stand; the others stand
   * only when one of their values is in the person's words, and the system's
   * own name does not count. Asked to bring every customer, a small model adds
   * a filter on a name it made up, and reads nothing.
   */
  function saidOnly(args, params, words, systemName) {
    const required = new Set((params && params.required) || []);
    const optional = Object.keys(args || {}).filter((k) => !required.has(k));
    if (!optional.length) return args || {};
    const said = norm(words), own = norm(systemName);
    const inWords = (v) => { const t = norm(v); return t.length >= 2 && t !== own && said.includes(t); };
    if (optional.some((k) => leaves(args[k]).some(inWords))) return args;
    return Object.fromEntries(Object.entries(args).filter(([k]) => required.has(k)));
  }


  /** The connected systems an agent may read with this model: some reading tool switched on, and its records allowed to reach the model. */
  function readable(modelValue) {
    const M = window.HCMcp, P = window.HCMcpPolicy;
    if (!M || !M.available() || !P) return [];
    return M.list().filter((c) => P.mayReach(c, modelValue) && (c.tools || []).some((t) => t.on && t.reads && t.approved === t.definition))
      .map((c) => ({ id: c.id, name: c.name }));
  }


  /**
   * Read with a system's reading tools: the model decides, the app reads, the
   * model answers. `deps`: { mcp, decide, shape, ask(messages, schema), answer(messages), modelValue, onEvent }.
   * With `words`, the person's own, a filter they never said is dropped
   * (saidOnly), and the same read made twice is read once.
   */
  async function read(system, messages, deps, { keepRaw = false, answer, words = null } = {}) {
    const tools = await deps.mcp.toolsFor(deps.modelValue, { readsOnly: true, only: system.id });
    if (!tools.length) return { tools: 0, text: "", raws: [] };
    const paramsOf = new Map(tools.map((t) => [t.function.name, t.function.parameters]));
    const raws = [];
    const named = [];   // each read that answered: the tool, what it was asked, what it sent
    const already = new Map();
    const out = await deps.decide.run({
      // The request is about this system's records, so the first step reads some.
      messages, tools, shape: deps.shape, route: null, maxSteps: 3, needsTool: true,
      ask: deps.ask,
      answer: answer || deps.answer,
      onEvent: deps.onEvent,
      runTool: async (call) => {
        const args = words == null ? call.arguments : saidOnly(call.arguments, paramsOf.get(call.name), words, system.name);
        const key = `${call.name} ${JSON.stringify(args)}`;
        if (words != null && already.has(key)) return already.get(key);
        const got = await deps.mcp.run(call.name, args, { raw: keepRaw });
        if (keepRaw && got && got.raw) { raws.push(got.raw); named.push({ tool: call.name, args, raw: got.raw }); }
        const { raw, ...said } = got || {};
        const text = JSON.stringify(said);
        already.set(key, text);
        return text;
      },
    });
    return { tools: tools.length, text: out.text, calls: out.calls, raws, named };
  }

  /** A tool's name as the person reads it: "sys_…_search_records" is "search records". */
  const toolWords = (name) => String(name || "").replace(/^sys_[a-z0-9]+_/, "").replace(/_/g, " ");

  const noTools = (system) => `No reading tool of ${system.name} is switched on for this model. Switch one on in Settings → Connections.`;

  window.HCMcpRecords = { MAX_ROWS, norm, pick, cellOf, rowsOf, leaves, saidOnly, readable, read, toolWords, noTools };
})();
