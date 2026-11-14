// ==============================================================
// A reply written as it arrives
//
// A reply used to be drawn as raw text while it streamed: its marks for bold
// and code, its list dashes and table pipes on show, every word at once as
// the provider sent it, and then the whole answer jumped into its formatted
// shape when it was done. Read while it was being written, it looked broken.
//
// Here it is formatted from its first word, by the same formatter the
// finished reply uses, and it is shown at a reading pace: a few characters a
// frame, a whole word at a time, quicker when more has arrived than is shown
// so it never falls far behind. What cannot be formatted yet is held back
// rather than shown as marks: a bold or code mark not yet closed, half a
// link, a table whose rule line has not arrived, a heading with no words yet.
// When the reply is done the app draws it once more, whole, and that drawing
// matches what was already on screen.
//
// Pure apart from the frame clock it is handed. Published as
// window.HCLiveText. Checked by scripts/checks/live-text.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Held back when what it opens is no longer than this; past it, the mark itself is dropped and the words shown. */
  const HOLD = 120;

  /**
   * The arrived text as it can be shown formatted now. A mark that opens
   * something not yet closed is held back with what follows it, so it never
   * shows as a mark and then changes into formatting.
   */
  function settled(text) {
    const t = String(text || '');
    // Code blocks are read by the reader the formatter's rules are written into (js/fences.js).
    const pieces = window.HCFences ? window.HCFences.splitFences(t) : [{ type: 'text', text: t }];
    const last = pieces[pieces.length - 1];
    // Only the words after the last code block can hold a mark still open, and of
    // them only the paragraph still being written. Inside a code block still open
    // there are none: everything is code, and the formatter closes it.
    const prose = last && last.type === 'text' ? last.text : '';
    const cut = prose.lastIndexOf('\n\n');
    const head = t.slice(0, t.length - prose.length) + (cut >= 0 ? prose.slice(0, cut + 2) : '');
    let tail = cut >= 0 ? prose.slice(cut + 2) : prose;
    // A table before its rule line is pipes and words: held until the rule arrives.
    if (/^\s*\|/.test(tail) && !/^\s*\|?\s*:?-{3,}/m.test(tail)) return head.replace(/\s+$/, '');
    // A last line that is only the start of a mark: a heading's hashes, a list's dash, a quote's angle.
    tail = tail.replace(/(^|\n)[ \t]*(?:#{1,6}|[-*+]|\d+[.)]|>|\|)?[ \t]*$/, '$1');
    // Half a link or picture: from its opening bracket.
    const link = /!?\[[^\]\n]*(?:\]\([^)\n]*)?$/.exec(tail);
    if (link && tail.length - link.index <= HOLD * 2) tail = tail.slice(0, link.index);
    // A bold, italic or code mark still open.
    for (const mark of ['**', '__', '`']) tail = closeOrHold(tail, mark);
    return (head + tail).replace(/\s+$/, '');
  }

  /** `text` with an unmatched last `mark` held back with what follows it, or dropped when that is long. */
  function closeOrHold(text, mark) {
    const parts = text.split(mark);
    if (parts.length % 2 === 1) return text;   // every one closed
    const at = text.lastIndexOf(mark);
    const after = text.length - at - mark.length;
    return after <= HOLD ? text.slice(0, at) : text.slice(0, at) + text.slice(at + mark.length);
  }

  /** How many characters to add this frame: two at least, and a tenth of what is waiting, so it catches up. */
  const stepOf = (waiting) => Math.max(2, Math.ceil(waiting / 10));

  /** Where to stop showing after adding `n` characters from `from`: at the end of a word, never in one. */
  function nextStop(text, from, n) {
    const t = String(text || '');
    let at = Math.min(t.length, from + Math.max(1, n));
    const word = /\S/;
    let reach = 0;
    while (at < t.length && word.test(t[at]) && reach < 24) { at++; reach++; }
    return at;
  }

  /**
   * One reply as it arrives. `push(text)` gives what has arrived so far;
   * `paint(text)` is called with what to draw, formatted-ready, at most
   * every `every` milliseconds while there is something new, sooner for a
   * short reply; `stop()` ends it. A text that does not carry on from the
   * last one, such as a note while another model starts, is drawn at once.
   */
  function create({ paint, raf, cancel, now, reduced = false } = {}) {
    const frameOf = raf || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)));
    const unframe = cancel || ((id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)));
    const clock = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    let target = '', shown = 0, frame = 0, drawn = null, lastPaint = -Infinity;
    // A longer reply costs more to format, so it is drawn less often; never less than eight times a second.
    const every = () => Math.min(125, Math.max(33, target.length / 120));
    function tick() {
      frame = 0;
      if (shown < target.length) shown = reduced ? target.length : nextStop(target, shown, stepOf(target.length - shown));
      const text = settled(target.slice(0, shown));
      const t = clock();
      if (text !== drawn && (t - lastPaint >= every() || shown >= target.length)) {
        drawn = text;
        lastPaint = t;
        paint(text);
      }
      if (shown < target.length || text !== drawn) frame = frameOf(tick);
    }
    return {
      push(text) {
        const next = String(text == null ? '' : text);
        if (!next.startsWith(target.slice(0, shown))) shown = next.length;   // not a continuation: drawn whole, at once
        target = next;
        if (!frame) frame = frameOf(tick);
      },
      stop() { if (frame) unframe(frame); frame = 0; },
      get shown() { return shown; },
    };
  }

  /**
   * Draw `html`, the formatted text, into a reply's bubble, in the shape the
   * finished reply has: the folded thinking first when there is any (made by
   * `thought()` once, so opening it while the reply is written keeps it open),
   * then the body. A mark at the end says it is still being written.
   */
  function into(bubble, html, thought) {
    if (!bubble) return null;
    bubble.classList.remove('thinking-bubble');
    let body = bubble.querySelector(':scope > .msg-body.live');
    if (!body) {
      bubble.textContent = '';
      const t = typeof thought === 'function' ? thought() : null;
      if (t) bubble.appendChild(t);
      body = bubble.ownerDocument.createElement('div');
      body.className = 'msg-body live';
      bubble.appendChild(body);
    }
    body.innerHTML = html;
    const caret = bubble.ownerDocument.createElement('span');
    caret.className = 'live-caret';
    caret.setAttribute('aria-hidden', 'true');
    // At the end of the last words written, inside their paragraph, item or bold;
    // after a block of code, a table or a picture rather than inside it.
    let end = body;
    while (end.lastElementChild && !/^(?:PRE|TABLE|IMG|SVG|HR|BR)$/i.test(end.lastElementChild.tagName)) end = end.lastElementChild;
    end.appendChild(caret);
    return body;
  }

  window.HCLiveText = { HOLD, settled, stepOf, nextStop, create, into };
})();
