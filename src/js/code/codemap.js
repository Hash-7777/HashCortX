// ==============================================================
// What a project's source files define, and a map of it for a model
//
// definitions() finds the functions, classes and types a source file
// defines, line by line, in about a dozen languages: each with its line,
// and for a function the names of its parameters. Only names: never a
// value, so a constant is named and not what it holds. The Coder panel's
// Symbols list shows them for the files in the project's top folder, read
// whole through the guard's check that never asks (HC.code.readQuietly).
//
// A model's first steps on a project go to finding where things are. So a
// model on this computer of 15 billion parameters or more, or a cloud
// model, is given a map of the project as a conversation begins: a line a
// file, naming what it defines, the files most used by other files first,
// cut to a budget (notes). collect() reads the project the same way,
// leaving out hidden folders, folders of dependencies and build output,
// what the top .gitignore names plainly, and minified files, within fixed
// limits on folders, files, bytes and time. The map is made once a
// conversation and stays the same from one step to the next, so the start
// of every request can still be reused.
//
// Pure but for collect(), which is handed the functions that list and read.
//
// Loaded before the Coder mode and published as window.HCCodeMap.
// Checked by scripts/checks/code-map.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The language each file ending is read as. */
  const LANGS = {
    js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
    py: 'py', rs: 'rs', go: 'go', rb: 'rb', rake: 'rb', php: 'php', swift: 'swift', kt: 'kt', kts: 'kt',
    java: 'java', cs: 'java', c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c',
  };

  /** The language a file's name says it is in, or '' for one not read: minified, bundled and declaration files included. */
  function langOf(name) {
    const n = String(name || '');
    if (/\.min\.[a-z]+$|[.-]bundle\.[a-z]+$|\.d\.[cm]?ts$/i.test(n)) return '';
    const ext = (n.match(/\.([A-Za-z0-9]+)$/) || [])[1];
    return (ext && LANGS[ext.toLowerCase()]) || '';
  }

  // One rule a line: the first that matches names what the line defines.
  // `name` is what is defined, `kind` what it is when the rule does not say,
  // `params` a function's parameter list as far as the line holds it, and
  // `shut` whether the line closed it.
  const RULES = {
    js: [
      [/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\b\s*\*?\s*(?<name>[A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)/, 'class'],
      [/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?(?<kind>interface|type|enum)\s+(?<name>[A-Za-z_$][\w$]*)/, null],
      [/^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?function\b[^(]*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?\((?<params>[^)]*)(?<shut>\))\s*(?::[^=]*)?=>/, 'fn'],
      [/^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?<params>[A-Za-z_$][\w$]*)\s*=>/, 'fn'],
      [/^\s*export\s+(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)/, 'const'],
      // A method: indented, its parameter list closed and the body opened on the line.
      [/^\s+(?:(?:static|async|get|set|public|private|protected|readonly|override|abstract)\s+)*\*?(?<name>[A-Za-z_$][\w$]*)\s*\((?<params>[^)]*)(?<shut>\))\s*(?::[^{=;]*)?\{\s*$/, 'fn'],
    ],
    py: [
      [/^\s*(?:async\s+)?def\s+(?<name>\w+)\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*class\s+(?<name>\w+)/, 'class'],
    ],
    rs: [
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+(?<name>\w+)\s*(?:<[^(]*>)?\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?<kind>struct|enum|trait|union)\s+(?<name>\w+)/, null],
      [/^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(?<name>\w+)\s*(?:<[^=]*>)?\s*=/, 'type'],
    ],
    go: [
      [/^func\s+(?:\([^)]*\)\s*)?(?<name>\w+)\s*(?:\[[^\]]*\])?\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^type\s+(?<name>\w+)\s+(?<kind>struct|interface)\b/, null],
      [/^type\s+(?<name>\w+)\s/, 'type'],
    ],
    java: [
      [/^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|readonly)\s+)*(?<kind>class|interface|enum|record|struct)\s+(?<name>\w+)/, null],
      [/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|virtual|async|native|default|sealed|unsafe|extern)\s+)+(?:<[^>]*>\s+)?[\w<>[\]?,. ]+?\s+(?<name>\w+)\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
    ],
    kt: [
      [/^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|override|open|suspend|inline|operator|infix|tailrec|abstract|final|external)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(?<name>\w+)\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|protected|internal|open|abstract|sealed|data|enum|annotation|inner|value|inline)\s+)*(?<kind>class|interface|object)\s+(?<name>\w+)/, null],
    ],
    swift: [
      [/^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|internal|fileprivate|open|static|class|final|override|mutating|nonmutating|nonisolated|convenience|required)\s+)*func\s+(?<name>\w+)\s*(?:<[^(]*>)?\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:(?:@\w+(?:\([^)]*\))?|public|private|internal|fileprivate|open|final|indirect)\s+)*(?<kind>class|struct|enum|protocol|actor)\s+(?<name>\w+)/, null],
    ],
    c: [
      [/^\s*(?:template\s*<[^>]*>\s*)?(?<kind>class|struct|union|enum(?:\s+class)?)\s+(?:\w+\s+)?(?<name>[A-Za-z_]\w*)\s*(?:final\s*)?(?::[^;{]*)?(?:\{.*)?$/, null],
      // A function: at the start of the line, after its type, the body opened here or on the next line.
      [/^(?![ \t])(?!(?:if|for|while|switch|return|else|do|case|typedef|using|namespace|template|goto|sizeof)\b)[A-Za-z_][\w:<>,*& \t]*?[\s*&](?<name>~?[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*)*)\s*\((?<params>[^;)]*)(?<shut>\))?\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{?\s*$/, 'fn'],
    ],
    rb: [
      [/^\s*def\s+(?:self\.)?(?<name>\w+[?!=]?)(?:\s*\((?<params>[^)]*)(?<shut>\))?)?/, 'fn'],
      [/^\s*(?<kind>class|module)\s+(?<name>[A-Z]\w*(?:::[A-Z]\w*)*)/, null],
    ],
    php: [
      [/^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?(?<name>\w+)\s*\((?<params>[^)]*)(?<shut>\))?/, 'fn'],
      [/^\s*(?:(?:abstract|final|readonly)\s+)*(?<kind>class|interface|trait|enum)\s+(?<name>\w+)/, null],
    ],
  };

  /** A line that is a comment, or a directive, holds no definition. */
  const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;

  /** Words a rule could read as a name, which never are one. */
  const KEYWORDS = new Set(['if', 'else', 'elif', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'catch', 'try',
    'finally', 'return', 'function', 'with', 'typeof', 'sizeof', 'new', 'delete', 'await', 'yield', 'super',
    'constructor', 'match', 'loop', 'unless', 'until', 'defer', 'select', 'using', 'lock', 'when', 'guard', 'repeat']);

  /** Where a parameter's name sits: after its type, before it, or behind a `$`. */
  const STYLE = { go: 'first', java: 'type', c: 'type', php: 'dollar' };

  /** Parameter names that say nothing about how a function is called. */
  const UNNAMED = new Set(['self', 'cls', 'this', 'void', 'mut']);

  /** At most this many parameter names are given; the rest are "…". */
  const PARAMS_SHOWN = 4;

  /**
   * The names in a parameter list, joined: "text, edits, …". Types,
   * defaults and values are left out. `cut` says the line ended before the
   * list did.
   */
  function paramNames(raw, lang, cut) {
    const style = STYLE[lang] || 'last';
    const pieces = [];
    let depth = 0, piece = '';
    for (const ch of String(raw || '')) {
      if ('([{<'.includes(ch)) depth++;
      else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { pieces.push(piece); piece = ''; } else piece += ch;
    }
    pieces.push(piece);
    const names = [];
    for (const p of pieces) {
      const s = p.trim();
      if (!s) continue;
      if (/^[{[(]/.test(s)) { names.push(`${s[0]}…${{ '{': '}', '[': ']', '(': ')' }[s[0]]}`); continue; }
      let head = s.split('=')[0];
      if (style === 'dollar') {
        const at = head.match(/\$\w+/);
        if (at) names.push(at[0]);
        continue;
      }
      if (style === 'last') head = head.split(':')[0];
      const ids = head.match(/[A-Za-z_$][\w$]*/g) || [];
      const id = style === 'first' ? ids[0] : ids[ids.length - 1];
      if (!id || UNNAMED.has(id)) continue;
      names.push(`${(head.match(/^\s*(\.\.\.|\*\*|\*|&)/) || [])[1] || ''}${id}`);
    }
    const shown = names.slice(0, PARAMS_SHOWN);
    if (names.length > PARAMS_SHOWN || cut) shown.push('…');
    return shown.join(', ');
  }

  /** At most this many definitions are read from one file. */
  const MOST_DEFINITIONS = 400;

  /** A line this long is not written by hand. */
  const LONGEST_LINE = 400;

  /**
   * What `text`, in language `lang`, defines, in order:
   * `{ name, kind, line, params? }`, `params` for a function whose line
   * opens a parameter list. A name defined twice is given once, at its
   * first place.
   */
  function definitions(text, lang) {
    const rules = RULES[lang];
    if (!rules) return [];
    const out = [];
    const seen = new Set();
    const lines = String(text == null ? '' : text).split('\n');
    for (let i = 0; i < lines.length && out.length < MOST_DEFINITIONS; i++) {
      const line = lines[i];
      if (line.length > LONGEST_LINE || COMMENT.test(line)) continue;
      for (const [rule, kind] of rules) {
        const m = rule.exec(line);
        if (!m) continue;
        const g = m.groups;
        if (KEYWORDS.has(g.name) || /^__\w+__$/.test(g.name) || seen.has(g.name)) break;
        seen.add(g.name);
        const def = { name: g.name, kind: (kind || g.kind).replace(/\s+class$/, ''), line: i + 1 };
        if (g.params !== undefined) def.params = paramNames(g.params, lang, 'shut' in g && g.shut === undefined);
        out.push(def);
        break;
      }
    }
    return out;
  }

  /** A definition in a few characters: `applyEdits(text, edits, path)`, `class Guard`, `LIMITS`. */
  function label(d) {
    if (d.kind === 'fn') return d.params === undefined ? d.name : `${d.name}(${d.params})`;
    if (d.kind === 'const') return d.name;
    return `${d.kind} ${d.name}`;
  }

  // ── Reading the project ────────────────────────────────────────────────

  /** How far collect() reads: folders deep, folders, files, characters in all, bytes a file, and milliseconds. */
  const LIMITS = { depth: 8, dirs: 400, files: 300, chars: 3000000, fileBytes: 300000, ms: 4000 };

  /** Folders of dependencies and build output, never read, whatever case they are written in. */
  const SKIP = new Set(['node_modules', 'bower_components', 'jspm_packages', 'vendor', 'third_party', 'target', 'dist',
    'build', 'out', 'coverage', '__pycache__', 'venv', 'site-packages', 'pods', 'deriveddata', 'carthage']);

  /**
   * What a .gitignore names plainly: `names` left out wherever they are,
   * `paths` from the top folder. A line with a wildcard is left to the
   * other rules; a name a later line brings back with `!` is read.
   */
  function ignoredBy(text) {
    const names = new Set(), paths = new Set(), back = [];
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('!')) { back.push(line.slice(1).replace(/^\/+|\/+$/g, '')); continue; }
      if (/[*?[\]\\]/.test(line)) continue;
      const bare = line.replace(/\/+$/, '');
      if (!bare) continue;
      if (bare.includes('/')) paths.add(bare.replace(/^\/+/, '')); else names.add(bare);
    }
    back.forEach((b) => { names.delete(b); paths.delete(b); });
    return { names, paths };
  }

  /** A test file, read after the project's own code. */
  const isTest = (rel) => /(^|\/)(tests?|__tests__|specs?)\//i.test(rel) || /(^|\/)test_[^/]*\.py$|[._-](test|spec)\.[a-z]+$/i.test(rel);

  /** Text that was not written by hand: a line in its first part longer than any person writes. */
  const looksMinified = (text) => text.slice(0, 5000).split('\n').some((l) => l.length > 1000);

  /**
   * The project's source files, read: `{ files: [{ path, lang, text }], dirs }`,
   * `path` from the top folder. `list(dir)` answers with a folder's entries
   * (`{ name, is_dir, size }`) and `read(path)` with a file's text; anything
   * either cannot answer is left out. Folders are walked nearest first, a
   * few files are read at a time, and the project's own code is read before
   * its tests.
   */
  async function collect(root, { list, read }, limits = {}) {
    const L = Object.assign({}, LIMITS, limits);
    const clock = typeof L.now === 'function' ? L.now : Date.now;
    const until = clock() + L.ms;
    const sep = /\\/.test(root) && !/\//.test(root) ? '\\' : '/';
    const base = String(root).replace(/[\\/]+$/, '');
    const entriesOf = async (dir) => {
      try { let e = await list(dir); if (typeof e === 'string') e = JSON.parse(e); return Array.isArray(e) ? e : null; } catch { return null; }
    };
    let ignored = { names: new Set(), paths: new Set() };
    const queue = [{ dir: base, rel: '', depth: 0 }];
    const found = [];
    let dirs = 0;
    while (queue.length && dirs < L.dirs && found.length < L.files * 4 && clock() < until) {
      const { dir, rel, depth } = queue.shift();
      const entries = await entriesOf(dir);
      dirs++;
      if (!entries) continue;
      if (!rel && entries.some((e) => e && e.name === '.gitignore' && !e.is_dir)) {
        try { const t = await read(dir + sep + '.gitignore'); if (typeof t === 'string') ignored = ignoredBy(t); } catch { /* read without it */ }
      }
      const named = entries.filter((e) => e && typeof e.name === 'string').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of named) {
        const at = rel ? `${rel}/${e.name}` : e.name;
        if (e.name.startsWith('.') || SKIP.has(e.name.toLowerCase()) || ignored.names.has(e.name) || ignored.paths.has(at)) continue;
        if (e.is_dir) { if (depth < L.depth) queue.push({ dir: dir + sep + e.name, rel: at, depth: depth + 1 }); }
        else if (langOf(e.name) && !(Number(e.size) > L.fileBytes)) found.push({ path: dir + sep + e.name, rel: at });
      }
    }
    const chosen = found.filter((f) => !isTest(f.rel)).concat(found.filter((f) => isTest(f.rel))).slice(0, L.files);
    const files = [];
    let chars = 0;
    for (let i = 0; i < chosen.length && chars < L.chars && clock() < until; i += 8) {
      const batch = chosen.slice(i, i + 8);
      const texts = await Promise.all(batch.map((f) => Promise.resolve().then(() => read(f.path)).catch(() => null)));
      batch.forEach((f, k) => {
        const text = texts[k];
        if (typeof text !== 'string' || chars >= L.chars || looksMinified(text)) return;
        chars += text.length;
        files.push({ path: f.rel, lang: langOf(f.rel), text });
      });
    }
    return { files, dirs };
  }

  // ── Which files matter most ────────────────────────────────────────────

  /** The part of a name another file would write: `draw` of `Widget::draw`, `paid` of `paid?`. */
  const keyOf = (name) => String(name).split(/::|\./).pop().replace(/[?!=]$/, '');

  /**
   * The files with what each defines, the files most used by other files
   * first: `[{ path, symbols, users, total }]`. A file's `users` are the
   * other files that write a name only it defines; `total` counts every
   * use, a name several files define shared between them. A name written in
   * more than half the files, or shorter than three letters, says nothing
   * about which file is used. Within a file, the most used names come
   * first, then the rest in their order. The same files give the same
   * order every time.
   */
  function rank(files) {
    const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.text === 'string' && f.path);
    const defs = list.map((f) => definitions(f.text, f.lang || langOf(f.path)));
    const words = list.map((f) => new Set(f.text.match(/[A-Za-z_$][\w$]*/g) || []));
    const definers = new Map();
    defs.forEach((ds, i) => ds.forEach((d) => {
      const k = keyOf(d.name);
      if (!definers.has(k)) definers.set(k, new Set());
      definers.get(k).add(i);
    }));
    const seenIn = new Map();
    const where = (k) => {
      if (!seenIn.has(k)) seenIn.set(k, words.reduce((at, w, j) => (w.has(k) && at.push(j), at), []));
      return seenIn.get(k);
    };
    const common = Math.max(10, Math.ceil(list.length / 2));
    const out = list.map((f, i) => {
      const users = new Set();
      let total = 0;
      const symbols = defs[i].map((d, order) => {
        const k = keyOf(d.name), by = definers.get(k), at = k.length >= 3 ? where(k) : [];
        const from = at.length > common ? [] : at.filter((j) => !by.has(j));
        if (by.size === 1) from.forEach((j) => users.add(j));
        total += from.length / by.size;
        return Object.assign({}, d, { refs: from.length, order });
      });
      symbols.sort((a, b) => b.refs - a.refs || a.order - b.order);
      return { path: f.path, symbols, users: users.size, total };
    }).filter((f) => f.symbols.length);
    return out.sort((a, b) => b.users - a.users || b.total - a.total || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  // ── The map, as a model reads it ───────────────────────────────────────

  /** How much of the map each model is given: characters in all, and names a file. A model on this computer reads more slowly. */
  const BUDGET = { cloud: { chars: 4000, per: 8 }, local: { chars: 2400, per: 6 } };

  /** No line of the map is longer than this. */
  const LONGEST_ENTRY = 300;

  const INTRO = "A map of the project's code, made by HashCortx from its files when this conversation began: each line is a file and what it defines, the files most used by other files first. It shows where things are, not what they hold now: read a file before changing it.";

  /**
   * The map as the model reads it, or '' when nothing is defined. `drop` is
   * asked about each name and each path, and whatever it answers true for
   * is left out: HashCoder passes the test for keys and email addresses
   * (js/code/lessons.js looksPrivate). Files that do not fit the budget are
   * counted, not named.
   */
  function notes(ranked, { local = false, drop = null } = {}) {
    const { chars, per } = local ? BUDGET.local : BUDGET.cloud;
    const refuse = typeof drop === 'function' ? drop : () => false;
    const lines = [];
    let used = 0, left = 0, full = false;
    for (const f of Array.isArray(ranked) ? ranked : []) {
      const path = String(f.path).replace(/[<>\r\n]+/g, ' ');
      const syms = (f.symbols || []).filter((s) => !refuse(s.name));
      if (!syms.length || refuse(path)) continue;
      let line = `${path}: ${syms.slice(0, per).map(label).join(', ')}${syms.length > per ? `, +${syms.length - per} more` : ''}`;
      if (line.length > LONGEST_ENTRY) line = `${line.slice(0, LONGEST_ENTRY - 1)}…`;
      if (full || used + line.length + 1 > chars) { full = true; left++; continue; }
      lines.push(line);
      used += line.length + 1;
    }
    if (!lines.length) return '';
    const rest = left ? `\n[${left} more file${left === 1 ? '' : 's'} with definitions not shown: find them with grep_code or fuzzy_find.]` : '';
    return `${INTRO}\n<code-map>\n${lines.join('\n')}${rest}\n</code-map>`;
  }

  /** The project at `root`, read and ranked: `{ ranked, read }`, `read` the number of files read. */
  async function forProject(root, io, limits) {
    const got = await collect(root, io, limits);
    return { ranked: rank(got.files), read: got.files.length };
  }

  window.HCCodeMap = { LANGS, LIMITS, SKIP, BUDGET, INTRO, langOf, definitions, paramNames, label, ignoredBy, collect, rank, notes, forProject };
})();
