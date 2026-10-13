// ==============================================================
// A wheel event on a canvas, read as what the hand did
//
// The same "wheel" event carries three different gestures, and a canvas
// that treats them alike is hard to use with all three:
//
//   · a pinch on a trackpad, which the browser sends with ctrlKey set and
//     small steps, many each second. So does Ctrl with a mouse wheel;
//   · a physical mouse wheel, one notch at a time;
//   · two fingers moving on a trackpad, which means "move the view", in any
//     direction, in small steps, many each second.
//
// A canvas that zoomed by a fixed step on every event zoomed wildly under a
// two-finger scroll and could not be moved with one, and a pinch jumped in
// steps rather than following the fingers. Here a pinch zooms as far as the
// fingers moved, a mouse wheel one step for each notch (browsers report a
// notch in very different units, so its size is not read), and a two-finger
// scroll moves the view.
//
// A trackpad is told from a mouse the way WebKit and Chromium report them:
// a trackpad's legacy wheelDeltaY is exactly -3 times its deltaY, a mouse
// notch's is not; where wheelDeltaY is missing, a delta in pixels is a
// trackpad and one in lines or pages a mouse.
//
// Pure: takes the event's numbers, returns what to do. Checked by
// scripts/checks/wheel.mjs. Loaded before the app and every mode, and
// published as window.HCWheel.
// ==============================================================

(function () {
  'use strict';

  /** How much one pixel of pinch zooms, and how much one notch of a mouse wheel. */
  const PINCH = 0.01;
  const NOTCH = 1.12;
  /** No single event zooms by more than this, or less than its inverse. */
  const MOST = 1.35;
  /** Pixels in a line and in a page, for a delta given in either. */
  const LINE = 16;
  const PAGE = 400;

  /** Whether a wheel event came from a trackpad's two fingers rather than a mouse wheel. */
  function fromTrackpad(e) {
    const legacy = Number(e && e.wheelDeltaY);
    if (legacy) return legacy === -3 * Number(e.deltaY);
    return !(e && e.deltaMode);
  }

  /** A delta in pixels, whatever unit it came in. */
  const px = (d, mode) => Number(d || 0) * (mode === 1 ? LINE : mode === 2 ? PAGE : 1);

  /**
   * What a wheel event on a canvas asks for: `{ zoom }`, a factor to zoom by
   * about the pointer (above 1 is closer), or `{ pan: { dx, dy } }`, pixels
   * to move what is shown by, or null for nothing.
   */
  function read(e) {
    if (!e) return null;
    const dx = px(e.deltaX, e.deltaMode), dy = px(e.deltaY, e.deltaMode);
    const clamp = (f) => Math.min(MOST, Math.max(1 / MOST, f));
    if (e.ctrlKey) return dy ? { zoom: clamp(Math.exp(-dy * PINCH)) } : null;
    if (!fromTrackpad(e)) return dy ? { zoom: dy < 0 ? NOTCH : 1 / NOTCH } : null;
    if (e.shiftKey && !dx) return dy ? { pan: { dx: -dy, dy: 0 } } : null;   // Shift turns a vertical scroll sideways
    return dx || dy ? { pan: { dx: -dx, dy: -dy } } : null;
  }

  window.HCWheel = { PINCH, NOTCH, MOST, fromTrackpad, read };
})();
