// ==============================================================
// Following words as they are written, and letting go
//
// A list that moves to its last line every time something is added fights a
// reader who scrolls up to read something earlier: each new word pulls the
// list back down, and the scroll seems stuck. The same happens when "near
// the end" is judged by distance alone, since a small scroll up is still
// near the end and is undone by the next word.
//
// So a list follows what is written only while the reader is at its end.
// Scrolling up, by the wheel, a key, a finger or the scroll bar, lets go at
// once; scrolling back down to the end follows again. A message the person
// has just sent is always shown (toEnd), since they have just sent it.
//
// Being at the end is judged from where the scroll stands, never from a
// guess: content that shrinks (a live line taken away) leaves the list at
// its end, so it does not count as the reader moving up.
//
// Every place in the app that shows text as it arrives scrolls through here:
// the chat, HashCoder, the Agent Swarm, the ERP's agent, 3D Forge, Finance,
// the Sandbox, and the trace and terminal panels.
//
// `atEnd` and `next` are pure; `create`, `keep` and `toEnd` listen to the
// list. Checked by scripts/checks/follow.mjs. Loaded before the app and every
// mode, and published as window.HCFollow.
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

  // One follower for each list, made the first time the list is scrolled
  // through here, and gone with the list.
  const followers = new WeakMap();
  const followerOf = (el) => {
    let f = followers.get(el);
    if (!f) { f = create(() => el); followers.set(el, f); }
    return f;
  };

  /** Keep `el` at its end while the reader is there; leave it where they put it otherwise. */
  function keep(el) { if (el) followerOf(el).keep(); }

  /** Move `el` to its end and follow it again: for something the person has just sent. */
  function toEnd(el) { if (el) followerOf(el).toEnd(); }

  /** Whether `el` is following what is written (a list never scrolled here is). */
  const following = (el) => !el || !followers.has(el) || followers.get(el).following;

  window.HCFollow = { SLACK, atEnd, next, create, keep, toEnd, following };
})();
