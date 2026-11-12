// ==============================================================
// The preview: what a HashCoder run will do, shown before it starts
//
// A big request started at once, and the first the person saw of what it
// would touch was the first change. Now, for a request of three asks or
// more, or a project too large to show whole, a card goes at the top of
// the reply before the first step: the asks, the files the app's finder
// found (js/code/find.js), the plan once the model has written one, and
// what it will ask you before doing, by the permission mode
// (js/code/permissions.js) and the tools the run is given.
//
// In Manual the run waits for Start: nothing is changed, nothing is run,
// and the model is not yet asked. A message sent while it waits is read at
// the first step (js/queue.js), and Stop ends it as a stopped run. In the
// other modes the card is shown and the run carries on. At the first change
// the card folds to one line, and opens again from it; once the brief is
// drawn (js/run-view.js), the asks are said there and not twice, so the
// card becomes the brief.
//
// Settings, HashCoder, "Show me the plan first": Never, Big tasks (the
// default), Always.
//
// preview, wanted, questions, line and prefOf are pure; before, onStep and
// wire draw. Published as window.HCCodePreview. Checked by
// scripts/checks/code-preview.mjs.
// ==============================================================

(function () {
  'use strict';

  const PREFS = [
    { id: 'never', label: 'Never' },
    { id: 'big', label: 'Big tasks' },
    { id: 'always', label: 'Always' },
  ];
  /** A request of this many asks or more is a big task (js/code/asks.js MIN_ASKS). */
  const BIG_ASKS = 3;
  /** At most this many files are listed. */
  const MOST_FILES = 10;

  const prefOf = (v) => (PREFS.some((p) => p.id === v) ? v : 'big');

  /** Whether the card is shown: by the setting, the number of asks, and whether the project could be shown whole. */
  function wanted(pref, { asks = 0, whole = true } = {}) {
    const p = prefOf(pref);
    if (p === 'never') return false;
    if (p === 'always') return true;
    return asks >= BIG_ASKS || whole === false;
  }

  const has = (list, names) => (Array.isArray(list) ? list : []).some((t) => names.includes(t && t.function ? t.function.name : t && t.name));
  const CHANGES = ['write_file', 'patch_file', 'delete_file', 'move_file'];
  const COMMANDS = ['shell_run', 'execute_python'];
  const WEB = ['fetch_url', 'web_search'];

  /** What the run will ask the person before doing, in the mode it is in, for the tools it is given (js/code/permissions.js MODES); in light mode the app writes each file itself, and asks first (js/code/light.js). */
  function questions(mode, tools, light = false) {
    if (light) return ['writing each file'];
    const m = mode === 'edits' || mode === 'auto' ? mode : 'ask';
    const out = [];
    if (m === 'ask' && has(tools, CHANGES)) out.push('changing a file');
    if (has(tools, COMMANDS)) out.push(m === 'auto' ? 'running a command other than a read, a search or the project\'s own checks' : 'running a command');
    if (m !== 'ask' && has(tools, ['delete_file', 'move_file'])) out.push('deleting a file, or moving one out of the project');
    if (has(tools, WEB)) out.push('reading a web page or a search');
    return out;
  }

  /** What the card says: { asks, files, plan [{ step, done }], questions, waits }. */
  function preview({ asks = [], found = null, plan = null, mode, tools = [], light = false } = {}) {
    const list = Array.isArray(asks) && asks.length >= BIG_ASKS ? asks.map(String) : [];
    const files = [...new Set((found && Array.isArray(found.files) ? found.files : []).map((f) => String((f && f.path) || f || '')).filter(Boolean))].slice(0, MOST_FILES);
    const steps = (plan && Array.isArray(plan.steps) ? plan.steps : []).map((s) => ({ step: String((s && s.step) || ''), done: !!s && s.status === 'done' })).filter((s) => s.step);
    return { asks: list, files, plan: steps, questions: questions(mode, tools, light), waits: mode !== 'edits' && mode !== 'auto' };
  }

  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

  /** The one line a folded card says: "3 asks · 6 files found", "a plan of 4 steps, 1 done". */
  function line(p) {
    if (!p) return '';
    const done = (p.plan || []).filter((s) => s.done).length;
    return [p.asks && p.asks.length ? many(p.asks.length, 'ask', 'asks') : '', p.files && p.files.length ? `${many(p.files.length, 'file', 'files')} found` : '', p.plan && p.plan.length ? `a plan of ${many(p.plan.length, 'step', 'steps')}, ${done} done` : ''].filter(Boolean).join(' · ');
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  const listInto = (el, items, ordered) => {
    const l = document.createElement(ordered ? 'ol' : 'ul');
    for (const it of items) {
      const li = document.createElement('li');
      if (it && typeof it === 'object') { li.textContent = it.step; if (it.done) li.className = 'is-done'; } else li.textContent = it;
      l.appendChild(li);
    }
    el.appendChild(l);
  };

  function section(card, cls, label, fill) {
    const s = document.createElement('div');
    s.className = `cdr-preview-sec ${cls}`;
    s.appendChild(Object.assign(document.createElement('span'), { className: 'cdr-preview-k', textContent: label }));
    fill(s);
    card.querySelector('.cdr-preview-body').appendChild(s);
    return s;
  }

  function paintPlan(card) {
    const steps = preview({ plan: window.HC && window.HC.code && window.HC.code.plan }).plan;
    const sec = card.querySelector('.cdr-preview-plan');
    if (!sec) return;
    sec.querySelectorAll('ol, .cdr-preview-soft').forEach((n) => n.remove());
    if (steps.length) listInto(sec, steps, true);
    else sec.appendChild(Object.assign(document.createElement('span'), { className: 'cdr-preview-soft', textContent: 'written once it starts' }));
    card.hcPreview.plan = steps;
    card.querySelector('.cdr-preview-line').textContent = line(card.hcPreview);
  }

  function fold(card, folded) {
    card.classList.toggle('folded', folded);
    card.querySelector('.cdr-preview-h').setAttribute('aria-expanded', String(!folded));
  }

  /**
   * Show the card at the top of a reply, when it is wanted. In Manual, wait
   * for Start (or Stop, which ends it as a stopped run); otherwise carry on.
   * `o`: pref, asks, whole, found, mode, tools, light, signal, status(text, kind).
   */
  async function before(contentEl, o = {}) {
    const { signal } = o;
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!contentEl || !wanted(o.pref, { asks: (o.asks || []).length, whole: o.whole })) return null;
    const p = preview({ asks: o.asks, found: o.found, plan: window.HC && window.HC.code && window.HC.code.plan, mode: o.mode, tools: o.tools, light: o.light });
    const card = document.createElement('section');
    card.className = 'cdr-preview';
    card.hcPreview = p;
    card.setAttribute('aria-label', 'What this run will do');
    card.innerHTML = '<button type="button" class="cdr-preview-h" aria-expanded="true"><span class="cdr-preview-name">Before it starts</span><span class="cdr-preview-line"></span></button><div class="cdr-preview-body"></div>';
    card.querySelector('.cdr-preview-h').addEventListener('click', () => fold(card, !card.classList.contains('folded')));
    if (p.asks.length) section(card, 'cdr-preview-asks', 'Your asks', (s) => listInto(s, p.asks, true));
    section(card, 'cdr-preview-files', 'Files the app found', (s) => (p.files.length ? listInto(s, p.files) : s.appendChild(Object.assign(document.createElement('span'), { className: 'cdr-preview-soft', textContent: 'none named before it starts: it looks for them as it goes' }))));
    section(card, 'cdr-preview-plan', 'Its plan', () => {});
    section(card, 'cdr-preview-asked', 'It asks you before', (s) => (p.questions.length ? listInto(s, p.questions) : s.appendChild(Object.assign(document.createElement('span'), { className: 'cdr-preview-soft', textContent: 'nothing: it is given no tools that change or run anything' }))));
    contentEl.insertBefore(card, contentEl.firstChild);
    paintPlan(card);
    if (!p.waits) { card.classList.toggle('has-brief', !!contentEl.querySelector('.cdr-brief')); return 'shown'; }
    card.classList.add('is-waiting');   // while it waits, the card alone says what will happen: the brief under it is hidden
    const go = document.createElement('div');
    go.className = 'cdr-preview-go';
    go.innerHTML = '<span class="cdr-preview-note">Nothing has been changed or run yet. A message you add now is read at its first step.</span><button type="button" class="cdr-preview-start">Start</button>';
    card.querySelector('.cdr-preview-body').appendChild(go);
    if (typeof o.status === 'function') o.status('Waiting for you to start', '');
    const start = go.querySelector('.cdr-preview-start');   // never given focus: the person may be typing in the box below
    await new Promise((resolve, reject) => {
      start.addEventListener('click', () => resolve(), { once: true });
      if (signal) signal.addEventListener('abort', () => { go.remove(); card.classList.remove('is-waiting'); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    go.remove();
    card.classList.remove('is-waiting');
    card.classList.toggle('has-brief', !!contentEl.querySelector('.cdr-brief'));
    card.querySelector('.cdr-preview-name').textContent = 'Before it started';
    return 'started';
  }

  /** A step was drawn in the reply (js/run-view.js place), or the run ended ('end'): the plan up to date, the brief noticed, and at the first change, folded. */
  function onStep(contentEl, phase) {
    const card = contentEl && contentEl.querySelector(':scope > .cdr-preview');
    if (!card || !card.hcPreview) return;
    card.querySelector('.cdr-preview-name').textContent = 'Before it started';
    card.classList.toggle('has-brief', !!contentEl.querySelector('.cdr-brief'));
    paintPlan(card);
    if (phase === 'changing' || phase === 'end') fold(card, true);
  }

  /** The setting under HashCoder: a select of the three choices, kept by `save`. */
  function wire(select, value, save) {
    if (!select) return;
    select.value = prefOf(value);
    select.addEventListener('change', () => save(prefOf(select.value)));
  }

  window.HCCodePreview = { PREFS, BIG_ASKS, prefOf, wanted, questions, preview, line, before, onStep, wire };
})();
