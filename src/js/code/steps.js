// ==============================================================
// The steps of a HashCoder run, as the reply shows them
//
// Every tool call and every file change is a step: a short line on a rail
// while the run works, its dot pulsing and its time counting while it runs,
// then filled, or red when it failed, with what it took and a bar measuring
// that against the slowest step of its list, and whatever the step returned
// folded under it. Times read as a person says them: "340 ms", "4.2 s",
// "1 m 12 s", never "50094ms".
// When the run ends each list folds to one line, "12 steps", that opens it
// again; the changes the run made are gathered under the answer, each with
// Keep and Undo, so folding never hides a question still waiting for the
// person. What the model says between steps sits between lists, where it
// said it.
//
// Steps are <details>, so opening one works from the keyboard as it is.
// verbOf, objectOf, stepsLine, changesTitle and duration are pure; the rest
// draws into the panel.
//
// Loaded before the Coder mode and published as window.HCCodeSteps.
// Checked by scripts/checks/code-steps.mjs.
// ==============================================================

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * What each tool did, as one short word.
   *
   * A run used to read as a list of function names — `read_file`, `grep_code`,
   * `fs_search_files` — which is the agent's vocabulary, not the user's. The
   * question being answered while a run scrolls past is "what is it doing",
   * and a verb answers that where an identifier does not.
   *
   * A tool with no entry falls back to its own name, so a new tool appears in
   * the run immediately rather than waiting for this table to catch up.
   */
  const TOOL_VERBS = {
    read_file: 'READ', write_file: 'WROTE', patch_file: 'EDIT',
    list_dir: 'LIST', delete_file: 'DELETE', move_file: 'MOVE',
    fuzzy_find: 'FIND', grep_code: 'GREP', search_files: 'FIND',
    shell_run: 'SHELL', web_search: 'SEARCH', fetch_url: 'FETCH',
    search_knowledge: 'KB', execute_python: 'PYTHON',
    current_datetime: 'TIME', calculate: 'CALC',
    remember_fact: 'REMEMBER', recall_facts: 'RECALL',
    placeholder_images: 'IMAGES', find_photos: 'PHOTOS', update_plan: 'PLAN', save_lesson: 'LESSON',
  };
  const verbOf = (name) => TOOL_VERBS[name] || window.HCMcp?.stepOf(name)?.verb || String(name || '').toUpperCase();

  /** The one argument worth showing beside the verb; `shown(path)` writes a place as the step shows it. */
  function objectOf(name, args, shown = (p) => String(p || '')) {
    const a = args || {};
    if (name === 'update_plan') return window.HCCodePlan?.stepLine(a) || '';
    if (name === 'shell_run') {
      return [a.command, ...(Array.isArray(a.args) ? a.args : [])].join(' ').trim();
    }
    if (name === 'move_file') return `${shown(a.from)} → ${shown(a.to)}`;
    if (/^sys_/.test(name)) return window.HCMcp?.stepOf(name)?.object || '';   // a connected system's tool
    const place = a.path || a.dir || a.file;
    if (place) return shown(place);
    return String(a.query || a.subject || a.url || a.pattern || a.expression || a.key || '');
  }

  /** The line a run's steps fold to when it ends: "12 steps", "3 steps · 1 failed". */
  function stepsLine(count, failed = 0) {
    const n = Math.max(0, Number(count) || 0), f = Math.max(0, Number(failed) || 0);
    return `${n} step${n === 1 ? '' : 's'}${f ? ` · ${f} failed` : ''}`;
  }

  /**
   * How many steps a list held: those still in it and the changes gathered out
   * of it below the answer. The run's own count (the one a stop says, "Stopped
   * after 26 steps") takes a change for a step, so the line does.
   */
  const stepsHeld = (listed, gathered = 0) => Math.max(0, Number(listed) || 0) + Math.max(0, Number(gathered) || 0);

  /** A time as a person reads it: "340 ms", "4.2 s", "50.1 s", "1 m 12 s", "1 h 04 m"; '' for none. */
  function duration(ms) {
    const t = Number(ms);
    if (ms == null || !Number.isFinite(t) || t < 0) return '';
    if (t < 1) return '<1 ms';
    if (t < 999.5) return `${Math.round(t)} ms`;
    if (t < 59950) return `${(t / 1000).toFixed(1)} s`;
    const all = Math.round(t / 1000), h = Math.floor(all / 3600), m = Math.floor((all % 3600) / 60), sec = all % 60;
    return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m ${String(sec).padStart(2, '0')} s`;
  }

  // A step's time while it runs, counting. One timer serves every step running, and stops when none is.
  const LIVE = 'cdr-step-live';
  let ticker = 0;
  function tick() {
    const live = [...document.querySelectorAll(`.${LIVE}`)].filter((el) => el.isConnected);
    if (!live.length) { clearInterval(ticker); ticker = 0; return; }
    const now = Date.now();
    for (const el of live) el.textContent = duration(now - Number(el.dataset.since || now));
  }

  /** What a step shows while it runs: its time so far. */
  const running = () => `<span class="cdr-step-time ${LIVE}" data-since="${Date.now()}">0 ms</span>`;

  /** The bars of a list's timed steps, each against the slowest of them. */
  function measure(list) {
    if (!list) return;
    const timed = [...list.children].filter((s) => s.classList.contains('cdr-step') && s.dataset.ms != null);
    const most = Math.max(1, ...timed.map((s) => Number(s.dataset.ms) || 0));
    for (const s of timed) {
      const bar = s.querySelector('.cdr-step-bar > i');
      if (bar) bar.style.transform = `scaleX(${Math.max(0.04, (Number(s.dataset.ms) || 0) / most).toFixed(3)})`;
    }
  }

  /** A step that has ended: done or failed, what it took, and its list's bars measured again. A saved step has no time. */
  function finish(el, ok, ms) {
    if (!el) return;
    el.classList.remove('cdr-step--running');
    el.classList.add(ok ? 'cdr-step--ok' : 'cdr-step--err');
    const took = duration(ms);
    if (took) el.dataset.ms = String(Math.max(0, Math.round(Number(ms))));
    const status = el.querySelector('.cdr-step-result');
    if (status) status.innerHTML = (took ? '<span class="cdr-step-bar" aria-hidden="true"><i></i></span>' : '') + (!ok ? '<span class="cdr-step-time cdr-step-failed">failed</span>' : '') + (took ? `<span class="cdr-step-time">${esc(took)}</span>` : '');
    measure(el.parentElement);
  }

  /** The heading over a run's changes. */
  const changesTitle = (count) => `${count === 1 ? '1 change' : `${count} changes`} — keep or undo`;

  /**
   * The list a step joins in a reply: the one the reply ends with, or a new
   * one, which folds and opens from its heading once the run has ended.
   */
  function listFor(contentEl) {
    const last = contentEl.lastElementChild;
    if (last && last.classList.contains('cdr-steps') && !last.classList.contains('done')) return last.querySelector('.cdr-steps-list');
    const group = document.createElement('div');
    group.className = 'cdr-steps';
    group.innerHTML = '<button type="button" class="cdr-steps-h" aria-expanded="true"></button><div class="cdr-steps-list"></div>';
    const head = group.querySelector('.cdr-steps-h');
    head.addEventListener('click', () => head.setAttribute('aria-expanded', String(group.classList.toggle('open'))));
    contentEl.appendChild(group);
    return group.querySelector('.cdr-steps-list');
  }

  /**
   * What the person sent while the run worked, where the run read it
   * (js/queue.js): their words, between two lists of steps, so folding the
   * steps when the run ends never hides them.
   */
  function added(contentEl, text, pictures) {
    if (!contentEl) return null;
    const el = document.createElement('div');
    el.className = 'cdr-added';
    el.innerHTML = `<span class="cdr-added-label">You added</span>${(window.HCCodeAttach && window.HCCodeAttach.picturesHtml(pictures)) || ''}<span class="cdr-added-text"></span>`;   // with the pictures it came with
    el.querySelector('.cdr-added-text').textContent = String(text || '');
    contentEl.appendChild(el);
    return el;
  }

  /**
   * One step: verb, object and result, in the order the question comes in.
   * `status` is HTML the caller built (a time, or Keep and Undo); `flat`
   * puts the step straight into `contentEl` rather than into a run's list.
   */
  function add(contentEl, { verb, object, status, statusClass = '', open = false, flat = false } = {}) {
    if (!contentEl) return null;
    const el = document.createElement('details');
    el.className = 'cdr-step' + (statusClass ? ' ' + statusClass : '');
    el.open = open;
    el.innerHTML = `
        <summary class="cdr-step-head">
          <span class="cdr-step-verb">${esc(verb)}</span>
          <span class="cdr-step-object" title="${esc(object)}">${esc(object)}</span>
          <span class="cdr-step-result">${status || ''}</span>
        </summary>
        <div class="cdr-step-body"></div>`;
    (flat ? contentEl : listFor(contentEl)).appendChild(el);
    if (!ticker && el.querySelector(`.${LIVE}`)) ticker = setInterval(tick, 100);
    return el;
  }

  /** A reply whose run has ended: each list folded to its line, and the changes gathered under it. */
  function settle(contentEl) {
    if (!contentEl) return;
    // A step still counting when the run ended was stopped with it.
    contentEl.querySelectorAll(`.${LIVE}`).forEach((t) => { t.classList.remove(LIVE); t.textContent = 'stopped'; });
    const changed = [...contentEl.querySelectorAll('.cdr-steps-list > .cdr-step--change')];
    const gatheredFrom = new Map();
    changed.forEach((c) => gatheredFrom.set(c.parentElement, (gatheredFrom.get(c.parentElement) || 0) + 1));
    if (changed.length) {
      const box = document.createElement('div');
      box.className = 'cdr-changes';
      box.innerHTML = `<div class="cdr-changes-title">${esc(changesTitle(changed.length))}</div>`;
      changed.forEach((c) => box.appendChild(c));
      contentEl.appendChild(box);
    }
    contentEl.querySelectorAll('.cdr-steps:not(.done)').forEach((group) => {
      const steps = group.querySelectorAll('.cdr-steps-list > .cdr-step');
      if (!steps.length) { group.remove(); return; }
      group.classList.add('done');
      const head = group.querySelector('.cdr-steps-h');
      head.setAttribute('aria-expanded', 'false');
      head.textContent = stepsLine(stepsHeld(steps.length, gatheredFrom.get(group.querySelector('.cdr-steps-list'))), group.querySelectorAll('.cdr-steps-list > .cdr-step--err').length);
    });
  }

  window.HCCodeSteps = { TOOL_VERBS, verbOf, objectOf, stepsLine, stepsHeld, changesTitle, duration, running, finish, measure, listFor, add, added, settle };
})();
