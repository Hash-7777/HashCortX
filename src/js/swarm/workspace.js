// ==============================================================
// The Swarm Workspace — a kept run, drawn
//
// Opens over the Agent Swarm tab with a run's conversation on one side — the
// task, each agent's work under its own name, the team's result — and its
// files on the other, with a picker for past runs and for each version of
// the files. It replaces the output drawer, and keeps what that did: copy
// and export the result, and download the site as one page.
//
// Under the conversation is a message box. A message goes to the run's lead
// agent, or to whoever it names with @; the answer joins the conversation, and
// any files it changes become a new version made from the version on screen.
// Who a message is for and what the agent is sent are decided in
// src/js/swarm/talk.js.
//
// Everything an agent wrote is rendered through HCMarkdown.renderUntrusted;
// file contents are only ever set as text. What each part shows is decided in
// src/js/swarm/workspace-view.js; the run itself comes from
// src/js/swarm/runs.js.
//
// The Agent Swarm hands this the few things only it has — the active
// blueprint, a way to save blueprints, the site builder, the save dialog and
// a way to ask one of its agents — through init(), so the mode keeps only its
// wiring.
//
// Loaded before the Agent Swarm and published as window.HCSwarmWorkspace.
// ==============================================================

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const RUNS = () => window.HCSwarmRuns;
  const VIEW = () => window.HCSwarmWorkspaceView;
  const TALK = () => window.HCSwarmTalk;

  let deps = null;
  let wired = false;
  const state = { blueprint: null, runs: [], run: null, rev: 0, file: '', returnFocus: null, asking: null };

  function init(d) {
    deps = d;
    if (wired) return;
    wired = true;
    $('amkWsClose')?.addEventListener('click', close);
    $('amkWsRuns')?.addEventListener('change', (e) => selectRun(e.target.value));
    $('amkWsVersions')?.addEventListener('change', (e) => { state.rev = Number(e.target.value); state.file = ''; drawFiles(); drawComposer(); });
    $('amkWsCopy')?.addEventListener('click', copyResult);
    $('amkWsExport')?.addEventListener('click', exportResult);
    $('amkWsDownload')?.addEventListener('click', downloadSite);
    $('amkWsOpen')?.addEventListener('click', openInBrowser);
    $('amkWsTabs')?.addEventListener('keydown', onTabKey);
    $('amkWsSend')?.addEventListener('click', send);
    $('amkWsStop')?.addEventListener('click', () => state.asking?.controller.abort());
    $('amkWsMessage')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); } });
  }

  function isOpen() { return !!$('amkWorkspace') && !$('amkWorkspace').hidden; }

  function status(text, kind = '') {
    const el = $('amkWsStatus');
    if (!el) return;
    el.textContent = text;
    el.title = text;
    el.className = 'amk-ws-status' + (kind ? ' ' + kind : '');
  }

  /** What happened to the last message, told beside the message box. */
  const HINT = 'Enter to send, Shift+Enter for a new line';
  function note(text, kind = '') {
    const el = $('amkWsNote');
    if (!el) return;
    el.textContent = text || HINT;
    el.className = 'amk-ws-hint' + (kind ? ' ' + kind : '');
  }

  /**
   * Open the Workspace on a blueprint's run — the one named, or its latest.
   *
   * A blueprint whose result was saved before runs were kept has that result
   * turned into a run the first time it is opened, so nothing already made is
   * lost to the change.
   */
  async function open(blueprint, runId) {
    const root = $('amkWorkspace');
    if (!root || !deps) return;
    state.blueprint = blueprint || null;
    state.returnFocus = document.activeElement;
    root.hidden = false;
    status('');
    note('');
    try {
      await ensureKept(blueprint);
      state.runs = blueprint ? await RUNS().runsFor(blueprint.id) : [];
    } catch (err) {
      state.runs = [];
      status(`Could not read past runs: ${err?.message || err}`, 'err');
    }
    const wanted = runId || blueprint?.lastRunId || state.runs[0]?.id;
    state.run = state.runs.find((r) => r.id === wanted) || state.runs[0] || null;
    state.rev = state.run?.versions.length ? state.run.versions[state.run.versions.length - 1].rev : 0;
    state.file = '';
    draw();
    $('amkWsClose')?.focus();
  }

  async function ensureKept(bp) {
    if (!bp || bp.lastRunId || !bp.lastOutput) return;
    const R = RUNS();
    const run = R.fromLegacyOutput({ id: R.makeRunId(bp.lastRun || Date.now(), 'legacy'), blueprint: bp, output: bp.lastOutput, now: bp.lastRun || Date.now() });
    await R.saveRun(run);
    bp.lastRunId = run.id;
    // Now safely kept, it no longer needs the space beside the API keys.
    delete bp.lastOutput;
    deps.saveBlueprints();
  }

  function close() {
    const root = $('amkWorkspace');
    if (!root || root.hidden) return;
    root.hidden = true;
    const back = state.returnFocus;
    state.returnFocus = null;
    if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
  }

  function selectRun(id) {
    note('');
    state.run = state.runs.find((r) => r.id === id) || null;
    state.rev = state.run?.versions.length ? state.run.versions[state.run.versions.length - 1].rev : 0;
    state.file = '';
    draw();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  function draw() {
    drawHeader();
    drawTurns();
    drawFiles();
    drawComposer();
  }

  function drawHeader() {
    const run = state.run;
    const V = VIEW();
    const now = Date.now();
    $('amkWsTitle').textContent = state.blueprint?.name || run?.blueprintName || 'Swarm Workspace';
    $('amkWsSub').textContent = run
      ? `${run.agents.length} agent${run.agents.length === 1 ? '' : 's'} · ${V.timeAgo(run.startedAt, now)}`
      : 'No runs yet';

    const runs = $('amkWsRuns');
    runs.replaceChildren(...state.runs.map((r) => new Option(V.runLabel(r, now), r.id, false, r === run)));
    runs.disabled = state.runs.length < 2 || !!state.asking;

    const versions = $('amkWsVersions');
    const list = run?.versions || [];
    versions.replaceChildren(...list.slice().reverse().map((v) => new Option(V.versionLabel(run, v), String(v.rev), false, v.rev === state.rev)));
    versions.disabled = list.length < 2 || !!state.asking;

    const files = currentFiles();
    $('amkWsCopy').disabled = !resultText();
    $('amkWsExport').disabled = !resultText();
    $('amkWsDownload').disabled = !V.hasPage(files);
    $('amkWsOpen').disabled = !V.hasPage(files);
  }

  function drawTurns() {
    const box = $('amkWsTurns');
    const run = state.run;
    if (!run) {
      box.replaceChildren(empty('Run the swarm to see its work here — each agent\'s part, and the files they made.'));
      return;
    }
    const V = VIEW();
    const render = (text) => window.HCMarkdown.renderUntrusted(text, { marked: window.marked, purify: window.DOMPurify });
    box.replaceChildren(...V.turnsView(run).map((t) => {
      const el = document.createElement('article');
      el.className = `amk-ws-turn ${t.kind}${t.status !== 'ok' ? ' ' + t.status : ''}`;
      const head = document.createElement('div');
      head.className = 'amk-ws-turn-head';
      const avatar = document.createElement('span');
      avatar.className = 'amk-ws-avatar';
      avatar.textContent = t.icon || (t.kind === 'you' ? '•' : t.name.slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'amk-ws-name';
      name.textContent = t.name;
      head.append(avatar, name);
      if (t.role) {
        const role = document.createElement('span');
        role.className = 'amk-ws-role';
        role.textContent = t.role;
        head.append(role);
      }
      if (t.statusLabel) {
        const badge = document.createElement('span');
        badge.className = 'amk-ws-badge';
        badge.textContent = t.statusLabel;
        head.append(badge);
      }
      const body = document.createElement('div');
      body.className = 'amk-ws-turn-body';
      body.innerHTML = render(t.text);
      el.append(head, body);
      if (V.startsFolded(t.text)) {
        body.classList.add('folded');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'amk-ws-fold';
        more.textContent = 'Show all';
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
          const folded = body.classList.toggle('folded');
          more.textContent = folded ? 'Show all' : 'Show less';
          more.setAttribute('aria-expanded', String(!folded));
        });
        el.append(more);
      }
      return el;
    }));
    if (state.asking && state.asking.runId === run.id) box.append(pendingTurn(state.asking.agentId));
    box.scrollTop = box.scrollHeight;
  }

  /** The line that stands for an answer on its way. */
  function pendingTurn(agentId) {
    const agent = state.run.agents.find((a) => a.id === agentId) || { name: agentId };
    const el = document.createElement('article');
    el.className = 'amk-ws-turn agent pending';
    el.setAttribute('aria-busy', 'true');
    const head = document.createElement('div');
    head.className = 'amk-ws-turn-head';
    const avatar = document.createElement('span');
    avatar.className = 'amk-ws-avatar';
    avatar.textContent = agent.icon || agent.name.slice(0, 1).toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'amk-ws-name';
    name.textContent = agent.name;
    const note = document.createElement('span');
    note.className = 'amk-ws-working';
    note.textContent = 'Working on it…';
    head.append(avatar, name, note);
    el.append(head);
    return el;
  }

  function currentFiles() {
    const v = (state.run?.versions || []).find((x) => x.rev === state.rev);
    return v ? v.files : {};
  }

  function drawFiles() {
    const tabs = $('amkWsTabs');
    const pane = $('amkWsPane');
    const files = currentFiles();
    const names = VIEW().fileOrder(Object.keys(files));
    if (!names.length) {
      tabs.hidden = true;
      tabs.replaceChildren();
      pane.replaceChildren(empty(state.run ? 'This run made no files. Its result is in the conversation.' : ''));
      drawHeader();
      return;
    }
    if (!names.includes(state.file)) state.file = names[0];
    tabs.hidden = false;
    tabs.replaceChildren(...names.map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'amk-ws-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(n === state.file));
      b.tabIndex = n === state.file ? 0 : -1;
      b.dataset.file = n;
      b.textContent = n;
      b.addEventListener('click', () => { state.file = n; drawFiles(); });
      return b;
    }));
    const file = files[state.file];
    const bar = document.createElement('div');
    bar.className = 'amk-ws-filebar';
    const lines = String(file.content).split('\n').length;
    bar.textContent = `${state.file} · ${file.lang || 'text'} · ${lines} line${lines === 1 ? '' : 's'}`;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'amk-ws-btn';
    copy.textContent = 'Copy file';
    copy.addEventListener('click', () => copyText(file.content, `Copied ${state.file}`));
    bar.append(copy);
    const pre = document.createElement('pre');
    pre.className = 'amk-ws-code';
    pre.textContent = file.content;
    pane.replaceChildren(bar, pre);
    drawHeader();
  }

  function onTabKey(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...$('amkWsTabs').querySelectorAll('.amk-ws-tab')];
    const i = tabs.findIndex((t) => t.dataset.file === state.file);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    e.preventDefault();
    state.file = next.dataset.file;
    drawFiles();
    $('amkWsTabs').querySelector(`[data-file="${CSS.escape(state.file)}"]`)?.focus();
  }

  function empty(text) {
    const d = document.createElement('div');
    d.className = 'amk-ws-empty';
    d.textContent = text;
    return d;
  }

  // ── Talking to the agents ───────────────────────────────────────────────

  function latestRev(run) {
    return run?.versions.length ? run.versions[run.versions.length - 1].rev : 0;
  }

  function drawComposer() {
    const run = state.run;
    const to = $('amkWsTo');
    const lead = run ? TALK().leadAgentId(run) : '';
    const leadName = run?.agents.find((a) => a.id === lead)?.name || '';
    const chosen = to.value;
    to.replaceChildren(
      new Option(leadName ? `${leadName} (lead)` : 'The lead agent', ''),
      ...(run?.agents || []).filter((a) => a.id !== lead).map((a) => new Option(a.name, a.id)),
    );
    to.value = [...to.options].some((o) => o.value === chosen) ? chosen : '';
    const busy = !!state.asking;
    to.disabled = !run || busy;
    $('amkWsMessage').disabled = !run || busy;
    $('amkWsSend').hidden = busy;
    $('amkWsSend').disabled = !run;
    $('amkWsStop').hidden = !busy;
    const base = $('amkWsBase');
    base.textContent = run && state.rev && state.rev !== latestRev(run)
      ? `Changes will be made to v${state.rev}, the version on screen`
      : '';
  }

  /**
   * Send the message to the agent it is for, and keep what comes back.
   *
   * The message stays in the box until an answer is kept, so a failure or a
   * Stop loses nothing and needs no retyping. The answer is kept against the
   * run it was asked of, even if the Workspace was closed while it was coming.
   */
  async function send() {
    const run = state.run;
    const box = $('amkWsMessage');
    const raw = box.value.trim();
    if (!run || !raw || state.asking) return;
    const T = TALK();
    const who = T.addressee(run, raw);
    const agentId = who.named ? who.agentId : ($('amkWsTo').value || who.agentId);
    const agent = run.agents.find((a) => a.id === agentId);
    if (!agent) { note('This run has no agents to ask.', 'err'); return; }
    if (!who.text) { note(`Say what you would like ${agent.name} to do.`, 'err'); return; }
    const base = currentFiles();
    const rev = state.rev;
    state.asking = { runId: run.id, agentId, controller: new AbortController() };
    note(`Asking ${agent.name}…`);
    draw();
    try {
      const reply = String(await deps.askAgent(agent, T.messagesFor(run, agentId, who.text, base), state.asking.controller.signal) || '').trim();
      if (!reply) throw new Error(`${agent.name} sent back an empty answer`);
      const { run: next, changed, unnamedCode } = T.withReply(run, { agentId, message: raw, reply, at: Date.now(), base });
      await RUNS().saveRun(next);
      state.runs = state.runs.map((r) => (r.id === next.id ? next : r));
      if (state.run?.id === next.id) {
        state.run = next;
        box.value = '';
        if (changed.length) { state.rev = latestRev(next); state.file = changed[0]; }
      }
      note(changed.length
        ? `${agent.name} changed ${changed.join(', ')}: now v${latestRev(next)}`
        : unnamedCode
          ? `${agent.name}'s answer has code that names no file, so no file was changed. Ask for the whole file, labelled with its name.`
          : `${agent.name} answered; no files changed${rev ? ` (still v${rev})` : ''}`,
      changed.length ? 'ok' : unnamedCode ? 'err' : '');
    } catch (err) {
      const stopped = err?.name === 'AbortError' || state.asking?.controller.signal.aborted;
      note(stopped ? 'Stopped. Your message is still in the box.' : `${agent.name} could not answer: ${err?.message || err}`, stopped ? '' : 'err');
    } finally {
      state.asking = null;
      draw();
      if (isOpen()) box.focus();
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  function resultText() {
    const turns = state.run?.turns || [];
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].who === 'team') return turns[i].text;
    return '';
  }

  function copyText(text, done) {
    navigator.clipboard.writeText(text).then(() => status(done, 'ok'), () => status('Could not copy', 'err'));
  }

  function copyResult() { const t = resultText(); if (t) copyText(t, 'Copied the result'); }

  async function exportResult() {
    const text = resultText();
    if (!text) return;
    const stem = (state.blueprint?.name || 'swarm-output').replace(/\s+/g, '-').toLowerCase();
    if (await deps.saveFile(`${stem}-${Date.now()}.md`, text, 'text/markdown;charset=utf-8')) status('Saved the result', 'ok');
  }

  /** The version on screen, as one page with its styles and scripts inside. */
  async function downloadSite() {
    const html = deps.buildSite(new Map(Object.entries(currentFiles())));
    if (!html) { status('These files have no page to save.', 'err'); return; }
    status('Saving…');
    if (await deps.saveFile('site.html', html, 'text/html;charset=utf-8')) status(`Saved site.html (v${state.rev})`, 'ok');
    else status('');
  }

  /**
   * The version on screen, opened where it can run as written. A preview
   * inside the app would inherit the app's security policy, which in a
   * release lets none of a page's inline styles or scripts run.
   */
  async function openInBrowser() {
    const html = deps.buildSite(new Map(Object.entries(currentFiles())));
    if (!html) { status('These files have no page to open.', 'err'); return; }
    status('Opening…');
    try {
      await deps.openInBrowser(html);
      status(`Opened v${state.rev} in the browser`, 'ok');
    } catch (err) {
      status(`Could not open it: ${err?.message || err}`, 'err');
    }
  }

  window.HCSwarmWorkspace = { init, open, close, isOpen };
})();
