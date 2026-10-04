// ==============================================================
// Following a HashCoder answer as it is written, and letting go
//
// The conversation used to be moved to its last line on every frame of an
// answer. Scrolling up to read something earlier was pulled straight back
// down, and the two fought each other, which read as the panel stuttering.
//
// It now follows the answer only while the reader is at the end of the
// conversation. Scrolling up, by the wheel, a key or a finger, lets go at
// once; scrolling back down to the end follows again. A new request is
// always shown, since the person has just sent it.
//
// Being at the end is judged from where the scroll stands, never from a
// guess: content that shrinks (a live line taken away) leaves the list at
// its end, so it does not count as the reader moving up.
//
// `atEnd` and `next` are pure and checked by scripts/checks/code-follow.mjs;
// `create` listens to the list. Loaded before the Coder mode and published
// as window.HCCodeFollow.
// ==============================================================

(function () {
  'use strict';

  /** How close to the end, in pixels, still counts as being at it. */
  const SLACK = 4;

  /** Whether a list scrolled to `top`, `height` tall in a `view` that tall, is at its end. */
  function atEnd({ top = 0, height = 0, view = 0 } = {}, slack = SLACK) {
    return height - view - top <= slack;
  }

  /**
   * Whether to follow after the list moved: at the end, yes; moved up from
   * where it was, no; otherwise as before.
   */
  function next(following, { top, height, view, lastTop }) {
    if (atEnd({ top, height, view })) return true;
    if (top < lastTop) return false;
    return following;
  }

  /**
   * Follow the list `listOf()` returns. Returns `{ keep(), toEnd(), following }`:
   * keep() moves it to the end only while following, toEnd() moves it there
   * and follows again.
   */
  function create(listOf) {
    let following = true;
    let lastTop = 0;
    let bound = null;
    const measure = (el) => ({ top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight });
    function bind(el) {
      if (bound === el) return;
      bound = el;
      lastTop = el.scrollTop;
      el.addEventListener('scroll', () => {
        following = next(following, { ...measure(el), lastTop });
        lastTop = el.scrollTop;
      }, { passive: true });
      // The wheel lets go before the list has moved, so a turn of it during a
      // fast answer is not undone by the next frame.
      el.addEventListener('wheel', (e) => { if (e.deltaY < 0) following = false; }, { passive: true });
    }
    function toBottom(el) { el.scrollTop = el.scrollHeight; lastTop = el.scrollTop; }
    return {
      keep() { const el = listOf(); if (!el) return; bind(el); if (following) toBottom(el); },
      toEnd() { const el = listOf(); if (!el) return; bind(el); following = true; toBottom(el); },
      get following() { return following; },
    };
  }

  window.HCCodeFollow = { SLACK, atEnd, next, create };
})();
