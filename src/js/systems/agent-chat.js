// ==============================================================
// The ERP agent's conversation on screen
//
// A button in the corner of the ERP that opens a small conversation over the
// system. What the agent says is kept, so the conversation is there when the
// ERP is opened again. What the app does on the agent's word — building a
// system, changing one, changing records — is written under the agent's reply
// as it happens, one short line per step, where the run log used to be: the
// person reads what happened where they asked for it.
//
// This file draws and keeps the conversation. Deciding what to say, and what
// to do with it, is the Systems mode's (with js/systems/agent.js); it hands in
// what to call when a message is sent or a run is stopped.
//
// Not used in an exported system (js/systems/export-app.js), which has no
// models to talk to; the stylesheet hides the button there too.
//
// Loaded before the Systems mode and published as window.HCSystemsAgentChat.
// Checked by scripts/checks/systems-agent.mjs.
// ==============================================================

(function () {
  'use strict';

  const STORE_KEY = 'hc_sys_agent_chat_v1';
  const OPEN_KEY = 'hc_sys_agent_open_v1';
  const MAX_KEPT = 60;
  const STEPS_SHOWN = 4;

  const $ = (id) => document.getElementById(id);
  const store = () => { try { return localStorage; } catch { return null; } };
  const read = (k, fallback) => { try { const v = store() && store().getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const write = (k, v) => { try { store() && store().setItem(k, JSON.stringify(v)); } catch { /* kept for this session only */ } };

  const WELCOME = 'I am your ERP agent. Tell me about your business and I will build its system: what it does, its name and where it is, for example "a bookshop called Pages in Cairo". Once it is built, ask me to change it, to record what happened, or anything about its records.';

  let turns = [];
  let deps = null;
  let busy = false;
  let current = null;   // the agent turn steps are being written under

  function save() { write(STORE_KEY, turns.slice(-MAX_KEPT).map(({ el, ...t }) => t)); }

  /** One turn's element: who said it, what they said, and any steps under it. */
  function draw(turn) {
    const row = document.createElement('div');
    row.className = `sys-agent-msg ${turn.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'sys-agent-bubble';
    bubble.textContent = turn.text || '';
    row.append(bubble);
    if (turn.role === 'agent') {
      const steps = document.createElement('div');
      steps.className = 'sys-agent-steps';
      row.append(steps);
      for (const s of turn.steps || []) steps.append(stepRow(s));
      foldSteps(steps);
    }
    turn.el = row;
    return row;
  }

  function stepRow({ msg, cls }) {
    const r = document.createElement('div');
    r.className = `sys-agent-step sys-te-${cls || 'run'}`;
    const m = document.createElement('span');
    m.className = 'sys-te-msg';
    m.textContent = msg;
    r.append(m);
    return r;
  }

  /** Long step lists show their last few, with the rest a click away. */
  function foldSteps(steps) {
    const rows = [...steps.querySelectorAll('.sys-agent-step')];
    let more = steps.querySelector('.sys-agent-more');
    if (rows.length <= STEPS_SHOWN) { if (more) more.remove(); rows.forEach((r) => { r.hidden = false; }); return; }
    if (steps.classList.contains('open')) { rows.forEach((r) => { r.hidden = false; }); if (more) more.textContent = 'Show fewer steps'; return; }
    rows.forEach((r, i) => { r.hidden = i < rows.length - STEPS_SHOWN; });
    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'sys-agent-more';
      more.addEventListener('click', () => { steps.classList.toggle('open'); foldSteps(steps); });
      steps.prepend(more);
    }
    more.textContent = `Show all ${rows.length} steps`;
  }

  function scroll() { const log = $('sysAgentLog'); if (log) log.scrollTop = log.scrollHeight; }

  function render() {
    const log = $('sysAgentLog');
    if (!log) return;
    log.textContent = '';
    if (!turns.length) log.append(draw({ role: 'agent', text: WELCOME, steps: [] }));
    for (const t of turns) log.append(draw(t));
    scroll();
  }

  function add(role, text) {
    const turn = { role, text: String(text || '').trim(), at: Date.now(), steps: [] };
    turns.push(turn);
    const log = $('sysAgentLog');
    if (log) { if (turns.length === 1) log.textContent = ''; log.append(draw(turn)); }
    save();
    scroll();
    return turn;
  }

  /** The person's words. */
  const user = (text) => add('user', text);

  /** The agent's words; the steps that follow are written under them. */
  function agent(text) { current = add('agent', text); return current; }

  /**
   * The agent's words for the turn under way: written into the reply its steps
   * already began (a model that was busy, say), or as a new reply.
   */
  function reply(text) {
    if (current && !current.text) {
      current.text = String(text || '').trim();
      const bubble = current.el && current.el.querySelector('.sys-agent-bubble');
      if (bubble) bubble.textContent = current.text;
      save();
      scroll();
      return current;
    }
    return agent(text);
  }

  /** A step of what the app is doing, under the agent's latest words. Returns the row, for a live line. */
  function step(msg, cls = 'run') {
    if (!current) current = add('agent', '');
    const s = { msg: String(msg || '').slice(0, 400), cls };
    current.steps.push(s);
    const steps = current.el && current.el.querySelector('.sys-agent-steps');
    let row = null;
    if (steps) { row = stepRow(s); steps.append(row); foldSteps(steps); }
    save();
    scroll();
    return row;
  }

  /** Close the current turn: the next steps belong to the next reply. */
  function settle() { current = null; }

  function setBusy(on) {
    busy = !!on;
    const send = $('sysAgentSend');
    const stop = $('sysAgentStop');
    if (send) send.hidden = busy;
    if (stop) stop.hidden = !busy;
    $('sysAgentFab')?.classList.toggle('busy', busy);
    $('sysAgent')?.classList.toggle('busy', busy);
  }

  function setStatus(text, cls = '') {
    const el = $('sysRunStatus');
    if (!el) return;
    el.textContent = text || 'Ready';
    el.className = `sys-agent-status ${cls}`.trim();
  }

  function isOpen() { return !!$('sysAgent') && !$('sysAgent').hidden; }

  function open(on = true) {
    const panel = $('sysAgent');
    const fab = $('sysAgentFab');
    if (!panel) return;
    panel.hidden = !on;
    fab?.setAttribute('aria-expanded', String(!!on));
    fab?.classList.toggle('open', !!on);
    write(OPEN_KEY, !!on);
    if (on) { scroll(); setTimeout(() => $('sysAgentInput')?.focus(), 30); }
  }

  function clear() {
    turns = [];
    current = null;
    save();
    render();
  }

  function submit() {
    const box = $('sysAgentInput');
    const text = (box?.value || '').trim();
    if (!text || busy || !deps) return;
    box.value = '';
    deps.send(text);
  }

  /** Wire the panel once; `d` is { send(text), stop() }. */
  function init(d) {
    deps = d;
    if (!$('sysAgent') || $('sysAgent').dataset.wired) return;
    $('sysAgent').dataset.wired = '1';
    turns = (read(STORE_KEY, []) || []).filter((t) => t && (t.role === 'user' || t.role === 'agent'))
      .map((t) => ({ role: t.role, text: String(t.text || ''), at: t.at || 0, steps: Array.isArray(t.steps) ? t.steps : [] }));
    render();
    $('sysAgentFab')?.addEventListener('click', () => open(!isOpen()));
    $('sysAgentClose')?.addEventListener('click', () => open(false));
    $('sysAgentClear')?.addEventListener('click', () => { if (!busy) clear(); });
    $('sysAgentStop')?.addEventListener('click', () => deps && deps.stop());
    $('sysAgentForm')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    $('sysAgentInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && document.body.classList.contains('system-maker-mode')) open(false); });
    open(read(OPEN_KEY, true) !== false);
  }

  /** The conversation so far, as the agent is shown it. */
  const history = () => turns.map((t) => ({ role: t.role, text: t.text }));

  window.HCSystemsAgentChat = { init, user, agent, reply, step, settle, setBusy, setStatus, open, isOpen, clear, history, WELCOME };
})();
