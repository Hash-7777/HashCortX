// ==============================================================
// The live line under a HashCoder reply while the model works
//
// Three dots said only that something was waiting. This says what: thinking,
// for how long, and, where the model's answer arrives as it is written (a
// model on this computer), the answer itself as it grows. A tool call being
// written is not shown as text, since it is not words for the person; the
// line says a step is being chosen instead.
//
// When the turn ends the caller decides what stays: the words the model said
// before a step stay in the reply as a line of their own, and everything else
// goes, the answer being drawn in its place.
//
// looksLikeCalls and elapsed are pure and checked by scripts/checks/code-live.mjs;
// start draws into the panel.
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

  /** How long, as the line shows it: 7s, 1m 05s. */
  function elapsed(ms) {
    const s = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  /**
   * Start the line in `container`. `render(text)` gives the HTML for words,
   * `scroll()` keeps the newest in view. Returns the handle the loop passes
   * to the model call (text, thinking, reset) and ends with finish(kept).
   */
  function start(container, { render = (t) => t, scroll = () => {} } = {}) {
    const el = document.createElement('div');
    el.className = 'cdr-live';
    el.innerHTML = '<div class="cdr-live-status"><span class="cdr-live-dot" aria-hidden="true"></span>' +
      '<span class="cdr-live-label">Thinking</span><span class="cdr-live-time">0s</span></div>' +
      '<div class="cdr-live-text cdr-msg-text" hidden></div>';
    container.appendChild(el);
    const labelEl = el.querySelector('.cdr-live-label');
    const timeEl = el.querySelector('.cdr-live-time');
    const textEl = el.querySelector('.cdr-live-text');
    const began = Date.now();
    let text = '';
    let frame = 0;
    let done = false;
    const tick = setInterval(() => { timeEl.textContent = elapsed(Date.now() - began); }, 1000);

    function paint() {
      frame = 0;
      if (done) return;
      const calls = looksLikeCalls(text);
      labelEl.textContent = !text ? 'Thinking' : calls ? 'Choosing the next step' : 'Writing';
      textEl.hidden = !text || calls;
      if (!textEl.hidden) textEl.innerHTML = render(text);
      scroll();
    }
    const later = () => { if (!frame && !done) frame = requestAnimationFrame(paint); };
    scroll();

    return {
      /** More of the answer: `full` is all of it so far. */
      text(delta, full) { text = full != null ? String(full) : text + String(delta || ''); later(); },
      /** The model is thinking before it answers. */
      thinking() { if (!text) { labelEl.textContent = 'Thinking'; } },
      /** Another model is being asked: what the last one wrote is gone. */
      reset() { text = ''; later(); },
      /**
       * End the line. With `kept`, the element stays as that text, a line of
       * the reply; without it, it is removed.
       */
      finish(kept) {
        done = true;
        clearInterval(tick);
        if (frame) cancelAnimationFrame(frame);
        if (!kept) { el.remove(); return null; }
        el.className = 'cdr-msg-text cdr-said';
        el.innerHTML = render(kept);
        scroll();
        return el;
      },
      remove() { this.finish(''); },
    };
  }

  window.HCCodeLive = { start, looksLikeCalls, elapsed };
})();
