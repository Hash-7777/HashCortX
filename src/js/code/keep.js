// ==============================================================
// What an edit took away that the request did not ask about
//
// Asked to change part of a file, a model often rewrites more than it was
// asked to, and something the person wanted is gone: a function, a section
// of a page, a table, a heading or a picture in a README. Nothing said so.
// Each write is compared here with what the file held before, with no
// model: the functions, classes and types a code file defines
// (js/code/codemap.js), the ids and the sections, tables, forms and
// navigation of a page, and the headings and pictures of a Markdown file.
// What is gone, and not named anywhere in the request, even in part, is
// said in the tool's answer, with a request to put it back if it was not
// asked for. It is a note, never a refusal: removing something is often
// the very change asked for.
//
// What the request itself says to leave as it is, is a refusal. Told "do
// not change the tests", a small model whose code failed a test changed the
// test instead, and said the tests passed. A request that says to leave the
// tests, or a file it names, as they are has every change to them refused
// (leftAlone), with what to change instead. Only the request's own words
// decide it; nothing is guessed.
//
// Pure. Loaded before the Coder mode and published as window.HCCodeKeep.
// Checked by scripts/checks/code-keep.mjs.
// ==============================================================

(function () {
  'use strict';

  /** At most this many removed things are named in one note. */
  const MOST_NAMED = 6;

  /** The parts of a page a person would miss. */
  const PAGE_PARTS = ['section', 'table', 'form', 'nav', 'header', 'footer', 'aside', 'article', 'main', 'dialog'];

  const counts = (list) => list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());

  /** What a file holds that a person would notice gone, as named things. */
  function inventory(name, text) {
    const t = String(text == null ? '' : text);
    const n = String(name || '').toLowerCase();
    const things = [];
    const M = typeof window !== 'undefined' && window.HCCodeMap;
    const lang = M && M.langOf(n);
    if (lang) M.definitions(t, lang).forEach((d) => things.push(M.label({ kind: d.kind, name: d.name })));
    if (/\.html?$/.test(n)) {
      for (const m of t.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) things.push(`#${m[1]}`);
      for (const m of t.matchAll(new RegExp(`<(${PAGE_PARTS.join('|')})\\b`, 'gi'))) things.push(`<${m[1].toLowerCase()}>`);
    }
    if (/\.(?:md|markdown)$/.test(n)) {
      for (const m of t.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) things.push(`the "${m[1]}" heading`);
      for (const m of t.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)) things.push(`the picture ${m[2]}${m[1].trim() ? ` ("${m[1].trim()}")` : ''}`);
      for (const m of t.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) things.push(`the picture ${m[1]}`);
    }
    return things;
  }

  /** The named things in `before` that `after` holds fewer of, in their order. */
  function removed(name, before, after) {
    if (before == null) return [];
    const was = inventory(name, before), now = counts(inventory(name, after));
    const left = new Map(now);
    const gone = [];
    for (const thing of was) {
      if (left.get(thing) > 0) left.set(thing, left.get(thing) - 1);
      else if (!gone.includes(thing)) gone.push(thing);
    }
    return gone;
  }

  /** The words a thing is named by: "renderHeader" gives render and header; "#site-footer" gives site and footer. */
  const wordsOf = (thing) => String(thing).replace(/^the (?:picture |")|" heading$|^(?:class|interface|type|enum|struct|trait|union|record|object|protocol|actor|module) |^[#<]|>$/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3);

  /** Whether the request names a thing, or any word of its name. */
  const named = (thing, request) => {
    const r = String(request || '').toLowerCase();
    return !!r && (r.includes(String(thing).toLowerCase()) || wordsOf(thing).some((w) => new RegExp(`\\b${w}`, 'i').test(r)));
  };

  /**
   * The note for the tool's answer when a write took away something the
   * request does not name, or ''. `name` is the file's name.
   */
  function note(name, before, after, request) {
    const gone = removed(name, before, after).filter((t) => !named(t, request));
    if (!gone.length) return '';
    const shown = gone.slice(0, MOST_NAMED).join(', ') + (gone.length > MOST_NAMED ? ` and ${gone.length - MOST_NAMED} more` : '');
    return `This change removed ${shown} from ${name}, which the request does not name. If that was not asked for, put it back now.`;
  }

  // ── What the request says to leave as it is ─────────────────────────

  const CHANGE = '(?:change|changing|edit|editing|modify|modifying|touch|touching|update|updating|rewrite|rewriting|delete|deleting|remove|removing)';
  const TESTS = '(?:the |any |its |their )?(?:unit |existing )?(?:tests?|test files?|test cases?|specs?)';
  /** "do not change the tests", "leave the tests alone", "the tests must not change". */
  const KEEP_TESTS = new RegExp(`\\b(?:(?:do not|don't|dont|never|without|no need to)\\s+${CHANGE}\\s+${TESTS}\\b|leave\\s+${TESTS}\\s+(?:alone|as (?:they|it) (?:are|is)|untouched|unchanged)|keep\\s+${TESTS}\\s+(?:as (?:they|it) (?:are|is)|untouched|unchanged)|${TESTS}\\s+(?:must|should) not (?:be )?(?:change|changed|edited|modified|touched))`, 'i');
  /** "do not change config/app.json": a file named with its extension. */
  const KEEP_FILE = new RegExp(`\\b(?:do not|don't|dont|never)\\s+${CHANGE}\\s+(?:the file\\s+)?[\`'"]?([\\w@-][\\w@./-]*\\.[A-Za-z][A-Za-z0-9]{0,6})\\b`, 'gi');
  /** A file of tests, by the names and folders test runners look for. */
  const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|specs?)\/|(?:^|[\/._-])(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/i;

  /**
   * Why `path` must be left as it is under `request`, or ''. For a request
   * that says to leave the tests as they are, any file of tests; for one that
   * names a file to leave, that file.
   */
  function leftAlone(request, path) {
    const text = String(request == null ? '' : request);
    const p = String(path == null ? '' : path).replace(/\\/g, '/');
    if (!text || !p) return '';
    const name = p.split('/').pop();
    if (KEEP_TESTS.test(text) && TEST_FILE.test(p)) {
      return `The request says not to change the tests, so ${name} was not changed. Change the code the tests check instead, so that they pass as they are.`;
    }
    for (const m of text.matchAll(KEEP_FILE)) {
      const kept = m[1].replace(/^\.\//, '');
      if (p === kept || p.endsWith(`/${kept}`)) return `The request says to leave ${kept} as it is, so it was not changed.`;
    }
    return '';
  }

  window.HCCodeKeep = { MOST_NAMED, inventory, removed, named, note, leftAlone, TEST_FILE };
})();
