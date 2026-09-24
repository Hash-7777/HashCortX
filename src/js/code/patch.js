// ==============================================================
// Reading and editing a file in place — the text work behind read_file's
// numbered reads and patch_file
//
// patch_file replaces passages of a file with others and writes the file
// back. Three things decide whether that leaves the rest of the file as it
// was, and all three live here, where they can be checked:
//
//   · It starts from the file's real contents. What read_file hands the model
//     is for reading: a long file is cut at 100,000 characters with a note on
//     the end, and a binary file becomes a sentence describing it. Patched and
//     written back, either one would replace the file with that.
//   · The replacement goes in exactly as written. String.prototype.replace
//     reads $$, $& and $` in a replacement string as instructions, so code
//     containing them would be saved as something else.
//   · Line endings stay as they were. In a file written with CRLF, a search
//     written with LF is matched in its CRLF form, rather than the whole file
//     being rewritten with LF. write_file keeps them too (keepLineEndings).
//
// Pure: takes strings and bytes, returns strings. No DOM, no storage.
//
// Loaded before the Coder mode and published as window.HCCodePatch.
// Checked by scripts/checks/code-patch.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many times `needle` occurs in `hay`, not overlapping. */
  function count(hay, needle) {
    if (!needle) return 0;
    let n = 0;
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
    return n;
  }

  /** `hay` with its first `needle` replaced by `text`, taken literally. */
  function spliceOnce(hay, needle, text) {
    const i = hay.indexOf(needle);
    return hay.slice(0, i) + text + hay.slice(i + needle.length);
  }

  /** Bytes from base64, as fs_read_base64 sends them. */
  function bytesFromBase64(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * A file's bytes as text, or an error saying why it cannot be patched.
   *
   * Only UTF-8 text is edited. Anything else would be decoded with its
   * unreadable characters replaced and written back that way, changing parts
   * of the file the patch never touched. A byte-order mark is kept, so it is
   * written back too.
   */
  function textOf(bytes, name) {
    if (bytes.includes(0)) {
      throw new Error(`"${name}" is not a text file, so it cannot be patched.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`"${name}" is not UTF-8 text, so patching it would change characters outside the edit. ` +
        'Leave it, or rewrite it whole with write_file if that is what is wanted.');
    }
  }

  // ── Finding the passage ─────────────────────────────────────────────────
  //
  // A model copies a passage from what it read, and small models copy it
  // imperfectly: the indentation one level off, a space left at the end of a
  // line, the line numbers of a numbered read carried along. Each of those
  // failed the edit, and a failed edit costs a step, often several, and on a
  // small model often the whole task. So the passage is looked for in stages,
  // strictest first, and a looser stage is used only when every stricter one
  // found nothing. Every stage still needs exactly one match: an edit is never
  // applied to a passage that appears twice.

  const lf = (s) => s.replace(/\r\n?/g, '\n');
  const crlfOnly = (s) => s.includes('\r\n') && !/(^|[^\r])\n/.test(s);
  const indentOf = (line) => /^[ \t]*/.exec(line)[0];
  // A line as a numbered read shows it: "  12| text".
  const NUMBERED = /^\s*\d+\| ?/;

  /** The passage as lines, without the empty line a closing newline leaves. */
  function linesOf(text) {
    if (text === '') return [];
    const out = text.split('\n');
    if (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }

  /** Where `want` sits in `have`, line by line, as the starting lines that match. */
  function findLines(have, want, same) {
    const starts = [];
    if (!want.some((l) => l.trim())) return starts;
    for (let i = 0; i + want.length <= have.length; i++) {
      let all = true;
      for (let j = 0; j < want.length && all; j++) all = same(have[i + j], want[j]);
      if (all) starts.push(i);
    }
    return starts;
  }

  /**
   * The replacement moved to the indentation the file really has: the part of
   * each line's indentation the search had is swapped for the file's.
   */
  function reindent(lines, from, to) {
    if (from === to) return lines;
    return lines.map((l) => (l.trim() && l.startsWith(from) ? to + l.slice(from.length) : l));
  }

  /**
   * `content` with its one occurrence of `search` replaced by `replace`, and
   * how the passage was found: '' when as written.
   *
   * Stages: as written; with CRLF endings matched; with all line endings read
   * as LF; with the line numbers of a numbered read taken off; with spaces at
   * the ends of lines ignored; with indentation ignored, the replacement then
   * indented as the file is. Throws a message the model can act on when the
   * passage is not unique, or not there, and then shows the passage most like
   * it with its line numbers.
   */
  function patchWithStage(content, search, replace, name) {
    const unique = (text, find, repl, how) => {
      const n = count(text, find);
      if (n === 1) return spliceOnce(text, find, repl);
      if (n > 1) throw new Error(`search string found ${n} times in "${name}"${how}. Add more surrounding lines to make it unique.`);
      return null;
    };
    let out = unique(content, search, replace, '');
    if (out != null) return { text: out, how: '' };
    if (content.includes('\r\n')) {
      const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
      out = unique(content, crlf(search), crlf(replace), ' with its line endings matched');
      if (out != null) return { text: out, how: 'with its line endings matched' };
    }
    out = unique(lf(content), lf(search), lf(replace), ' with line endings ignored');
    if (out != null) return { text: out, how: 'with line endings ignored' };

    // From here the file is worked on as lines, and written back with the
    // endings it had: CRLF when every line had CRLF, LF otherwise.
    const back = (text) => (crlfOnly(content) ? text.replace(/\n/g, '\r\n') : text);
    const file = lf(content);
    const trailingNewline = file.endsWith('\n');
    const have = linesOf(file);
    let want = linesOf(lf(search));
    let put = linesOf(lf(replace));
    let numbers = '';
    const shown = want.filter((l) => l.trim());
    if (shown.length && shown.every((l) => NUMBERED.test(l))) {
      want = want.map((l) => l.replace(NUMBERED, ''));
      if (put.filter((l) => l.trim()).every((l) => NUMBERED.test(l))) put = put.map((l) => l.replace(NUMBERED, ''));
      numbers = 'with the line numbers of the read taken off';
      const exact = findLines(have, want, (a, b) => a === b);
      if (exact.length > 1) throw new Error(`search string found ${exact.length} times in "${name}" ${numbers}. Add more surrounding lines to make it unique.`);
      if (exact.length === 1) return { text: back(splice(have, exact[0], want.length, put, trailingNewline)), how: numbers };
    }
    const stages = [
      ['with spaces at the ends of lines ignored', (a, b) => a.trimEnd() === b.trimEnd(), false],
      ['with its indentation adjusted to the file', (a, b) => a.trim() === b.trim(), true],
    ];
    for (const [how, same, moveIndent] of stages) {
      const found = findLines(have, want, same);
      const said = numbers ? `${how}, ${numbers}` : how;
      if (found.length > 1) throw new Error(`search string found ${found.length} times in "${name}" ${said}. Add more surrounding lines to make it unique.`);
      if (found.length === 1) {
        const at = found[0];
        const first = want.findIndex((l) => l.trim());
        const lines = moveIndent ? reindent(put, indentOf(want[first]), indentOf(have[at + first])) : put;
        return { text: back(splice(have, at, want.length, lines, trailingNewline)), how: said };
      }
    }
    throw new Error(notFound(content, have, want, name));
  }

  /** The file's lines with `count` of them from `at` replaced. */
  function splice(have, at, n, put, trailingNewline) {
    const lines = have.slice(0, at).concat(put, have.slice(at + n));
    return lines.join('\n') + (trailingNewline && lines.length ? '\n' : '');
  }

  const words = (line) => new Set(String(line).toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean));

  /** How alike two lines are, from 0 to 1, by the words they share. */
  function likeness(a, b) {
    if (a.trim() === b.trim()) return 1;
    const x = words(a);
    const y = words(b);
    if (!x.size || !y.size) return 0;
    let both = 0;
    for (const w of x) if (y.has(w)) both++;
    return both / Math.max(x.size, y.size);
  }

  /**
   * Why the passage was not found, with the passage most like it: the lines
   * of the file, numbered, so the next try can copy them exactly.
   */
  function notFound(content, have, want, name) {
    const probe = want.filter((l) => l.trim());
    let best = -1;
    let bestScore = 0;
    if (probe.length && have.length * probe.length <= 2_000_000) {
      for (let i = 0; i + want.length <= have.length; i++) {
        let score = 0;
        for (let j = 0; j < want.length; j++) score += likeness(have[i + j], want[j]);
        if (score > bestScore) { bestScore = score; best = i; }
      }
    }
    if (best >= 0 && bestScore >= 0.5 * Math.max(1, probe.length)) {
      const from = Math.max(0, best - 2);
      const to = Math.min(have.length, best + want.length + 2);
      const width = String(to).length;
      const passage = have.slice(from, to).map((l, k) => `${String(from + k + 1).padStart(width)}| ${l}`).join('\n');
      return `search string not found in "${name}". The passage most like it is at lines ${best + 1}-${best + want.length}:\n` +
        `${passage}\n\n` +
        'Copy the text exactly as it is there, without the line numbers, and try again.';
    }
    return `search string not found in "${name}".\n` +
      `File begins with:\n${content.slice(0, 600)}\n\n` +
      'Re-read the file with read_file, copy the exact text you want to replace ' +
      '(preserving every space and indent), then retry.';
  }

  /** `content` with its one occurrence of `search` replaced by `replace`. */
  function applyPatch(content, search, replace, name) {
    return patchWithStage(content, search, replace, name).text;
  }

  /**
   * Several edits to one file, applied in order, all of them or none.
   *
   * Each edit is looked for in the file as the edits before it left it. When
   * one cannot be made, the error says which, and nothing is changed: a file
   * with half its edits in is worse than one with none. Returns the new text
   * and, for each edit that needed a looser stage, how it was found.
   */
  function applyEdits(content, edits, name) {
    let text = content;
    const notes = [];
    edits.forEach((e, i) => {
      if (!e || typeof e.search !== 'string' || !e.search) throw new Error(`edit ${i + 1} of ${edits.length} has no search text. Nothing was changed.`);
      if (typeof e.replace !== 'string') throw new Error(`edit ${i + 1} of ${edits.length} has no replace text (use "" to delete). Nothing was changed.`);
      let step;
      try { step = patchWithStage(text, e.search, e.replace, name); }
      catch (err) { throw new Error(edits.length > 1 ? `edit ${i + 1} of ${edits.length}: ${err.message}\nNothing was changed.` : err.message); }
      text = step.text;
      if (step.how) notes.push(edits.length > 1 ? `edit ${i + 1} matched ${step.how}` : `matched ${step.how}`);
    });
    return { text, notes };
  }

  // ── Reading a file by lines ─────────────────────────────────────────────

  /** How long a file is read whole by default, and how much of a longer one is shown. */
  const READ_WHOLE = 400;
  const READ_FIRST = 200;
  const READ_MOST = 500;

  /**
   * Lines `start` to `end` of `text`, numbered, with a line saying where
   * they are in the file and how to read on. A range past the end is pulled
   * back to it; no more than READ_MOST lines are shown at once.
   */
  function linesWindow(text, start, end, name) {
    const lines = linesOf(lf(String(text)));
    const total = lines.length;
    if (!total) return `[${name} is empty.]`;
    const s = Math.min(Math.max(1, Math.floor(Number(start) || 1)), total);
    let e = Math.floor(Number(end) || 0);
    if (!e || e < s) e = s + READ_FIRST - 1;
    e = Math.min(e, total, s + READ_MOST - 1);
    const width = String(e).length;
    const body = lines.slice(s - 1, e).map((l, k) => `${String(s + k).padStart(width)}| ${l}`).join('\n');
    const more = e < total ? ` To read on, call read_file with start_line ${e + 1}.` : '';
    return `[${name}: lines ${s}-${e} of ${total}. The numbers and "| " are not part of the file.${more}]\n${body}`;
  }

  /** Whether a file's text is long enough to be read a window at a time. */
  const isLong = (text) => linesOf(lf(String(text))).length > READ_WHOLE;

  // ── Refusing a write that would break a data file ──────────────────────

  /**
   * Why `after` must not be written over `before`, or '' when it may.
   *
   * A JSON file that parsed before the change and would not parse after it is
   * refused, with where it breaks. One that did not parse before — a settings
   * file with comments, say — is not judged: the change did not break it.
   */
  function breaks(name, before, after) {
    if (!/\.json$/i.test(String(name))) return '';
    const parses = (t) => { try { JSON.parse(String(t).replace(/^﻿/, '')); return true; } catch { return false; } };
    if (before != null && before !== '' && !parses(before)) return '';
    try { JSON.parse(String(after).replace(/^﻿/, '')); return ''; }
    catch (e) { return `This would leave "${name}" as JSON that does not parse (${e.message}), so nothing was written. Fix the edit and try again.`; }
  }

  /**
   * `text` with CRLF line endings when the file it replaces had CRLF on every
   * line and `text` has none.
   *
   * A model writes LF, so a whole-file rewrite of a Windows file changed every
   * line ending in it. Left as written: a file that mixed the two, one with no
   * line endings, and text that already carries a CR — which is how a model
   * that means to write CRLF, or to change a file's endings on purpose, says
   * so. Returns `{ text, kept }`, `kept` true when the endings were changed.
   */
  function keepLineEndings(before, text) {
    const crlfOnly = typeof before === 'string' && before.includes('\r\n') && !/(^|[^\r])\n/.test(before);
    if (!crlfOnly || text.includes('\r') || !text.includes('\n')) return { text, kept: false };
    return { text: text.replace(/\n/g, '\r\n'), kept: true };
  }

  window.HCCodePatch = { applyPatch, applyEdits, textOf, bytesFromBase64, count, keepLineEndings, linesWindow, isLong, breaks };
})();
