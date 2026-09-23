// ============================================================
// mcp/connections.js — connected systems: kept, checked, offered, asked about
//
// A connected system is a company's own system — an ERP, say — that offers its
// records to agents over the Model Context Protocol. This file keeps the
// person's list of them, reads which tools each has, offers the ones the
// person switched on to an agent, and runs a call only after asking.
//
// What is kept where:
//   Here, in this page's storage: each system's name, address, how it signs
//   in, whether its records may go to cloud models, and the tools the person
//   switched on — with the exact definition each was switched on as.
//   In the app itself, never in this page: the sign-in secret. It is handed to
//   the native side once, when it is entered, and the page can only learn
//   that one is set (src-tauri/src/commands/mcp.rs).
//
// Before a call:
//   Its tool must still be described exactly as when it was switched on; the
//   list is read again at most a minute before it is offered.
//   Reading asks once for each system, and the answer lasts until the app
//   closes. A change asks every time and shows everything it will send
//   (src/platform/tauri/guard.js).
//   Records go to a model on this computer only, unless the person allowed
//   cloud models for that system (js/mcp/policy.js). That holds afterwards
//   too: a chat that read records is not sent on to a cloud model, and a turn
//   that read records does not save to memory, which every model reads.
//
// Everything a system says — tool names, descriptions, what it hands back —
// is put on screen as text, never as markup.
//
// Published as window.HCMcp. Checked by scripts/checks/mcp-connections.mjs.
// ============================================================
(function () {
  "use strict";

  const KEY = "hc_connected_systems_v1";
  const RECHECK_MS = 60 * 1000;
  const P = () => window.HCMcpPolicy;
  const HC = () => window.HC || {};

  const available = () => !!(HC().isTauri && HC().invoke);

  let client = null;
  const clientOf = () => client || (client = window.HCMcpClient.create({
    request: (id, body, version) => HC().invoke("mcp_request", { id, body, version }),
    clientInfo: { name: "HashCortx", version: String(HC().version || "0") },
  }));

  // ── The list ───────────────────────────────────────────────────────────

  function list() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      return Array.isArray(v && v.list) ? v.list : [];
    } catch { return []; }
  }
  function keep(all) {
    try { localStorage.setItem(KEY, JSON.stringify({ list: all })); } catch { /* storage full: the list stays as it was */ }
  }
  const find = (id) => list().find((c) => c.id === id) || null;
  function update(id, change) {
    const all = list();
    const at = all.findIndex((c) => c.id === id);
    if (at < 0) return null;
    all[at] = change({ ...all[at] });
    keep(all);
    return all[at];
  }

  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ""); } };
  /** How a system is named to the person: its name and where it is. */
  const labelOf = (conn) => `${conn.name} (${hostOf(conn.url)})`;
  const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /**
   * Save a system. The secret, when one is given, goes to the native side and
   * is not kept here; left empty, the one already saved stays — unless the
   * address or sign-in changed, when the native side drops it.
   */
  async function save({ id, name, url, auth = "none", header = "", allowCloud = false }, secret) {
    if (!available()) throw new Error("connected systems work in the desktop app.");
    const conn = { ...(find(id) || { tools: [] }), id: id || newId(), name: String(name || "").trim().slice(0, 40) || hostOf(url), auth, header: auth === "header" ? String(header || "").trim() : "", allowCloud: !!allowCloud };
    const info = await HC().invoke("mcp_server_save", { id: conn.id, url: String(url || "").trim(), auth, header: conn.header, secret: secret ? String(secret) : null });
    conn.url = info.url;
    conn.hasSecret = !!info.hasSecret;
    clientOf().forget(conn.id);
    const all = list().filter((c) => c.id !== conn.id);
    all.push(conn);
    keep(all);
    return conn;
  }

  async function remove(id) {
    if (available()) await HC().invoke("mcp_server_remove", { id });
    clientOf().forget(id);
    keep(list().filter((c) => c.id !== id));
  }

  /**
   * A fresh list of tools, set against what the person switched on. A tool
   * new to the list starts on if it only reads and off if it changes records.
   * A tool described differently from how it was switched on is off again.
   */
  function merge(before, listed) {
    return listed.map((raw) => {
      const definition = P().definitionOf(raw);
      const reads = P().onlyReads(raw);
      const prev = (before || []).find((t) => t.name === raw.name);
      if (!prev) return { name: raw.name, raw, definition, reads, on: reads, approved: reads ? definition : null, changed: false };
      if (prev.approved && prev.approved !== definition) return { name: raw.name, raw, definition, reads, on: false, approved: null, changed: true };
      return { ...prev, raw, definition, reads };
    });
  }

  async function refresh(id) {
    try {
      const listed = await clientOf().listTools(id);
      return update(id, (c) => ({ ...c, tools: merge(c.tools, listed), checkedAt: Date.now(), error: "" }));
    } catch (e) {
      update(id, (c) => ({ ...c, error: String((e && e.message) || e), checkedAt: Date.now() }));
      throw e;
    }
  }

  /** Switch a tool on or off. On means: as it is described now. */
  function setTool(id, name, on) {
    return update(id, (c) => ({
      ...c,
      tools: (c.tools || []).map((t) => (t.name === name ? { ...t, on: !!on, approved: on ? t.definition : null, changed: false } : t)),
    }));
  }

  const setAllowCloud = (id, allow) => update(id, (c) => ({ ...c, allowCloud: !!allow }));

  // ── Offering tools to an agent, and running one ─────────────────────────

  let offered = new Map();   // name the model calls → { id, tool }
  let readThisTurn = false;  // whether this turn has read a system's records

  /** The tools an agent may call on this model, for this turn. */
  async function toolsFor(modelValue) {
    offered = new Map();
    readThisTurn = false;
    if (!available()) return [];
    const out = [];
    for (const first of list()) {
      if (!P().mayReach(first, modelValue) || !(first.tools || []).some((t) => t.on)) continue;
      let conn = first;
      if (Date.now() - (conn.checkedAt || 0) > RECHECK_MS) {
        try { conn = await refresh(conn.id); } catch { continue; }
      }
      for (const t of conn.tools || []) {
        if (!t.on || t.approved !== t.definition) continue;
        const offer = P().offerOf(conn, t.raw);
        if (!offer || offered.has(offer.function.name)) continue;
        offered.set(offer.function.name, { id: conn.id, tool: t.name });
        out.push(offer);
      }
    }
    return out;
  }

  /** Whether this turn offers any connected system's tools. */
  const offering = () => offered.size > 0;

  // Words that name records in a business system. A request using them, with
  // a system's tools on offer, is the model's to decide, not the app's plain
  // routing — "search the invoices" is not a web search.
  const RECORD_WORDS = /\b(?:records?|invoices?|bills?|customers?|clients?|suppliers?|vendors?|orders?|quotes?|quotations?|stock|inventory|products?|contacts?|leads?|opportunit(?:y|ies)|payments?|employees?|accounts?|ledgers?|journals?|deals?|tickets?)\b/i;
  function speaksOf(text) {
    if (!offering()) return false;
    const t = String(text || "");
    if (RECORD_WORDS.test(t)) return true;
    const lower = t.toLowerCase();
    return list().some((c) => c.name && lower.includes(c.name.toLowerCase()));
  }

  /** Run a call the model made, after asking. The result as text framed as material, or an error. */
  async function run(name, args) {
    const at = offered.get(name);
    const conn = at && find(at.id);
    const t = conn && (conn.tools || []).find((x) => x.name === at.tool);
    if (!t || !t.on || t.approved !== t.definition) return { error: "That tool is switched off in Settings → Connections." };
    const guard = HC().guard;
    if (!guard) return { error: "Connected systems work in the desktop app." };
    const allowed = t.reads
      ? await guard.request("erp-read", labelOf(conn), `Read records with ${t.name}. Allowed once, reading lasts until the app closes.`)
      : await guard.request("erp-change", `${labelOf(conn)} · ${t.name}`, P().previewOf(args));
    if (!allowed) return { error: "The person did not allow this." };
    try {
      const result = await clientOf().callTool(conn.id, t.name, args);
      readThisTurn = true;
      const text = P().textOf(result);
      const S = window.HCSources;
      return { system: conn.name, tool: t.name, result: S ? S.frame([{ title: `${conn.name} · ${t.name}`, text }]) : text };
    } catch (e) {
      return { error: `${conn.name}: ${String((e && e.message) || e)}` };
    }
  }

  /**
   * A called tool, shaped like one of the agent's own (app.js AGENT_TOOLS):
   * it keeps its own time, because asking the person is part of it.
   */
  function toolOf(name) {
    const at = offered.get(name);
    if (!at) return null;
    const conn = find(at.id);
    return {
      ownLimit: true,
      statusLabel: () => `Asking ${conn ? conn.name : "a connected system"}: ${at.tool}`,
      execute: (args) => run(name, args),
    };
  }

  // ── Settings → Connections ────────────────────────────────────────

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };

  function render() {
    const host = document.getElementById("connList");
    if (!host) return;
    const note = document.getElementById("connNote");
    if (note) note.textContent = available() ? "" : "Connected systems work in the desktop app.";
    host.replaceChildren();
    const all = list();
    if (!all.length) host.appendChild(el("div", "field-note", "No systems connected."));
    for (const conn of all) host.appendChild(card(conn));
  }

  function card(conn) {
    const box = el("div", "conn-card");
    const head = el("div", "conn-head");
    const title = el("div", "conn-title");
    title.appendChild(el("span", "conn-name", conn.name));
    title.appendChild(el("span", "conn-host", hostOf(conn.url)));
    head.appendChild(title);
    const actions = el("div", "conn-actions");
    const refreshBtn = el("button", "ghost set-btn", "Check tools");
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      try { await refresh(conn.id); } catch { /* the card shows the error */ }
      render();
    });
    const removeBtn = el("button", "ghost set-btn set-btn-danger", "Remove");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", async () => { await remove(conn.id); render(); });
    actions.append(refreshBtn, removeBtn);
    head.appendChild(actions);
    box.appendChild(head);

    const status = conn.error
      ? `Could not reach it: ${conn.error}`
      : conn.checkedAt ? `${(conn.tools || []).length} tool${(conn.tools || []).length === 1 ? "" : "s"} · checked ${new Date(conn.checkedAt).toLocaleTimeString()}` : "Not checked yet.";
    box.appendChild(el("div", `field-note conn-status${conn.error ? " conn-error" : ""}`, `${status}${conn.auth !== "none" && !conn.hasSecret ? " · no secret saved" : ""}`));

    const cloud = el("label", "conn-cloud");
    const cloudBox = document.createElement("input");
    cloudBox.type = "checkbox";
    cloudBox.checked = !!conn.allowCloud;
    cloudBox.addEventListener("change", () => { setAllowCloud(conn.id, cloudBox.checked); render(); });
    cloud.append(cloudBox, el("span", "", "Let cloud models see this system's records"));
    box.appendChild(cloud);
    if (conn.allowCloud) box.appendChild(el("div", "field-note conn-warn", "Records read with a cloud model are sent to that model's company."));

    const tools = el("div", "conn-tools");
    for (const t of conn.tools || []) tools.appendChild(toolRow(conn, t));
    box.appendChild(tools);
    return box;
  }

  function toolRow(conn, t) {
    const row = el("label", "conn-tool");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!t.on;
    box.addEventListener("change", () => { setTool(conn.id, t.name, box.checked); render(); });
    const text = el("span", "conn-tool-text");
    const line = el("span", "conn-tool-line");
    line.appendChild(el("span", "conn-tool-name", t.name));
    line.appendChild(el("span", `conn-tag ${t.reads ? "reads" : "changes"}`, t.reads ? "Reads" : "Changes records"));
    text.appendChild(line);
    const said = P().clean((t.raw && (t.raw.description || t.raw.title)) || "", 240);
    if (said) text.appendChild(el("span", "conn-tool-desc", said));
    if (t.changed) text.appendChild(el("span", "conn-tool-desc conn-warn", "The system describes this tool differently since you switched it on. Check it before switching it on again."));
    row.append(box, text);
    return row;
  }

  /** The add form: its fields, what signing in needs, and saving. */
  function wire() {
    const auth = document.getElementById("connAuth");
    const headerRow = document.getElementById("connHeaderRow");
    const secretRow = document.getElementById("connSecretRow");
    const sync = () => {
      if (headerRow) headerRow.hidden = auth.value !== "header";
      if (secretRow) secretRow.hidden = auth.value === "none";
    };
    auth?.addEventListener("change", sync);
    if (auth) sync();
    document.getElementById("connAdd")?.addEventListener("click", async () => {
      const msg = document.getElementById("connNote");
      const secretEl = document.getElementById("connSecret");
      try {
        const conn = await save({
          name: document.getElementById("connName")?.value,
          url: document.getElementById("connUrl")?.value,
          auth: auth?.value || "none",
          header: document.getElementById("connHeader")?.value,
        }, secretEl?.value || "");
        if (secretEl) secretEl.value = "";
        if (msg) msg.textContent = `Saved ${conn.name}. Reading its tools…`;
        try { await refresh(conn.id); if (msg) msg.textContent = ""; } catch { /* the card shows why */ }
      } catch (e) {
        if (msg) msg.textContent = `Not saved: ${String((e && e.message) || e)}`;
      }
      render();
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }

  // Memory is added to every later chat, cloud models' included, so a turn
  // that has read a system's records does not save to it: a record the model
  // chose to remember would reach models the system's records are kept from.
  const MEMORY_WRITES = new Set(["remember_fact"]);

  /**
   * The tool the agent's runner uses for a name: a connected system's, the
   * agent's own `own`, or — for a memory save in a turn that read records — a
   * refusal the model is told.
   */
  function toolFor(name, own) {
    if (offered.has(name)) return toolOf(name);
    if (own && MEMORY_WRITES.has(name) && readThisTurn) {
      return {
        statusLabel: () => "Not saving to memory",
        execute: () => ({ error: "Not saved: this turn read records from a connected system, and memory reaches every model, cloud ones included. The person can save it themselves if they want it kept." }),
      };
    }
    return own || null;
  }

  /** The connected system a tool name belongs to, or null. */
  function systemOf(name) {
    return list().find((c) => (c.tools || []).some((t) => P().exposedName(c.id, t.name) === name)) || null;
  }

  /**
   * The systems whose records this conversation holds and which keep them from
   * `modelValue`: a chat that read records keeps the answer, and going on with
   * it on a cloud model would send that answer too. A tool from a system since
   * removed counts as kept, since nothing says otherwise.
   */
  function heldFrom(messages, modelValue) {
    const held = new Set();
    for (const m of Array.isArray(messages) ? messages : []) {
      for (const used of (m && m.toolsUsed) || []) {
        if (!used || !used.ok || !/^sys_/.test(String(used.name || ""))) continue;
        const conn = systemOf(used.name);
        if (!conn) held.add("a connected system");
        else if (!P().mayReach(conn, modelValue)) held.add(conn.name);
      }
    }
    return [...held];
  }

  /** What the person is told when a chat holds records a cloud model may not see. */
  const heldText = (names) => `This chat holds records from ${names.join(" and ")}, which are kept to models on this computer, so it was not sent. Start a new chat to use a cloud model, or allow cloud models for that system in Settings → Connections.`;

  window.HCMcp = { available, list, find, save, remove, merge, refresh, setTool, setAllowCloud, toolsFor, offering, speaksOf, run, toolOf, toolFor, systemOf, heldFrom, heldText, render, labelOf, RECORD_WORDS };
})();
