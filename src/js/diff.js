// ==============================================================
// Line diff — what actually changed in a file
//
// Extracted so it can be tested, and because the Coder panel had no diff at
// all: its "View" button opened a box titled diff-preview that printed the new
// file, and for a patch it printed the tool's JSON result. Neither told anyone
// what changed.
//
// Pure: takes two strings, returns rows. No DOM, no storage, no network.
//
// Loaded before app.js and published as window.HCDiff.
// Checked by scripts/checks/diff.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Above this many lines on either side, the middle section is reported as one
   * replaced block instead of being matched line by line.
   *
   * The matcher below is O(n×m). Common prefix and suffix are trimmed first, so
   * an ordinary edit never reaches this — it only bites on a file that was
   * rewritten wholesale, which is exactly the case where a line-by-line diff
   * tells the reader nothing anyway.
   */
  const MAX_MATCHED_LINES = 1500;

  function splitLines(text) {
    const s = String(text == null ? '' : text);
    if (s === '') return [];
    // Normalise line endings so a file saved on Windows does not read as though
    // every single line changed.
    return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  /** Longest common subsequence of two line arrays, as a table of lengths. */
  function lcsTable(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i * cols + j] = a[i] === b[j]
          ? table[(i + 1) * cols + (j + 1)] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
      }
    }
    return { table, cols };
  }

  function walk(a, b, offsetA, offsetB, out) {
    const { table, cols } = lcsTable(a, b);
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ type: 'same', text: a[i], beforeNo: offsetA + i + 1, afterNo: offsetB + j + 1 });
        i++; j++;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
        out.push({ type: 'del', text: a[i], beforeNo: offsetA + i + 1, afterNo: null });
        i++;
      } else {
        out.push({ type: 'add', text: b[j], beforeNo: null, afterNo: offsetB + j + 1 });
        j++;
      }
    }
    while (i < a.length) {
      out.push({ type: 'del', text: a[i], beforeNo: offsetA + i + 1, afterNo: null });
      i++;
    }
    while (j < b.length) {
      out.push({ type: 'add', text: b[j], beforeNo: null, afterNo: offsetB + j + 1 });
      j++;
    }
  }

  /**
   * Compare two versions of a file.
   *
   * Returns one row per line: `same`, `add` or `del`, each carrying the line
   * number it has in the version it belongs to. A row's other number is null,
   * because a removed line has no place in the new file and vice versa.
   */
  function diffLines(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    const out = [];

    // Shared start and end are reported as-is. This is what keeps an ordinary
    // edit cheap: only the part between them is ever matched.
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) tail++;

    for (let i = 0; i < head; i++) {
      out.push({ type: 'same', text: a[i], beforeNo: i + 1, afterNo: i + 1 });
    }

    const midA = a.slice(head, a.length - tail);
    const midB = b.slice(head, b.length - tail);

    if (midA.length > MAX_MATCHED_LINES || midB.length > MAX_MATCHED_LINES) {
      for (let i = 0; i < midA.length; i++) {
        out.push({ type: 'del', text: midA[i], beforeNo: head + i + 1, afterNo: null });
      }
      for (let j = 0; j < midB.length; j++) {
        out.push({ type: 'add', text: midB[j], beforeNo: null, afterNo: head + j + 1 });
      }
    } else if (midA.length || midB.length) {
      walk(midA, midB, head, head, out);
    }

    for (let t = tail - 1; t >= 0; t--) {
      out.push({
        type: 'same',
        text: a[a.length - 1 - t],
        beforeNo: a.length - t,
        afterNo: b.length - t,
      });
    }
    return out;
  }

  /** How many lines the change adds and removes. */
  function countChanges(rows) {
    let added = 0;
    let removed = 0;
    for (const r of rows) {
      if (r.type === 'add') added++;
      else if (r.type === 'del') removed++;
    }
    return { added, removed };
  }

  /**
   * Drop long runs of unchanged lines, keeping `context` of them either side of
   * every change, so a small edit in a large file does not render the whole
   * file. Returns rows with `{ type: 'gap', hidden: n }` markers where lines
   * were left out.
   */
  function collapseUnchanged(rows, context = 3) {
    const keep = new Array(rows.length).fill(false);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type === 'add' || rows[i].type === 'del') {
        for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
          keep[j] = true;
        }
      }
    }
    const out = [];
    let hidden = 0;
    for (let i = 0; i < rows.length; i++) {
      if (keep[i]) {
        if (hidden) { out.push({ type: 'gap', hidden }); hidden = 0; }
        out.push(rows[i]);
      } else {
        hidden++;
      }
    }
    if (hidden) out.push({ type: 'gap', hidden });
    return out;
  }

  window.HCDiff = { diffLines, countChanges, collapseUnchanged, MAX_MATCHED_LINES };
})();
