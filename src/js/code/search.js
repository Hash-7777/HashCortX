// ==============================================================
// What a search inside the project's files tells the model
//
// grep_code gave back every line it found, up to three hundred, each with
// two lines either side and the file's whole path from the top of the disk,
// written out as indented records. On a project of any size one search came
// to tens of thousands of characters. A smaller model is shown a result of
// that length cut in the middle, so it read the start of a list, a line
// saying the rest was left out, and its end, and worked from that. And
// whatever it was shown was read again at every step after.
//
// A search now answers in the shape a person scans: the files that matched,
// each named once from the project's folder, and under it the lines, by
// number, as one short line each. As many lines are shown as the model can
// use (searchLines, sized in js/agent-context.js). Past that it is told
// which files hold the matches and how many each, with the first line in
// each, and to narrow the search: a folder, a kind of file, a longer
// pattern. A list of places it can read is worth more than a page of lines
// it cannot hold.
//
// Pure: takes the records the search gives, returns a string.
//
// Loaded before the Coder mode and published as window.HCCodeSearch.
// Checked by scripts/checks/code-search.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many lines and files are shown when nothing says otherwise. */
  const DEFAULT = { lines: 60, files: 30 };

  /** A line is shown up to this many characters, its indent left off. */
  const LINE_CHARS = 160;

  /** What the search stops at (src-tauri/src/commands/fs.rs grep_recursive). */
  const SEARCH_STOPS = 300;

  const slash = (p) => String(p == null ? '' : p).replace(/\\/g, '/');

  /** A path as the model writes it: from the project's folder when it is inside it. */
  function place(path, root) {
    const p = slash(path), r = slash(root).replace(/\/+$/, '');
    if (r && p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1);
    return p;
  }

  const shortLine = (text) => {
    const line = String(text == null ? '' : text).replace(/\t/g, '  ').trim();
    return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line;
  };

  /**
   * The matches of one search as the model reads them. `list` is what the
   * search gave: `{ path, line_no, line }`, in the order of the files. An
   * answer that is not a list, a note that nothing was found, is passed on
   * as it is. `limit` is `{ lines, files }`; `dir` the folder searched.
   */
  function shape(list, { pattern = '', root = '', dir = '', limit = DEFAULT } = {}) {
    if (!Array.isArray(list) || !list.length) return list;
    const most = { lines: Math.max(5, (limit && limit.lines) || DEFAULT.lines), files: Math.max(3, (limit && limit.files) || DEFAULT.files) };
    const byFile = new Map();
    for (const m of list) {
      if (!m || m.path == null) continue;
      const at = place(m.path, root);
      if (!byFile.has(at)) byFile.set(at, []);
      byFile.get(at).push(m);
    }
    const files = [...byFile.entries()];
    const stopped = list.length >= SEARCH_STOPS;
    const count = `${stopped ? 'at least ' : ''}${list.length} line${list.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}`;
    const where = dir && place(dir, root) && place(dir, root) !== slash(root).replace(/\/+$/, '') ? ` under ${place(dir, root)}` : '';
    const head = `grep_code "${pattern}"${where}: ${count}.`;

    if (list.length <= most.lines) {
      const out = [head];
      for (const [at, lines] of files) {
        out.push(at);
        for (const m of lines) out.push(`  ${m.line_no}: ${shortLine(m.line)}`);
      }
      out.push('Read around a line with read_file start_line and end_line to see more of it.');
      return out.join('\n');
    }

    // Too many to show each line: where they are, the files with most first, and how to narrow it.
    const ranked = files.slice().sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out = [`${head} Too many to show each line, so here are the files, the most matches first:`];
    for (const [at, lines] of ranked.slice(0, most.files)) out.push(`  ${at}: ${lines.length} line${lines.length === 1 ? '' : 's'}, first at ${lines[0].line_no}`);
    if (ranked.length > most.files) out.push(`  and ${ranked.length - most.files} more file${ranked.length - most.files === 1 ? '' : 's'}.`);
    out.push('Narrow the search to see the lines: set dir to the one folder that matters, set file_ext, or search a longer, more exact pattern, such as the whole name of a function.');
    return out.join('\n');
  }

  window.HCCodeSearch = { shape, place, DEFAULT, LINE_CHARS, SEARCH_STOPS };
})();
