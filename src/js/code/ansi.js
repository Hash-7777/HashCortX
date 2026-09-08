// ==============================================================
// Terminal colour, turned into HTML
//
// The Coder terminal shows the output of real commands, and real commands
// colour their output with escape sequences. This turns those into markup.
//
// It is written as a running style rather than a stack of open tags, because a
// terminal's colours replace one another — a line that turns red and then
// green is green, not green inside red. Nesting them instead grew the markup
// without limit down a long build log, and the reset that was meant to unwind
// it could not: the loop that closed the open tags never took any off the
// stack it was testing, so the commonest sequence in terminal output — colour
// something, then reset — never finished. It ran until the memory did.
//
// Everything that is not an escape sequence is escaped before it goes out.
// This is the output of a command, and a command can print anything.
//
// Pure: takes text, returns markup. No DOM, no network.
//
// Loaded before the Coder mode and published as window.HCCodeAnsi.
// Checked by scripts/checks/code-ansi.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The eight standard colours and their bright forms. */
  const COLORS = {
    30: '#6b6b78', 31: '#d98a85', 32: '#5fb88a', 33: '#f5c97a',
    34: '#6ab4ff', 35: '#c084fc', 36: '#4bd2be', 37: '#e8e8ec',
    90: '#4a4a55', 91: '#ff8f8f', 92: '#7dd3a8', 93: '#fde68a',
    94: '#93c5fd', 95: '#d8b4fe', 96: '#99f6e4', 97: '#ffffff',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const clampByte = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));

  /**
   * Apply one run of parameters to the running style.
   *
   * The extended-colour forms carry their own arguments — 38;2;R;G;B for a true
   * colour, 38;5;N for one of 256 — and those arguments have to be taken off
   * the list rather than read as codes in their own right. Read as codes, the 2
   * in a true colour was taken for "dim", so every coloured line from a modern
   * tool came out faint and left a tag open behind it.
   */
  function applyCodes(codes, style) {
    for (let i = 0; i < codes.length; i++) {
      const code = Number(codes[i]);
      if (code === 0) { style.color = null; style.bold = false; style.dim = false; style.underline = false; continue; }
      if (code === 1) { style.bold = true; continue; }
      if (code === 2) { style.dim = true; continue; }
      if (code === 4) { style.underline = true; continue; }
      if (code === 22) { style.bold = false; style.dim = false; continue; }
      if (code === 24) { style.underline = false; continue; }
      if (code === 39) { style.color = null; continue; }
      if (COLORS[code]) { style.color = COLORS[code]; continue; }
      if (code === 38 || code === 48) {
        const kind = Number(codes[i + 1]);
        if (kind === 2) {
          const r = clampByte(codes[i + 2]);
          const g = clampByte(codes[i + 3]);
          const b = clampByte(codes[i + 4]);
          if (code === 38) style.color = 'rgb(' + r + ',' + g + ',' + b + ')';
          i += 4;
        } else if (kind === 5) {
          if (code === 38) style.color = colorFrom256(Number(codes[i + 2]));
          i += 2;
        } else {
          i += 1;
        }
      }
      // Anything else — backgrounds, blink, and the rest — is left out rather
      // than half-read.
    }
  }

  /** One of the 256 palette colours, as something a browser can draw. */
  function colorFrom256(n) {
    const i = Math.max(0, Math.min(255, Math.round(n || 0)));
    if (i < 16) return COLORS[i < 8 ? 30 + i : 90 + (i - 8)] || '#e8e8ec';
    if (i < 232) {
      const c = i - 16;
      const ramp = [0, 95, 135, 175, 215, 255];
      return 'rgb(' + ramp[Math.floor(c / 36)] + ',' + ramp[Math.floor(c / 6) % 6] + ',' + ramp[c % 6] + ')';
    }
    const grey = clampByte(8 + (i - 232) * 10);
    return 'rgb(' + grey + ',' + grey + ',' + grey + ')';
  }

  /** The CSS for a style, or an empty string when it is plain text. */
  function styleAttr(style) {
    const parts = [];
    if (style.color) parts.push('color:' + style.color);
    if (style.bold) parts.push('font-weight:600');
    if (style.dim) parts.push('opacity:0.6');
    if (style.underline) parts.push('text-decoration:underline');
    return parts.join(';');
  }

  /**
   * Turn a line of terminal output into HTML.
   *
   * One span per run of text, closed before the next one opens, so the markup
   * cannot grow deeper the longer the output runs.
   */
  function ansiToHtml(text) {
    if (text == null || text === '') return esc(text);
    const s = String(text);
    if (s.indexOf('\x1b[') === -1) return esc(s);

    const style = { color: null, bold: false, dim: false, underline: false };
    const re = /\x1b\[([0-9;]*)m/g;
    let out = '';
    let last = 0;
    let m;

    const emit = (chunk) => {
      if (!chunk) return;
      const css = styleAttr(style);
      out += css ? '<span style="' + css + '">' + esc(chunk) + '</span>' : esc(chunk);
    };

    while ((m = re.exec(s)) !== null) {
      emit(s.slice(last, m.index));
      // A bare escape with no parameters is a reset, which is what a terminal
      // does with it.
      applyCodes(m[1] ? m[1].split(';') : ['0'], style);
      last = re.lastIndex;
    }
    emit(s.slice(last));
    return out;
  }

  /**
   * Escape sequences removed altogether, for anywhere that wants plain text.
   *
   * Covers the cursor moves and screen clears as well as the colours, since
   * none of them mean anything outside a terminal.
   */
  function stripAnsi(text) {
    if (text == null) return text;
    return String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
  }

  window.HCCodeAnsi = { ansiToHtml, stripAnsi, esc };
})();
