// ==============================================================
// Which controls stay in a bar, and which go behind a menu
//
// THE DEFECT THIS FIXES. The ERP bar held nine controls in a row of a fixed
// height, allowed to wrap, with everything past that height cut off. So the
// controls did not get smaller as the window narrowed — they wrapped onto a
// second and a third row and were cut away, with nothing left on screen to say
// they existed or to reach them. On a full-height window, the last two were
// already gone. "Reset data" and "Back" simply were not there, and resizing
// the window took more of them.
//
// A control that has been cut off is worse than one that was never offered:
// the app still believes it is on screen, so nothing else stands in for it.
//
// WHAT HAPPENS INSTEAD. The bar is measured, and what does not fit moves into
// a menu at its end — still reachable, in its own order, one click away. What
// fits stays where it was. Nothing is ever cut off, and nothing is dropped.
//
// The controls that must not move are named by the caller, not decided here:
// a bar without the button that does the work is not a bar that fits, it is a
// bar that no longer works.
//
// Pure: widths in, two lists of keys out. No DOM, no measuring of its own —
// the caller measures, so this can be checked without a browser.
//
// Loaded before the modes and published as window.HCToolbarFit.
// Checked by scripts/checks/toolbar-fit.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Which of `items` fit across `available` pixels, and which do not.
   *
   * `items` are given in the order they are shown, left to right, each with
   * its own measured `width` and, where it must never move, `keep`. An item
   * with no width — one that is hidden at the moment — takes no space and is
   * never moved into the menu, because it is not on screen to be moved.
   *
   * What does not fit is taken from the RIGHT, which is where a bar puts the
   * things it needs least, and it keeps its order in the menu.
   *
   * Returns `{ shown, hidden }` as arrays of keys. `hidden` being empty means
   * the menu itself is not needed and should not be shown either.
   */
  function fit(available, items, { gap = 0, menuWidth = 0 } = {}) {
    const all = (Array.isArray(items) ? items : []).filter((it) => it && it.key != null);
    const present = all.filter((it) => Number(it.width) > 0);
    const absent = all.filter((it) => !(Number(it.width) > 0)).map((it) => it.key);
    const keyOf = (it) => it.key;

    const spanOf = (list, extra) => {
      const count = list.length + (extra ? 1 : 0);
      if (!count) return 0;
      const widths = list.reduce((sum, it) => sum + Number(it.width), 0) + (extra || 0);
      return widths + gap * (count - 1);
    };

    const room = Number(available);
    // Nothing measurable to lay out against: leave the bar exactly as it is
    // rather than emptying it on a bad number.
    if (!Number.isFinite(room) || room <= 0) return { shown: all.map(keyOf), hidden: [] };
    if (spanOf(present, 0) <= room) return { shown: all.map(keyOf), hidden: [] };

    const staying = [...present];
    const hidden = [];
    while (spanOf(staying, menuWidth) > room) {
      let at = -1;
      for (let i = staying.length - 1; i >= 0; i--) { if (!staying[i].keep) { at = i; break; } }
      // Only controls that must not move are left. They stay: a bar that has
      // lost the button that does the work has not been made to fit.
      if (at < 0) break;
      hidden.unshift(staying[at].key);
      staying.splice(at, 1);
    }
    // An item that is hidden at the moment stays counted as shown, so that it
    // returns to the bar rather than to the menu when it comes back.
    const staySet = new Set([...staying.map(keyOf), ...absent]);
    return { shown: all.map(keyOf).filter((k) => staySet.has(k)), hidden };
  }

  window.HCToolbarFit = { fit };
})();
