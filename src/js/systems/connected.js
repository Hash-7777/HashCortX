// ============================================================
// systems/connected.js — the ERP and a connected system
//
// A connected system (js/mcp/connections.js) is a company's own system that
// offers its records over MCP. The ERP agent can read one to answer a
// question — "look" — and can bring records from one into a table of the
// system that is open — "bring". Both only READ the connected system: the
// ERP never changes one, whatever it is asked.
//
//   Which system: the one the request names, or the only one there is.
//
//   Reading: the model chooses one of that system's reading tools and its
//   arguments, the app reads — asking the person first, once per system —
//   and the model answers from what came back (js/mcp/records.js). The
//   request is about records, so the first step must read some.
//
//   Bringing in: a filter the person never asked for is dropped before the
//   system is read (saidOnly). The records that came back are matched to a table's fields
//   by name; each value is made to fit its field the way a person's edit is
//   (js/systems/work.js fit), and one that does not fit is left out. A linked
//   field is left for the person to set, since a name is not a record. A
//   record already in the table is not added twice. Nothing is written until
//   the person has seen exactly what will be, and Undo puts it back.
//
//   Afterwards: the open system remembers which connected systems it has
//   brought records from, and is not sent to a model those systems keep their
//   records from. An answer read from one is marked in the conversation, which
//   every system shares, and left out of what is sent to such a model.
//
// Pure apart from what it is handed. Published as window.HCSystemsConnected.
// Checked by scripts/checks/systems-connected.mjs.
// ============================================================
(function () {
  "use strict";

  // Reading a connected system, shared with Finance — js/mcp/records.js.
  const { MAX_ROWS, norm, pick, cellOf, rowsOf, saidOnly, readable, read, toolWords, noTools } = window.HCMcpRecords;

  const W = () => window.HCSystemsWork;

  /**
   * The table records should go into: the one the request names — by its
   * very name before a near one ("Customers" before "Customer") — or the one
   * whose fields fit them best. A record's own number is not a fit (mappingOf).
   */
  function tableFor(spec, request, rows, derived = () => false) {
    const said = norm(request);
    const words = ` ${String(request || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const exactly = (n) => { const t = String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return !!t && words.includes(` ${t} `); };
    const keys = new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)).map(norm));
    let best = null;
    for (const entity of W().entitiesOf(spec).values()) {
      if (derived(entity.id)) continue;
      let score = 0;
      const names = [entity.id, entity.name, entity.label].filter(Boolean);
      if (names.some(exactly)) score += 20;
      else if (names.some((n) => said.includes(norm(n)))) score += 10;
      for (const f of entity.fields || []) if (f.id !== "id" && (keys.has(norm(f.id)) || keys.has(norm(f.label)))) score += 1;
      if (score > 0 && (!best || score > best.score)) best = { entity, score };
    }
    return best ? best.entity : null;
  }

  /**
   * Which field each key of the records goes into. A linked field is left for
   * the person. A field whose id is "id" is the record's own identity here
   * (js/systems/work.js apply), so the other system's record number never goes
   * into it: two systems both number from 1.
   */
  function mappingOf(entity, rows) {
    const keys = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))];
    const fields = (entity && entity.fields) || [];
    const pairs = [];
    const leftOut = [];
    const links = [];
    const own = [];
    const used = new Set();
    for (const key of keys) {
      const k = norm(key);
      const field = fields.find((f) => !used.has(f.id) && (norm(f.id) === k || norm(f.label) === k));
      if (!field) { leftOut.push(key); continue; }
      used.add(field.id);
      if (field.id === "id") { own.push(key); continue; }
      if (field.type === "link") { links.push(field.label || field.id); continue; }
      pairs.push({ key, field });
    }
    return { pairs, leftOut, links, own };
  }

  // The fields that tell one record from another, in the order they are trusted for it.
  const KEY_FIELD = /^(?:name|fullname|displayname|title|company|companyname|number|reference|ref|code|email)$/;

  /** What bringing these records in would add, and what it would leave out and why. */
  function plan({ spec, data, rows, entity }) {
    const { pairs, leftOut, links, own } = mappingOf(entity, rows);
    const existing = (data && data[entity.id]) || [];
    // A record already here is one whose name, number or the like says the
    // same — else whose first matched text field does.
    const keyField = (pairs.find((p) => KEY_FIELD.test(norm(p.field.id)) || KEY_FIELD.test(norm(p.field.label)))
      || pairs.find((p) => (p.field.type || "text") === "text") || pairs[0] || {}).field;
    const seen = new Set(keyField ? existing.map((r) => norm(r[keyField.id])).filter(Boolean) : []);
    const additions = [];
    let duplicates = 0;
    let empty = 0;
    for (const row of rows) {
      const values = {};
      for (const { key, field } of pairs) {
        const v = W().fit(field, cellOf(row[key]));
        if (v !== undefined && v !== "") values[field.id] = v;
      }
      if (!Object.keys(values).length) { empty++; continue; }
      const k = keyField ? norm(values[keyField.id]) : "";
      if (k && seen.has(k)) { duplicates++; continue; }
      if (k) seen.add(k);
      additions.push({ entity: entity.id, values });
    }
    return { entity: { id: entity.id, name: entity.name || entity.label || entity.id }, pairs: pairs.map((p) => ({ key: p.key, field: p.field.id, label: p.field.label || p.field.id })), leftOut, links, own, additions, duplicates, empty };
  }

  /** What the person reads before anything is added: every record, since that is what they are told they will see. */
  function previewOf(p, systemName) {
    const lines = [`Bring ${p.additions.length} record${p.additions.length === 1 ? "" : "s"} from ${systemName} into ${p.entity.name}.`];
    lines.push("", `Filled in: ${p.pairs.map((x) => `${x.label} (from ${x.key})`).join(", ")}.`);
    if (p.leftOut.length) lines.push(`Not brought in, with no field of that name here: ${p.leftOut.join(", ")}.`);
    if ((p.own || []).length) lines.push(`Not copied: ${p.own.join(", ")}, ${systemName}'s own record number. Each record here keeps its own.`);
    if (p.links.length) lines.push(`Left for you to set: ${p.links.join(", ")}.`);
    if (p.duplicates) lines.push(`${p.duplicates} already here, not added again.`);
    const shown = p.additions.map((a) => `- ${p.pairs.map((x) => a.values[x.field]).filter((v) => v !== undefined && v !== "").join(" · ")}`);
    if (shown.length) lines.push("", ...shown);
    lines.push("", `The records are copied here. ${systemName} is not changed. Nothing has been added yet.`);
    return lines.join("\n");
  }

  /** Why nothing would be brought in, in words. */
  function nothingToBring(p, systemName) {
    if (!p.pairs.length) return `None of what ${systemName} sent matches a field of ${p.entity.name}, so nothing was brought in.`;
    if (p.duplicates && !p.additions.length) return `Every record ${systemName} sent is already in ${p.entity.name}.`;
    return `${systemName} sent nothing that fits ${p.entity.name}.`;
  }

  // ── Keeping records where the connected system allows them ────────────────

  /** The connected systems a spec has read from, with this one added. */
  const markedWith = (spec, id) => [...new Set([...((spec && spec.connectedFrom) || []), id])];

  /**
   * The systems this spec has read from that keep their records from
   * `modelValue`. One since removed keeps them from cloud models, since
   * nothing says otherwise; a model on this computer may still see them.
   */
  function heldFrom(spec, modelValue) {
    const M = window.HCMcp, P = window.HCMcpPolicy;
    const held = new Set();
    for (const id of (spec && spec.connectedFrom) || []) {
      const conn = M && M.find(id);
      if (!P || !P.mayReach(conn, modelValue)) held.add(conn ? conn.name : "a connected system");
    }
    return [...held];
  }

  /**
   * The conversation as a model may be shown it: an answer read from a
   * connected system that keeps its records from `modelValue` is left out,
   * with the question that asked for it and the app's words while it read —
   * a question left standing unanswered invites a model to answer it.
   */
  function visibleTo(history, modelValue) {
    const M = window.HCMcp, P = window.HCMcpPolicy;
    const kept = [];
    let leftOut = 0;
    for (const turn of Array.isArray(history) ? history : []) {
      const conn = turn && turn.from ? M && M.find(turn.from) : null;
      if (turn && turn.from && (!P || !P.mayReach(conn, modelValue))) {
        leftOut++;
        const asked = kept.map((t) => t && t.role).lastIndexOf("user");
        if (asked >= 0) kept.length = asked;
        continue;
      }
      kept.push(turn);
    }
    return { history: kept, leftOut };
  }

  const heldText = (names) => `This system holds records read from ${names.join(" and ")}, which are kept to models on this computer, so it was not sent. Pick a model on this computer at the top of this panel, or allow cloud models for that system in Settings → Connections.`;

  // ── The two steps ─────────────────────────────────────────────────────────

  /** Answer a question from a connected system's records. */
  async function lookIn(system, request, deps) {
    const messages = [
      { role: "system", content: `You answer a question about ${system.name}, a company's own system, from its records. Read the records the question needs with one of its tools, then answer in one to three plain sentences from what the tool returned. Say which records you mean. Never invent a record, a figure or a name; if the tool returned nothing that answers it, say so.` },
      { role: "user", content: String(request || "").slice(0, 2000) },
    ];
    const got = await read(system, messages, deps);
    if (!got.tools) return { say: noTools(system), read: false };
    return { say: String(got.text || "").trim() || `${system.name} returned nothing I could answer from.`, read: (got.calls || []).length > 0 };
  }

  /** Work out what bringing records from a connected system into the open system would add. */
  async function bringFrom(system, request, { spec, data, derived = () => false, words = request }, deps) {
    const messages = [
      { role: "system", content: `The person wants records from ${system.name}, a company's own system, copied into their ERP. Read those records with one of its tools: choose the tool and the arguments that return them. Do not filter unless the person asked for only some.` },
      { role: "user", content: String(request || "").slice(0, 2000) },
    ];
    const got = await read(system, messages, deps, { keepRaw: true, answer: async () => "", words });
    if (!got.tools) return { say: noTools(system), read: false };
    const rows = got.raws.flatMap(rowsOf).slice(0, MAX_ROWS);
    const didRead = (got.calls || []).length > 0;
    if (!rows.length) return { say: `${system.name} did not send back records I could bring in.`, read: didRead };
    const entity = tableFor(spec, request, rows, derived);
    const tables = [...W().entitiesOf(spec).values()].filter((e) => !derived(e.id)).map((e) => e.name || e.id);
    if (!entity) return { say: `Which table should they go into? This system has ${tables.join(", ")}.`, read: didRead };
    const p = plan({ spec, data, rows, entity });
    if (!p.additions.length) return { say: nothingToBring(p, system.name), read: didRead };
    return { plan: p, preview: previewOf(p, system.name), read: didRead };
  }

  /**
   * Carry out "look" or "bring" for the ERP agent. Returns { say, from } to
   * show — `from` when the answer was read from a system — or { plan,
   * preview, system } for the person to confirm.
   */
  async function act(said, text, connected, { spec, data, derived }, deps) {
    const system = pick(`${text} ${said.request || ""}`, connected);
    if (!system) return { say: `Which system do you mean: ${connected.map((c) => c.name).join(" or ")}?` };
    if (said.do === "look") {
      const r = await lookIn(system, said.request || text, deps);
      return { say: r.say, from: r.read ? system.id : "", system };
    }
    return { ...(await bringFrom(system, said.request || text, { spec, data, derived, words: text }, deps)), system };
  }

  window.HCSystemsConnected = { norm, pick, saidOnly, cellOf, rowsOf, tableFor, mappingOf, plan, previewOf, nothingToBring, markedWith, heldFrom, visibleTo, heldText, readable, toolWords, lookIn, bringFrom, act, MAX_ROWS };
})();
