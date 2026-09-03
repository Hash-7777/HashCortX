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


  /**
   * Above this many words on either side, the diff covers only the first 260
   * and reports itself as cut short, so a long edit cannot build an O(n×m)
   * table big enough to stall the message list.
   */
  const MAX_DIFFED_WORDS = 260;

  /**
   * Word-level diff of two pieces of text, used when a message is edited or
   * regenerated so the reader can see what actually changed rather than two
   * walls of prose.
   *
   * Returns { parts, truncated }. Each part is { type: 'same' | 'del' | 'add',
   * word }. Nothing here escapes or marks up anything: the caller renders, so
   * escaping stays in one place in the view and this stays checkable.
   *
   * `truncated` says the words ran past MAX_DIFFED_WORDS and the tail is not
   * described. It used to be worked out by joining the dropped words and
   * asking whether the join contained a space, which answered "no" when
   * exactly one word was dropped: a 261-word edit was cut short and said it
   * was complete. It now compares the counts.
   */
  function diffWords(oldText, newText) {
    const words = (text) => String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const oldAll = words(oldText);
    const newAll = words(newText);
    const truncated = oldAll.length > MAX_DIFFED_WORDS || newAll.length > MAX_DIFFED_WORDS;
    const a = oldAll.slice(0, MAX_DIFFED_WORDS);
    const b = newAll.slice(0, MAX_DIFFED_WORDS);
    if (!a.length && !b.length) return { parts: [], truncated: false };

    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const parts = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { parts.push({ type: 'same', word: b[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { parts.push({ type: 'del', word: a[i] }); i++; }
      else { parts.push({ type: 'add', word: b[j] }); j++; }
    }
    while (i < n) parts.push({ type: 'del', word: a[i++] });
    while (j < m) parts.push({ type: 'add', word: b[j++] });
    return { parts, truncated };
  }

  window.HCDiff = { diffLines, countChanges, collapseUnchanged, diffWords, MAX_MATCHED_LINES, MAX_DIFFED_WORDS };
})();
