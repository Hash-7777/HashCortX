// ==============================================================
// The live line under a HashCoder reply while the model works
//
// Three dots said only that something was waiting. This says what: the model
// thinking, or reading what the last step brought back (the page it fetched,
// the file it opened, the output of the command), or writing, or choosing its
// next step, for how long, and, where the model's answer arrives as it is
// written (a model on this computer), the answer itself as it grows. What it
// says comes from what has happened, not from a timer: the step that just
// ended, the model's own thinking arriving, its words arriving, a call being
// written. A tool call being written is not shown as text, since it is not
// words for the person. It is the one sign of work in the panel: a small
// mesh of dots, five across and three down on faint hairlines, its centre
// in the second accent, that moves the way of what is going on (a wave
// crossing it for thinking, slower while the model's own thinking arrives,
// a light sweeping along for reading, quicker for writing, drawn to the
// centre for choosing, rings from the centre for checking) beside the words
// that say it. The clock beside it counts from the moment the request was
// sent, not from the step, so it says how long the whole request has taken.
//
// It reports state, so it is not one of the decorations that rest after a
// minute without a mouse (js/power.js). It moves by transform and opacity
// alone, on fifteen dots, and stands still for someone who asked for less
// motion.
//
// When the turn ends the caller decides what stays: the words the model said
// before a step stay in the reply as a line of their own, and everything else
// goes, the answer being drawn in its place.
//
// looksLikeCalls, elapsed, phaseOf and afterOf are pure and checked by
// scripts/checks/code-live.mjs; start draws into the panel.
// Loaded before the Coder mode and published as window.HCCodeLive.
// ==============================================================

(function () {
  'use strict';

  // How a reply that is calls written as text begins, outside a code block.
  const CALL_START = /^\s*(?:[{[]|<tool_call>|<function|<\|?tool)/i;

  /**
   * Whether text so far is a tool call being written, rather than words for
   * the person: a call as the reply opens, or a json or tool_code block, or a
   * bare one, opening on one. Blocks are read by js/fences.js, which also
   * reads one not yet closed.
   */
  function looksLikeCalls(text) {
    const t = String(text || '');
    if (CALL_START.test(t)) return true;
    const F = window.HCFences;
    if (!F || !F.splitFences) return false;
    const first = F.splitFences(t).find((p) => p.type === 'code' || String(p.text || '').trim());
    const code = first && first.type === 'code' ? String(first.code || '').trim() : null;
    return code != null && /^(json|tool_code|)$/i.test(first.lang || '') && (!code || /^[{[]/.test(code));
  }

  const PLACES = new Set(['read_file', 'view_image', 'write_file', 'patch_file', 'delete_file', 'list_dir']);
  const MOST = 36;
  const cut = (t) => (t.length > MOST ? `${t.slice(0, MOST - 1).trimEnd()}…` : t);

  /** What a step worked on, short enough to read at a glance: a file by its name, a page by its host, a command as typed. */
  function brief(tool, object) {
    const o = String(object == null ? '' : object).trim();
    if (!o) return '';
    if (tool === 'fetch_url') { try { return new URL(o).host.replace(/^www\./, ''); } catch { /* not an address: shown as it is */ } }
    if (PLACES.has(tool)) { const name = o.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || o; return cut(tool === 'list_dir' ? `${name}/` : name); }
    return cut(o);
  }

  /** What the model is doing after a step: what it is looking at, in words that say so. */
  const READING = {
    read_file: (o) => (o ? `Studying ${o}` : 'Studying the file'),
    view_image: (o) => (o ? `Looking at ${o}` : 'Looking at the picture'),
    list_dir: (o) => (o ? `Taking in the layout of ${o}` : 'Taking in the layout'),
    grep_code: () => 'Going through the matches',
    fuzzy_find: () => 'Going through the matches',
    search_files: () => 'Going through the matches',
    web_search: () => 'Reading the search results',
    fetch_url: (o) => (o ? `Reading ${o}` : 'Reading the page'),
    shell_run: (o) => (o ? `Reading the output of ${o}` : 'Reading the output'),
    execute_python: () => 'Reading the result',
    write_file: (o) => (o ? `Checking its change to ${o}` : 'Checking its change'),
    patch_file: (o) => (o ? `Checking its change to ${o}` : 'Checking its change'),
    move_file: () => 'Checking the move',
    delete_file: () => 'Checking the deletion',
    update_plan: () => 'Planning the next step',
    find_photos: () => 'Choosing pictures',
    placeholder_images: () => 'Choosing pictures',
    search_knowledge: () => 'Reading your notes',
    recall_facts: () => 'Reading your notes',
    calculate: () => 'Working it out',
    current_datetime: () => 'Working it out',
    remember_fact: () => 'Noting that down',
    save_lesson: () => 'Noting that down',
  };

  /**
   * What the line says and how its marks move.
   *
   *   text      the model's words so far ('' before any)
   *   thinking  its own thinking has begun to arrive
   *   after     the step that just ended, `{ tool, object, failed }`
   *   checking  the answer is being checked, or the model sent back to
   *
   * Returns `{ phase, label }`; the phase names how the marks move.
   */
  function phaseOf({ text = '', thinking = false, after = null, checking = false } = {}) {
    if (text) return looksLikeCalls(text) ? { phase: 'choosing', label: 'Choosing the next step' } : { phase: 'writing', label: 'Writing' };
    if (thinking) return { phase: 'reasoning', label: 'Thinking' };
    if (checking) return { phase: 'checking', label: 'Checking its work' };
    if (after && after.tool) {
      if (after.failed) return { phase: 'reading', label: 'Working out what went wrong' };
      const o = brief(after.tool, after.object);
      const say = READING[after.tool];
      return { phase: 'reading', label: say ? say(o) : 'Analyzing the result' };
    }
    return { phase: 'thinking', label: 'Thinking' };
  }

  /**
   * The step that decides what the model reads next, from a turn's calls and
   * their results: the last call that is not a change to the plan, else the
   * last. `objectOf(name, args)` gives what a call worked on. null for none.
   */
  function afterOf(calls, results, objectOf = () => '') {
    const list = Array.isArray(calls) ? calls.filter(Boolean) : [];
    if (!list.length) return null;
    const call = [...list].reverse().find((c) => c.name !== 'update_plan') || list[list.length - 1];
    const got = results && typeof results.get === 'function' ? results.get(call) : null;
    let object = '';
    try { object = objectOf(call.name, call.arguments) || ''; } catch { /* the step's name is enough */ }
    return { tool: call.name, object, failed: typeof got === 'string' && /^\s*\{\s*"error"/.test(got) };
  }

  /** How long, as the line shows it: 7s, 1m 05s. */
  function elapsed(ms) {
    const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  /** How often, at most, the words of an answer being written are drawn again. */
  const DRAW_EVERY = 90;

  /** The mesh: fifteen dots, five across and three down; the stylesheet places and moves them. */
  const MESH = `<span class="cdr-marks" aria-hidden="true">${'<i></i>'.repeat(15)}</span>`;

  /**
   * Start the line in `container`. `render(text)` gives the HTML for words,
   * `scroll()` keeps the newest in view, `began` is when the request was
   * sent (now, when not given). Returns the handle the loop passes to the
   * model call (text, thinking, reset) and ends with finish(kept).
   */
  function start(container, { render = (t) => t, scroll = () => {}, after = null, checking = false, began: since = null } = {}) {
    const began = Number.isFinite(since) && since > 0 && since <= Date.now() ? since : Date.now();
    const el = document.createElement('div');
    el.className = 'cdr-live';
    el.innerHTML = `<div class="cdr-live-status" role="status">${MESH}` +
      `<span class="cdr-live-label"></span><span class="cdr-live-time" aria-hidden="true">${elapsed(Date.now() - began)}</span></div>` +
      '<div class="cdr-live-text cdr-msg-text" hidden></div>';
    container.appendChild(el);
    const labelEl = el.querySelector('.cdr-live-label');
    const timeEl = el.querySelector('.cdr-live-time');
    const textEl = el.querySelector('.cdr-live-text');
    let text = '';
    let reasoning = false;
    let frame = 0;
    let waiting = 0;
    let drawn = 0;
    let done = false;
    // The label and the marks' movement follow what has happened; written only when they change.
    const say = () => {
      const now = phaseOf({ text, thinking: reasoning, after, checking });
      if (el.dataset.phase !== now.phase) el.dataset.phase = now.phase;
      if (labelEl.textContent !== now.label) labelEl.textContent = now.label;
      return now;
    };
    say();
    // A line taken off the page by any other route stops its own clock.
    const tick = setInterval(() => { if (!el.isConnected) { done = true; clearInterval(tick); return; } timeEl.textContent = elapsed(Date.now() - began); }, 1000);

    function paint() {
      frame = 0;
      if (done) return;
      drawn = Date.now();
      const calls = looksLikeCalls(text);
      say();
      textEl.hidden = !text || calls;
      if (!textEl.hidden) textEl.innerHTML = render(text);
      scroll();
    }
    // Words are drawn at most every DRAW_EVERY ms: drawing the whole answer on
    // every frame of a fast one kept the page too busy to scroll smoothly.
    const later = () => {
      if (frame || waiting || done) return;
      const wait = DRAW_EVERY - (Date.now() - drawn);
      if (wait > 0) waiting = setTimeout(() => { waiting = 0; if (!done) frame = requestAnimationFrame(paint); }, wait);
      else frame = requestAnimationFrame(paint);
    };
    scroll();

    return {
      /** More of the answer: `full` is all of it so far. */
      text(delta, full) { text = full != null ? String(full) : text + String(delta || ''); later(); },
      /** The model is thinking before it answers. */
      thinking() { if (!text && !reasoning) { reasoning = true; say(); } },
      /** Another model is being asked: what the last one wrote is gone. */
      reset() { text = ''; reasoning = false; later(); },
      /**
       * End the line. With `kept`, the element stays as that text, a line of
       * the reply; without it, it is removed.
       */
      finish(kept) {
        done = true;
        clearInterval(tick);
        if (frame) cancelAnimationFrame(frame);
        if (waiting) clearTimeout(waiting);
        if (!kept) { el.remove(); return null; }
        el.className = 'cdr-msg-text cdr-said';
        el.innerHTML = render(kept);
        scroll();
        return el;
      },
      remove() { this.finish(''); },
    };
  }

  window.HCCodeLive = { DRAW_EVERY, start, looksLikeCalls, elapsed, phaseOf, afterOf, brief };
})();
