// ============================================================
// press.js — whether a click on the 3D Forge canvas picks a part
//
// A click on the canvas picks the part under the pointer, and a click on
// empty space drops the selection. But the browser sends a click at the end
// of every press, including one that dragged. Letting go of a gizmo arrow
// ended the drag on pointer-up, before the click arrived, so the click found
// no drag in progress and nothing under the pointer but the arrows, and read
// as a click on empty space: the selection dropped and the arrows went with
// it. Letting go after turning the camera did the same.
//
// So a click picks only when its press did not take hold of the gizmo, and
// the pointer ended where it began, within a few pixels a hand cannot help.
//
// Pure: no THREE, no DOM. Checked by scripts/checks/forge-press.mjs.
// Loaded before the Forge mode and published as window.HCForgePress.
// ============================================================

(function () {
  'use strict';

  /** How far, in pixels, a pointer may move between press and release and still be a click. */
  const MOVED = 5;

  /**
   * Whether a click picks: `from` and `to` are where the press began and
   * ended, `gizmo` whether the press took hold of the gizmo, `dragging`
   * whether the gizmo is being dragged now. With no press seen, a click is a
   * click.
   */
  function isPick({ from = null, to = null, gizmo = false, dragging = false } = {}) {
    if (gizmo || dragging) return false;
    if (!from || !to) return true;
    return Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y)) <= MOVED;
  }

  window.HCForgePress = { MOVED, isPick };
})();
