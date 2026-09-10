// ==============================================================
// The Swarm Workspace — a kept run, drawn
//
// Opens over the Agent Swarm tab with a run's conversation on one side — the
// task, each agent's work under its own name, the team's result — and its
// files on the other, with a picker for past runs and for each version of
// the files. It replaces the output drawer, and keeps what that did: copy
// and export the result, and download the site as one page.
//
// Everything an agent wrote is rendered through HCMarkdown.renderUntrusted;
// file contents are only ever set as text. What each part shows is decided in
// src/js/swarm/workspace-view.js; the run itself comes from
// src/js/swarm/runs.js.
//
// The Agent Swarm hands this the few things only it has — the active
// blueprint, a way to save blueprints, the site builder and the save dialog —
// through init(), so the mode keeps only its wiring.
//
// Loaded before the Agent Swarm and published as window.HCSwarmWorkspace.
// ==============================================================

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const RUNS = () => window.HCSwarmRuns;
  const VIEW = () => window.HCSwarmWorkspaceView;

  let deps = null;
  let wired = false;
  const state = { blueprint: null, runs: [], run: null, rev: 0, file: '', returnFocus: null };

  function init(d) {
    deps = d;
    if (wired) return;
    wired = true;
    $('amkWsClose')?.addEventListener('click', close);
    $('amkWsRuns')?.addEventListener('change', (e) => selectRun(e.target.value));
    $('amkWsVersions')?.addEventListener('change', (e) => { state.rev = Number(e.target.value); state.file = ''; drawFiles(); });
    $('amkWsCopy')?.addEventListener('click', copyResult);
    $('amkWsExport')?.addEventListener('click', exportResult);
    $('amkWsDownload')?.addEventListener('click', downloadSite);
    $('amkWsTabs')?.addEventListener('keydown', onTabKey);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); } });
  }

  function isOpen() { return !!$('amkWorkspace') && !$('amkWorkspace').hidden; }

  function status(text, kind = '') {
    const el = $('amkWsStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'amk-ws-status' + (kind ? ' ' + kind : '');
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
    runs.disabled = state.runs.length < 2;

    const versions = $('amkWsVersions');
    const list = run?.versions || [];
    versions.replaceChildren(...list.slice().reverse().map((v) => new Option(V.versionLabel(run, v), String(v.rev), false, v.rev === state.rev)));
    versions.disabled = list.length < 2;

    const files = currentFiles();
    $('amkWsCopy').disabled = !resultText();
    $('amkWsExport').disabled = !resultText();
    $('amkWsDownload').disabled = !V.hasPage(files);
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

  window.HCSwarmWorkspace = { init, open, close, isOpen };
})();
