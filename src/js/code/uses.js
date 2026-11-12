// ==============================================================
// Who uses a name, in one answer
//
// Before changing what a function takes, or renaming it, a model has to
// know where it is defined and every place that uses it. It found out with
// a search for the name, which also brought back every longer name that
// starts the same way, and then read file after file to tell the
// definition from the uses. uses_of answers it in one call: where the name
// is defined, with its parameters, and each place that uses it, by file and
// line, from one search of the project and the map's own reading of a line
// (js/code/codemap.js definitions). Only whole names count. The answer is
// sized like a search (js/code/search.js), and past what the model can use
// it says how many places are left and how to narrow it.
//
// Pure: takes the search's matches, returns the answer as text. The search
// itself is the app's own, inside the project and never asking
// (platform/tauri/hashcoder.js linesQuietly).
//
// Published as window.HCCodeUses. Checked by scripts/checks/code-uses.mjs.
// ==============================================================

(function () {
  'use strict';

  /** What the native search stops at (src-tauri/src/commands/fs.rs). */
  const SEARCH_STOPS = 300;
  /** How many lines and files are shown when nothing says otherwise. */
  const DEFAULT = { lines: 60, files: 30 };
  /** No more definitions than this are listed. */
  const MOST_DEFINED = 5;
  /** A line is shown up to this many characters, its indent left off. */
  const LINE_CHARS = 160;

  /** A name as code writes it: letters, digits, _ and $, optionally after a class and a dot or `::`. */
  const NAME = /^[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)*$/;
  const isName = (name) => typeof name === 'string' && name.length <= 120 && NAME.test(name);
  /** The part of a name a file would write on its own: `rate` of `Rooms.rate`. */
  const keyOf = (name) => String(name).split(/::|\./).pop();
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const counted = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const place = (path, root) => (window.HCCodeSearch ? window.HCCodeSearch.place(path, root) : String(path).replace(/\\/g, '/'));
  const short = (text) => {
    const line = String(text == null ? '' : text).replace(/\t/g, '  ').trim();
    return line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line;
  };

  /** What a matched line defines under `key`, by the map's reading of it, or null. */
  function definedOn(m, key) {
    const D = window.HCCodeMap;
    if (!D) return null;
    const lang = D.langOf(String(m.path));
    return lang ? D.definitions(String(m.line == null ? '' : m.line), lang).find((d) => keyOf(d.name) === key) || null : null;
  }

  /**
   * uses_of's answer for `name`, from the search's `matches` (`{ path,
   * line_no, line }`): where it is defined and each place that uses it, by
   * file, at most `limit.lines` lines across `limit.files` files.
   */
  function answer(name, matches, { root = '', limit = DEFAULT } = {}) {
    if (!isName(name)) return 'uses_of needs one name as code writes it, such as getNightlyRate or Rooms.rate, with no spaces or brackets.';
    const key = keyOf(name);
    const whole = new RegExp(`(^|[^\\w$])${escape(key)}(?![\\w$])`);
    const all = (Array.isArray(matches) ? matches : []).filter((m) => m && m.path != null && whole.test(String(m.line == null ? '' : m.line)));
    if (!all.length) return `uses_of "${name}": not found in the project's files. Folders of dependencies and build output, and what the project ignores, are not searched.`;
    const defined = [], used = [];
    for (const m of all) {
      const d = definedOn(m, key);
      if (d) defined.push({ m, d }); else used.push(m);
    }
    const files = [], byFile = new Map();
    for (const m of used) {
      const p = place(m.path, root);
      if (!byFile.has(p)) { byFile.set(p, []); files.push(p); }
      byFile.get(p).push(m);
    }
    const lines = Math.max(1, Number(limit && limit.lines) || DEFAULT.lines);
    const most = Math.max(1, Number(limit && limit.files) || DEFAULT.files);
    const per = Math.max(1, Math.ceil(lines / Math.min(most, files.length || 1)));
    const out = [`uses_of "${name}": defined in ${counted(defined.length, 'place')}, used in ${counted(used.length, 'place')} in ${counted(files.length, 'file')}.`];
    if (all.length >= SEARCH_STOPS) out.push(`The search stopped at ${SEARCH_STOPS} matches: this name is common, so not every use is here. Narrow it with grep_code in one folder or with file_ext.`);
    if (defined.length) {
      out.push('Defined:');
      for (const { m, d } of defined.slice(0, MOST_DEFINED)) out.push(`  ${place(m.path, root)}:${m.line_no}  ${window.HCCodeMap.label(d)}`);
    } else {
      out.push('Defined: not in the files searched; it may come from a dependency.');
    }
    if (!used.length) return out.join('\n');
    out.push('Used:');
    const shownIn = new Map();
    let shown = 0;
    for (const p of files.slice(0, most)) {
      if (shown >= lines) break;
      const take = byFile.get(p).slice(0, Math.min(per, lines - shown));
      out.push(p);
      for (const m of take) out.push(`  ${m.line_no}: ${short(m.line)}`);
      shown += take.length;
      shownIn.set(p, take.length);
    }
    const left = used.length - shown;
    if (left > 0) {
      const inFiles = files.filter((p) => (shownIn.get(p) || 0) < byFile.get(p).length).length;
      out.push(`[${counted(left, 'more place')} in ${counted(inFiles, 'file')} not shown: narrow it with grep_code in one folder or with file_ext, or read the files above.]`);
    }
    return out.join('\n');
  }

  window.HCCodeUses = { SEARCH_STOPS, DEFAULT, MOST_DEFINED, isName, answer };
})();
