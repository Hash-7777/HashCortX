// ==============================================================
// Colours a generated system can actually be read in
//
// THE DEFECT. A generated system draws itself in its industry's colours over
// its industry's background, and nothing anywhere measured whether the words
// could be read on it. They largely could not:
//
//   · every quiet label — a date, a field name, a count, the second line of a
//     card — was drawn in one grey, on white, at about two and a half to one.
//     The floor for reading text is four and a half.
//   · every status pill was coloured for a dark background and drawn on a
//     light one. The one that says work is in progress was about two to one.
//   · the heading bar took the industry's colour with white on top of it,
//     whatever that colour was. A pale one gives white on pale.
//
// None of it was a matter of taste. It was arithmetic that nobody had done.
//
// WHAT THIS IS. The arithmetic, as WCAG defines it: the relative luminance of
// a colour, the ratio between two, and — the part that does the work — the
// nearest colour to the one asked for that can be read on a given background.
// A colour is moved towards black or towards white, whichever direction the
// background calls for, and only as far as it must go, so a system still looks
// like itself.
//
// The floors are WCAG AA: 4.5 for text, 3 for large text and for the edges of
// things. Nothing here invents a stricter rule or a looser one.
//
// Pure: colours in, colours out. No DOM, no storage.
//
// Loaded before js/systems/theme.js and published as window.HCSystemsContrast.
// Checked by scripts/checks/systems-contrast.mjs.
// ==============================================================

(function () {
  'use strict';

  /** WCAG AA: text, and large text or the edge of a control. */
  const TEXT = 4.5;
  const LARGE = 3;

  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

  /** A colour as three channels, or null when it is not one this can read. */
  function rgbOf(hex) {
    let h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }

  const hexOf = ([r, g, b]) => `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;

  /** Relative luminance, as WCAG defines it. */
  function luminance(hex) {
    const rgb = rgbOf(hex);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** How far apart two colours are to read, from 1 (the same) to 21. */
  function ratio(a, b) {
    if (!rgbOf(a) || !rgbOf(b)) return 1;
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Whether a colour can be read on a background at the floor given. */
  const readable = (fg, bg, floor = TEXT) => ratio(fg, bg) >= floor;

  /** A colour part of the way towards another. */
  function mix(from, to, t) {
    const a = rgbOf(from);
    const b = rgbOf(to);
    if (!a || !b) return from;
    return hexOf([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t))));
  }

  /**
   * The nearest colour to `fg` that can be read on `bg`.
   *
   * It is moved towards black on a light background and towards white on a
   * dark one, and only as far as it has to go — so a system keeps its own
   * colours and simply stops being unreadable in them. A colour that already
   * meets the floor is returned untouched.
   *
   * Where even black or white cannot reach the floor — which happens only on
   * a mid-grey background — the better of the two is returned, because
   * something readable-as-possible beats something arbitrary.
   */
  function readableOn(fg, bg, floor = TEXT) {
    if (!rgbOf(fg) || !rgbOf(bg)) return fg;
    if (ratio(fg, bg) >= floor) return fg;
    const towards = luminance(bg) > 0.35 ? '#000000' : '#ffffff';
    if (ratio(towards, bg) < floor) {
      const other = towards === '#000000' ? '#ffffff' : '#000000';
      return ratio(other, bg) > ratio(towards, bg) ? other : towards;
    }
    // The smallest move that reaches the floor, to a fortieth of the way.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (ratio(mix(fg, towards, mid), bg) >= floor) high = mid;
      else low = mid;
    }
    return mix(fg, towards, high);
  }

  /** Whichever of two colours reads better on a background — for text on a fill. */
  function pickOn(bg, a = '#ffffff', b = '#0f172a') {
    return ratio(a, bg) >= ratio(b, bg) ? a : b;
  }

  window.HCSystemsContrast = { TEXT, LARGE, ratio, luminance, readable, readableOn, pickOn, mix, rgbOf, hexOf };
})();
