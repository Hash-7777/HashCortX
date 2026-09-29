// ==============================================================
// What a project's source files define
//
// definitions() finds the functions, classes and types a source file
// defines, line by line, in about a dozen languages: each with its line,
// and for a function the names of its parameters. Only names: never a
// value, so a constant is named and not what it holds. The Coder panel's
// Symbols list shows them for the files in the project's top folder, read
// whole through the guard's check that never asks (HC.code.readQuietly).
//
// Pure: takes text, returns lists. No DOM, no storage, no reading.
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

  window.HCCodeMap = { LANGS, langOf, definitions, paramNames, label };
})();
