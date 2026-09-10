// ==============================================================
// Code fences, read the way the chat draws them
//
// Several parts of the app need to find the code in a model's answer: the
// exports, the PDF writer, the Agent Swarm's preview. Each had written its own
// pattern for it, and each pattern was narrower than the markdown renderer
// that actually draws the chat — so a block in C#, a block whose fence carried
// a title, a tilde fence or a Windows line ending showed as code on screen and
// was missed wherever the app went looking for code.
//
// Missing a block was not the worst of it. A pattern that fails to match a
// block's opening fence keeps scanning, and can take that block's CLOSING
// fence as an opening one — pairing it with the next block's opening fence.
// Everything after that point is then read inside out: prose framed as code,
// code left as prose.
//
// This follows the renderer's rules line by line, including the places where
// it departs from the specification, because agreeing with the screen is the
// point. scripts/checks/fences.mjs runs the real renderer beside it.
//
// Pure: takes text, returns pieces of it. No DOM, no network.
//
// Loaded before everything that reads code out of text, and published as
// window.HCFences.
// ==============================================================

(function () {
  'use strict';

  /** An opening fence: up to three spaces, three or more backticks or tildes, then the info line. */
  const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
  const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

  /** A run of exactly `n` backticks on a line. */
  const hasRun = (line, n) => new RegExp('(^|[^`])`{' + n + '}(?!`)').test(line);

  /**
   * The text cut into pieces: prose, and fenced code, in order.
   *
   * Prose pieces are the original text exactly, line endings included, so a
   * caller can put everything back together around the code. A code piece
   * carries its language — the first word after the fence — the whole info
   * line, and the code with the fence lines removed.
   *
   * The renderer's rules: a fence is three or more backticks or tildes; it is
   * closed by a fence of the same character at least as long with nothing after
   * it but spaces; a backtick fence's info line may not contain a backtick, and
   * a backtick run that cannot open a fence opens an inline span instead, which
   * the same run later in the paragraph closes; an indented backtick fence
   * takes its indentation off the lines inside it that have that much; and a
   * block left open runs to the end of the text.
   */
  function splitFences(text) {
    const src = String(text == null ? '' : text);
    const lines = src.split(/(?<=\n)/);
    const pieces = [];
    let prose = '';
    let open = null;
    let span = 0;

    const bare = (line) => line.replace(/\r?\n$/, '');
    const flushProse = () => { if (prose) { pieces.push({ type: 'text', text: prose }); prose = ''; } };
    const closeBlock = () => {
      pieces.push({ type: 'code', lang: open.lang, info: open.info, code: open.body.join('\n') });
      open = null;
    };

    for (const raw of lines) {
      const line = bare(raw);
      if (open) {
        const close = CLOSE.exec(line);
        if (close && close[1][0] === open.char && close[1].length >= open.size) { closeBlock(); continue; }
        const lead = /^\s*/.exec(line)[0].length;
        const strip = open.char === '`' && open.indent && lead >= open.indent;
        open.body.push(strip ? line.slice(open.indent) : line);
        continue;
      }
      if (!line.trim()) { span = 0; prose += raw; continue; }
      if (span) {
        if (hasRun(line, span)) span = 0;
        prose += raw;
        continue;
      }
      const m = OPEN.exec(line);
      if (!m) { prose += raw; continue; }
      const fence = m[2];
      const info = m[3];
      if (fence[0] === '`' && info.includes('`')) {
        if (!hasRun(info, fence.length)) span = fence.length;
        prose += raw;
        continue;
      }
      flushProse();
      open = { char: fence[0], size: fence.length, indent: m[1].length, info: info.trim(), lang: info.trim().split(/\s+/)[0] || '', body: [] };
    }
    if (open) closeBlock();
    flushProse();
    return pieces;
  }

  /** Just the code blocks, in order. */
  function codeBlocks(text) {
    return splitFences(text).filter((p) => p.type === 'code').map(({ lang, info, code }) => ({ lang, info, code }));
  }

  window.HCFences = { splitFences, codeBlocks };
})();
