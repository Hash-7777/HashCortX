// ============================================================
// finance/connected.js — a Finance report from a connected system
//
// A report can be made from a connected system's records — its invoices,
// bills or payments — instead of from files. When a request names a
// connected system this model may read, the app reads that system first,
// with its reading tools only (js/mcp/records.js), and adds what came back
// as an attachment, shown with the request the way a file is, beside any
// file sent with it. Only a system the request names is read: a question
// about invoices in general reads nothing. The report is then made as from
// any file: the model lists the figures and the app does every sum
// (js/finance/figures.js).
//
// A request that names a connected system this model may not read is told
// so, rather than answered without the records: a report made without them
// could only invent them.
//
// Finance sends the whole conversation with each request, so records a
// system keeps from cloud models stay in it: a conversation holding them is
// not sent to such a model (heldFrom).
//
// Pure apart from what it is handed. Published as window.HCFinanceConnected.
// Checked by scripts/checks/finance-connected.mjs.
// ============================================================
(function () {
  "use strict";

  const R = () => window.HCMcpRecords;
  const MAX_TEXT = 60000;
  const squash = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  /** The connected systems a request names, by name. */
  const named = (text, systems) => (systems || []).filter((c) => c && c.name && squash(text).includes(squash(c.name)));

  /** The system a request names, among those this model may read; the longest name wins. */
  function wanted(text, readable) {
    const byName = named(text, readable).sort((a, b) => squash(b.name).length - squash(a.name).length);
    return byName[0] || null;
  }

  /** A cell as CSV writes it: quoted when it holds a comma, a quote or a line break. */
  function cell(v) {
    const c = R().cellOf(v);
    const t = c == null ? "" : typeof c === "object" ? JSON.stringify(c) : String(c);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  /** Records as CSV: one column for every field any of the first fifty has. */
  function csvOf(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const columns = [...new Set(list.slice(0, 50).flatMap((r) => Object.keys(r || {})))];
    if (!columns.length) return "";
    return [columns.map(cell).join(","), ...list.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  }

  /** What each read sent, as the text of one attachment: records as CSV, words as they came. */
  function attachmentOf(system, reads) {
    const P = window.HCMcpPolicy;
    let count = 0;
    const sections = (reads || []).map((r, i) => {
      const rows = R().rowsOf(r.raw);
      count += rows.length;
      const asked = Object.entries(r.args || {}).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      const title = `${R().toolWords(r.tool) || `read ${i + 1}`}${asked ? ` (${asked})` : ""}`;
      const body = rows.length ? csvOf(rows) : (P ? P.textOf(r.raw) : "");
      return `--- ${system.name} · ${title} · ${rows.length} record${rows.length === 1 ? "" : "s"} ---\n${body}`;
    });
    const text = sections.join("\n\n").slice(0, MAX_TEXT);
    return {
      name: `${system.name} records`,
      kind: "records",
      size: text.length,
      pages: 0,
      extracted: true,
      chars: text.length,
      images: [],
      text,
      from: system.id,
      records: count,
    };
  }

  const heldText = (names) => `This conversation holds records read from ${names.join(" and ")}, which are kept to models on this computer, so it was not sent. Pick a model on this computer, start a new conversation, or allow cloud models for that system in Settings → Connections.`;

  /** The systems attachments in this conversation came from that keep their records from `modelValue`. */
  function heldFrom(attachments, modelValue) {
    const M = window.HCMcp, P = window.HCMcpPolicy;
    const held = new Set();
    for (const a of attachments || []) {
      if (!a || !a.from) continue;
      const conn = M && M.find(a.from);
      if (!P || !P.mayReach(conn, modelValue)) held.add(conn ? conn.name : "a connected system");
    }
    return [...held];
  }

  /** What reading needs: the app's connections, the decide step, and a model turn held to a schema. */
  const depsFor = (modelValue, onEvent) => ({
    mcp: window.HCMcp, decide: window.HCDecide, shape: window.HCAgentShape, modelValue, onEvent,
    ask: (messages, schema) => window._H.runModelTurn({ modelValue, messages, tools: [], json: schema, temperature: 0, need: 1024 }).then((r) => (r && r.content) || ""),
  });

  /**
   * Before a Finance request is sent: what to say instead of sending it, or
   * the attachment read from the connected system it names, if any.
   */
  async function prepare({ text, files, history, modelValue }, { onEvent, deps } = {}) {
    const attachments = [...(history || []).flatMap((m) => (m && m.attachments) || []), ...(files || [])];
    const held = heldFrom(attachments, modelValue);
    if (held.length) return { refusal: heldText(held) };
    const M = window.HCMcp;
    if (!M || !M.available() || !String(text || "").trim()) return {};
    const readable = R().readable(modelValue);
    const system = wanted(text, readable);
    if (!system) {
      // Named, but kept from this model: say so rather than report without it.
      const kept = named(text, M.list()).find((c) => !readable.some((r) => r.id === c.id));
      if (!kept) return {};
      const P = window.HCMcpPolicy;
      return { refusal: P && !P.mayReach(kept, modelValue)
        ? `${kept.name} keeps its records to models on this computer, so they were not read. Pick a model on this computer, or allow cloud models for ${kept.name} in Settings → Connections.`
        : R().noTools(kept) };
    }
    const messages = [
      { role: "system", content: `You find the records a finance report needs in ${system.name}, a company's own system: its invoices, bills, payments, expenses or sales. Read the records the request needs with its tools: choose the tool and the arguments that return them. Do not filter unless the request asks for only some.` },
      { role: "user", content: String(text).slice(0, 2000) },
    ];
    const got = await R().read(system, messages, deps || depsFor(modelValue, onEvent), { keepRaw: true, answer: async () => "", words: text });
    if (!got.tools) return { refusal: R().noTools(system) };
    if (!got.named || !got.named.length) return { refusal: `${system.name} sent nothing back to make a report from, so none was made.` };
    return { attachment: attachmentOf(system, got.named), system };
  }

  window.HCFinanceConnected = { wanted, csvOf, attachmentOf, heldFrom, heldText, prepare };
})();
