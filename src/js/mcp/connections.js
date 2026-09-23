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

  /**
   * The tools an agent may call on this model, for this turn. `readsOnly`
   * offers only tools that read, and `only` one system's — how the ERP reads
   * a connected system without ever being able to change it.
   */
  async function toolsFor(modelValue, { readsOnly = false, only = null } = {}) {
    offered = new Map();
    readThisTurn = false;
    if (!available()) return [];
    const out = [];
    for (const first of list()) {
      if (only && first.id !== only) continue;
      if (!P().mayReach(first, modelValue) || !(first.tools || []).some((t) => t.on)) continue;
      let conn = first;
      if (Date.now() - (conn.checkedAt || 0) > RECHECK_MS) {
        try { conn = await refresh(conn.id); } catch { continue; }
      }
      for (const t of conn.tools || []) {
        if (!t.on || t.approved !== t.definition || (readsOnly && !t.reads)) continue;
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

  /**
   * Run a call the model made, after asking. The result as text framed as
   * material, or an error; with `raw`, also the result as the system gave it,
   * for the app's own use — never for a model.
   */
  async function run(name, args, { raw = false } = {}) {
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
      return { system: conn.name, tool: t.name, result: S ? S.frame([{ title: `${conn.name} · ${t.name}`, text }]) : text, ...(raw ? { raw: result } : {}) };
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

  const Pre = () => window.HCMcpPresets;

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
    if (note && !available()) note.textContent = "Connected systems work in the desktop app.";
    host.replaceChildren();
    const all = list();
    if (!all.length) host.appendChild(el("div", "field-note", "Nothing connected yet."));
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
    const refreshBtn = el("button", "ghost set-btn", "Check again");
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      try { await refresh(conn.id); } catch { /* the card shows why */ }
      render();
    });
    const removeBtn = el("button", "ghost set-btn set-btn-danger", "Remove");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", async () => { await remove(conn.id); render(); });
    actions.append(refreshBtn, removeBtn);
    head.appendChild(actions);
    box.appendChild(head);

    const tools = conn.tools || [];
    const on = tools.filter((t) => t.on).length;
    const status = conn.error
      ? `Not reached: ${conn.error}`
      : conn.checkedAt ? `Connected · ${tools.length} tool${tools.length === 1 ? "" : "s"}, ${on} switched on · checked ${new Date(conn.checkedAt).toLocaleTimeString()}` : "Not checked yet.";
    box.appendChild(el("div", `field-note conn-status${conn.error ? " conn-error" : ""}`, `${status}${conn.auth !== "none" && !conn.hasSecret ? " · no key saved" : ""}`));

    const cloud = el("label", "conn-cloud");
    const cloudBox = document.createElement("input");
    cloudBox.type = "checkbox";
    cloudBox.checked = !!conn.allowCloud;
    cloudBox.addEventListener("change", () => { setAllowCloud(conn.id, cloudBox.checked); render(); });
    cloud.append(cloudBox, el("span", "", "Let cloud models read its records"));
    box.appendChild(cloud);
    if (conn.allowCloud) box.appendChild(el("div", "field-note conn-warn", "Records a cloud model reads are sent to the company that runs it."));

    if (tools.length) box.appendChild(el("div", "field-note conn-lead", "What agents may use. Reading starts on; changing starts off, and each change asks you first."));
    const list_ = el("div", "conn-tools");
    for (const t of tools) list_.appendChild(toolRow(conn, t));
    box.appendChild(list_);
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
    const name = el("span", "conn-tool-name", Pre() ? Pre().toolLabel(t.name) : t.name);
    name.title = t.name;   // the name the system uses, for anyone who needs it
    line.appendChild(name);
    line.appendChild(el("span", `conn-tag ${t.reads ? "reads" : "changes"}`, t.reads ? "Reads" : "Changes records"));
    text.appendChild(line);
    const said = P().clean((t.raw && (t.raw.description || t.raw.title)) || "", 240);
    if (said) text.appendChild(el("span", "conn-tool-desc", said));
    if (t.changed) text.appendChild(el("span", "conn-tool-desc conn-warn", "The system describes this tool differently since you switched it on. Read it again before switching it back on."));
    row.append(box, text);
    return row;
  }

  /**
   * Connect, all or nothing: the system is saved and its tools read, and the
   * next way of presenting the key (js/mcp/presets.js attempts) is tried only
   * when the system refused the one before. When none works, or the system
   * cannot be reached, nothing is left saved.
   */
  async function connect({ name, url, auth, header, allowCloud = false }, secret) {
    const ways = Pre().attempts(auth, header, !!secret);
    let id = null;
    let last = null;
    for (const way of ways) {
      const conn = await save({ id, name, url, auth: way.auth, header: way.header, allowCloud }, secret);
      id = conn.id;
      try { return await refresh(id); } catch (e) {
        last = e;
        if (!(e && e.kind === "auth")) break;
      }
    }
    if (id) await remove(id);
    throw last || new Error("it could not be connected.");
  }

  /** Why a connection was not made, and what to check: in words first, the technical reason last. */
  function whyNot(e, name, url) {
    const said = String((e && e.message) || e || "").trim();
    if (e && e.kind === "auth") return `${name} did not accept the key. Check the key, or how it signs in under More options.`;
    if (e && e.kind === "unreachable") {
      const detail = said.replace(/^the system could not be reached:\s*/i, "").replace(/[.\s]+$/, "");
      return `Could not reach ${hostOf(url) || "that address"}. Check the address, and that the system is running.${detail ? ` (${detail})` : ""}`;
    }
    return `Not connected: ${said.replace(/^the system /, "it ")}`;
  }

  /** The connect form: what to connect, what that needs, and connecting. */
  function wire() {
    const $ = (id) => document.getElementById(id);
    const kinds = $("connKinds");
    if (!kinds || kinds.dataset.wired || !Pre()) return;
    kinds.dataset.wired = "1";
    let kind = Pre().find("other");
    let typedName = false;   // a name the person typed is kept when they pick another kind
    $("connName")?.addEventListener("input", () => { typedName = !!$("connName").value.trim(); });

    const syncAuth = () => {
      const auth = $("connAuth")?.value || "auto";
      if ($("connHeaderRow")) $("connHeaderRow").hidden = auth !== "header";
      if ($("connSecretRow")) $("connSecretRow").hidden = auth === "none";
    };
    const readOnly = () => !!$("connReadOnly")?.checked;
    const syncFixed = () => {
      const fixed = $("connFixedUrl");
      if (!fixed) return;
      fixed.hidden = !kind.url;
      fixed.textContent = kind.url ? `Connects to ${Pre().addressOf(kind, { readOnly: readOnly() })}` : "";
    };
    const choose = (p) => {
      kind = p;
      for (const b of kinds.children) b.setAttribute("aria-checked", String(b.dataset.kind === p.id));
      if (!typedName && $("connName")) $("connName").value = p.url || p.id !== "other" ? p.name : "";
      if ($("connUrlRow")) $("connUrlRow").hidden = !!p.url;
      if (p.address && $("connUrl")) {
        $("connUrl").placeholder = p.address.placeholder;
        if ($("connUrlNote")) $("connUrlNote").textContent = `— ${p.address.note}`;
      }
      if ($("connSecretLabel")) $("connSecretLabel").textContent = p.key.label;
      if ($("connSecretNote")) $("connSecretNote").textContent = `— ${p.key.note}`;
      if ($("connReadOnlyRow")) $("connReadOnlyRow").hidden = !p.readOnlyUrl;
      if ($("connAuth")) $("connAuth").value = p.auth;
      if ($("connNote")) $("connNote").textContent = "";
      syncAuth();
      syncFixed();
    };
    for (const p of Pre().PRESETS) {
      const b = el("button", "conn-kind", p.name);
      b.type = "button";
      b.dataset.kind = p.id;
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => choose(p));
      kinds.appendChild(b);
    }
    $("connAuth")?.addEventListener("change", syncAuth);
    $("connReadOnly")?.addEventListener("change", syncFixed);
    choose(kind);

    const btn = $("connAdd");
    btn?.addEventListener("click", async () => {
      const msg = $("connNote");
      const say = (t) => { if (msg) msg.textContent = t; };
      const secretEl = $("connSecret");
      const auth = $("connAuth")?.value || "auto";
      const secret = auth === "none" ? "" : (secretEl?.value || "");
      const url = Pre().addressOf(kind, { address: $("connUrl")?.value, readOnly: readOnly() });
      const name = String($("connName")?.value || "").trim() || hostOf(url);
      if (!url) { say("Enter its web address first."); return; }
      if (kind.url && !secret) { say(`Paste your ${kind.key.label.toLowerCase()} first.`); return; }
      if (!available()) { say("Connected systems work in the desktop app."); return; }
      btn.disabled = true;
      say(`Connecting to ${name}…`);
      try {
        const conn = await connect({ name, url, auth, header: $("connHeader")?.value }, secret);
        if (secretEl) secretEl.value = "";
        const n = (conn.tools || []).length;
        say(n
          ? `Connected to ${conn.name}, with ${n} tool${n === 1 ? "" : "s"}. The ones that only read are on; the ones that change records stay off until you switch them on below.`
          : `Connected to ${conn.name}. It offers no tools yet.`);
      } catch (e) {
        say(whyNot(e, name, url));
      } finally {
        btn.disabled = false;
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
   * removed counts as kept from cloud models, since nothing says otherwise;
   * a model on this computer may still be shown what it read.
   */
  function heldFrom(messages, modelValue) {
    const held = new Set();
    for (const m of Array.isArray(messages) ? messages : []) {
      for (const used of (m && m.toolsUsed) || []) {
        if (!used || !used.ok || !/^sys_/.test(String(used.name || ""))) continue;
        const conn = systemOf(used.name);
        if (!P().mayReach(conn, modelValue)) held.add(conn ? conn.name : "a connected system");
      }
    }
    return [...held];
  }

  /** What the person is told when a chat holds records a cloud model may not see. */
  const heldText = (names) => `This chat holds records from ${names.join(" and ")}, which are kept to models on this computer, so it was not sent. Start a new chat to use a cloud model, or allow cloud models for that system in Settings → Connections.`;

  window.HCMcp = { available, list, find, save, remove, merge, refresh, connect, whyNot, setTool, setAllowCloud, toolsFor, offering, speaksOf, run, toolOf, toolFor, systemOf, heldFrom, heldText, render, labelOf, RECORD_WORDS };
})();
