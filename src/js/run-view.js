// ==============================================================
// The run view: a HashCoder run's steps grouped into phases
//
// A run of forty steps read as forty lines of the same weight, and the shape
// of the work, finding its way, reading, changing, checking, was lost in
// them. Here each step is given a phase by the app, from what the step is,
// never from what the model says it is doing:
//
//   Finding    looking for where things are (find, search, list) before the
//              run has changed anything
//   Reading    reading files, pages, search results; and looking for where
//              things are once something has changed
//   Changing   writing, editing, deleting or moving a file, or a command
//              that is not a check
//   Checking   a command that tests, lints, checks types or builds
//   Reviewing  a second look at the changes; the app's own check-ins are
//              rows of their own in the phase they happen in
//
// When the phase changes, a header goes onto the rail before the step: the
// phase's drawn mark, its name, one line of what it did ("6 files", "2 edits,
// 1 command", "1 command, 1 failed") and its time. The phase that has ended
// folds its steps away to that line, and opens again from it; a change
// waiting for Keep or Undo is never folded away. The phase in work carries a
// turning mark, which moves only while the run goes on.
//
// Phases are drawn only in a reply whose run is going on, never in a saved
// conversation drawn again. phaseOf and line are pure; place, stepDone and
// end draw. Published as window.HCRunView. Checked by scripts/checks/run-view.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The phases, in the order a run goes through them. */
  const PHASES = ['finding', 'reading', 'changing', 'checking', 'reviewing'];
  const NAMES = { finding: 'Finding', reading: 'Reading', changing: 'Changing', checking: 'Checking', reviewing: 'Reviewing' };
  /** Each phase's mark: a 16-unit grid, drawn on currentColor. */
  const ICONS = {
    finding: '<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>',
    reading: '<path d="M4 2.5h5.2L12 5.3v8.2H4z"/><path d="M9 2.5v3h3M6.2 8.5h3.6M6.2 11h3.6"/>',
    changing: '<path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1L6 12.5l-3 .7.7-3z"/><path d="m9.4 4.1 2.5 2.5"/>',
    checking: '<path d="M6.2 2.5h3.6M6.8 2.5v3.8L3.3 12.2a.9.9 0 0 0 .8 1.3h7.8a.9.9 0 0 0 .8-1.3L9.2 6.3V2.5"/><path d="M4.9 9.6h6.2"/>',
    reviewing: '<path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/>',
  };
  /** The mark of the phase in work: two thin brackets that turn. */
  const RETICLE = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.6A13.4 13.4 0 0 1 28.6 11.4"/><path d="M16 29.4A13.4 13.4 0 0 1 3.4 20.6"/><path d="M29.2 16h-2M2.8 16h2"/></svg>';

  const FINDS = new Set(['FIND', 'GREP', 'LIST']);
  const READS = new Set(['READ', 'FETCH', 'SEARCH', 'KB', 'PHOTOS', 'RECALL']);
  const CHANGES = new Set(['EDIT', 'WROTE', 'DELETE', 'MOVE', 'IMAGES']);
  const REVIEWS = new Set(['REVIEW']);   // the app's check-ins (CHECK) are rows of their own in the phase they happen in
  const CHECKS = new Set(['test', 'lint', 'typecheck', 'build']);

  /** The phase of a step, or null for one that belongs to none (a plan, a lesson) and stays in the phase it is in. */
  function phaseOf(verb, object, changedYet) {
    const v = String(verb || '').toUpperCase();
    if (FINDS.has(v)) return changedYet ? 'reading' : 'finding';
    if (READS.has(v)) return 'reading';
    if (CHANGES.has(v)) return 'changing';
    if (REVIEWS.has(v)) return 'reviewing';
    if (v === 'SHELL') {
      const V = typeof window !== 'undefined' && window.HCCodeVerify;
      const kind = V && typeof V.commandKind === 'function' ? V.commandKind(String(object || ''), []) : null;
      return CHECKS.has(kind) ? 'checking' : 'changing';
    }
    return null;
  }

  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

  /** What a phase did, in one line: "6 files", "2 edits, 1 command", "1 command, 1 failed"; '' for nothing yet. */
  function line(phase, steps) {
    const list = Array.isArray(steps) ? steps : [];
    if (!list.length) return '';
    const failed = list.filter((s) => s && s.failed).length;
    const tail = failed ? `, ${failed} failed` : '';
    if (phase === 'finding') return many(list.length, 'search', 'searches') + tail;
    if (phase === 'reading') {
      const files = new Set(list.filter((s) => s.verb === 'READ').map((s) => String(s.object)));
      const other = list.filter((s) => s.verb !== 'READ').length;
      return [files.size ? many(files.size, 'file', 'files') : '', other ? many(other, 'other read', 'other reads') : ''].filter(Boolean).join(', ') + tail;
    }
    if (phase === 'changing') {
      const edits = list.filter((s) => s.verb !== 'SHELL').length, commands = list.length - edits;
      return [edits ? many(edits, 'edit', 'edits') : '', commands ? many(commands, 'command', 'commands') : ''].filter(Boolean).join(', ') + tail;
    }
    if (phase === 'checking') return many(list.length, 'command', 'commands') + tail;
    return many(list.length, 'check', 'checks') + tail;
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  let seq = 0;
  const byId = new Map();   // a phase's id -> { phase, head, steps, began }

  const timeOf = (ms) => (window.HCCodeSteps && window.HCCodeSteps.duration ? window.HCCodeSteps.duration(ms) : `${Math.round(ms)} ms`);

  function paint(ph) {
    ph.head.querySelector('.cdr-phase-line').textContent = line(ph.phase, ph.steps.filter((s) => !s.el || s.el.isConnected));   // a tool row replaced by its change row counts once
  }

  /** Fold or open a phase's steps; a change waiting for Keep or Undo, or a step still running, is never folded away. */
  function fold(ph, folded) {
    ph.head.classList.toggle('open', !folded);
    ph.head.querySelector('.cdr-phase-h').setAttribute('aria-expanded', String(!folded));
    for (const step of ph.steps) {
      const s = step.el;
      if (!s || s.classList.contains('cdr-step--running')) continue;
      if (!s.classList.contains('cdr-step--change')) s.classList.toggle('cdr-step--folded', folded);
    }
  }

  function close(ph) {
    if (!ph || ph.closed) return;
    ph.closed = true;
    ph.head.classList.remove('now');
    ph.head.classList.add('closed');
    ph.head.querySelector('.cdr-phase-time').textContent = timeOf(Date.now() - ph.began);
    fold(ph, true);
  }

  function open(list, phase, before) {
    const id = `ph${++seq}`;
    const head = document.createElement('div');
    head.className = `cdr-phase now cdr-phase--${phase}`;
    head.dataset.phaseHead = id;
    head.innerHTML = `<span class="cdr-phase-badge" aria-hidden="true"><svg viewBox="0 0 16 16">${ICONS[phase]}</svg></span>` +
      `<span class="cdr-reticle">${RETICLE}</span>` +
      `<button type="button" class="cdr-phase-h" aria-expanded="true"><span class="cdr-phase-name">${NAMES[phase]}</span><span class="cdr-phase-line"></span><span class="cdr-phase-time">now</span></button>`;
    list.insertBefore(head, before);
    const ph = { id, phase, head, steps: [], began: Date.now(), closed: false };
    head.querySelector('.cdr-phase-h').addEventListener('click', () => fold(ph, head.classList.contains('open')));
    byId.set(id, ph);
    return ph;
  }

  /** A step just drawn into `list`: it joins the phase in work, or begins the next. */
  function place(contentEl, list, el, verb, object) {
    if (!contentEl || !contentEl.closest('.cdr-msg.running')) return null;
    if (!list || !el) return null;
    const st = contentEl.hcPhases || (contentEl.hcPhases = { cur: null, changed: false });
    const phase = phaseOf(verb, object, st.changed) || (st.cur && st.cur.phase) || 'reading';
    if (phase === 'changing') st.changed = true;
    if (!st.cur || st.cur.phase !== phase) {
      close(st.cur);
      st.cur = open(list, phase, el);
    }
    el.dataset.phase = st.cur.id;
    st.cur.steps.push({ verb: String(verb || '').toUpperCase(), object: String(object || ''), failed: false, el });
    paint(st.cur);
    return st.cur.id;
  }

  /** A step has ended: whether it failed goes into its phase's line. */
  function stepDone(el, ok) {
    const ph = el && el.dataset && byId.get(el.dataset.phase);
    if (!ph) return;
    const step = ph.steps.find((s) => s.el === el);
    if (step) step.failed = !ok;
    paint(ph);
  }

  /** The run has ended: its last phase closes, and nothing turns. */
  function end(contentEl) {
    const st = contentEl && contentEl.hcPhases;
    if (!st) return;
    close(st.cur);
    contentEl.hcPhases = null;
  }

  window.HCRunView = { PHASES, NAMES, ICONS, phaseOf, line, place, stepDone, end };
})();
