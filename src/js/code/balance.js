// ==============================================================
// Whether an edit left a file's brackets and quotes unbalanced
//
// A model that types one quote wrong, or replaces the first half of a block
// and not the second, leaves a file that no longer parses, and often goes on
// to edit around the damage without seeing it. After each change to a code
// file the text is read the way a parser starts to read it: comments and
// strings set aside, brackets matched. When the file balanced before the
// change and does not after, the tool's answer says where, so the model can
// put it right at once. It is a note, never a refusal: a reading this simple
// can be wrong about a file, and comparing before with after keeps it quiet
// wherever it is wrong about both.
//
// Pure: takes strings, returns strings.
//
// Loaded before the Coder mode and published as window.HCCodeBalance.
// Checked by scripts/checks/code-balance.mjs.
// ==============================================================

(function () {
  'use strict';

  const FAMILIES = [
    [/\.(m?[jt]sx?|cjs|cts|mts|vue|svelte)$/i, 'js'],
    [/\.(css|scss|less)$/i, 'css'],
    [/\.(py|pyw)$/i, 'py'],
    [/\.(rs|go|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|cs|scala|dart|php)$/i, 'c'],
  ];

  /** How a file's text is read, by its name, or null for one this does not read. */
  const familyOf = (name) => (FAMILIES.find(([rx]) => rx.test(String(name || ''))) || [])[1] || null;

  const PAIR = { ')': '(', ']': '[', '}': '{' };
  // After one of these, or one of these words, a slash in JavaScript begins
  // a pattern, not a division.
  const BEFORE_PATTERN = '(,=:[!&|?{};+-*%<>~^';
  const PATTERN_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);
  // A character in C-like languages, as 'x' or an escape; anything else after
  // a single quote is a Rust lifetime or a label, which opens nothing.
  const CHAR = /^'(?:\\(?:u\{[0-9a-fA-F]{1,6}\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'/;

  /**
   * The first place `text` does not balance, as `{ line, what }`, or null.
   * `family` is familyOf's answer.
   */
  function firstFault(text, family) {
    const s = String(text == null ? '' : text);
    const n = s.length;
    const stack = [];          // { ch, line } for ( [ {, and { ch: '${' } inside a template
    let line = 1;
    let i = 0;
    let prev = '';             // the last character that was not space or inside a string
    let word = '';             // the last word read, for telling a pattern from a division
    const multiLine = family === 'c';   // a Rust or Go string may run over lines
    const at = (what, where = line) => ({ line: where, what });

    // Moves past a template literal's text, stopping after its closing
    // backquote, or at a `${` (which it pushes). Returns a fault or null.
    const template = (start) => {
      while (i < n) {
        const c = s[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') line++;
        if (c === '`') { i++; return null; }
        if (c === '$' && s[i + 1] === '{') { stack.push({ ch: '${', line }); i += 2; return null; }
        i++;
      }
      return at('a template string opened here is never closed', start);
    };

    while (i < n) {
      const c = s[i];
      const d = s[i + 1];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      // Comments.
      if (family !== 'py' && c === '/' && d === '/') { while (i < n && s[i] !== '\n') i++; continue; }
      if (family !== 'py' && c === '/' && d === '*') {
        const start = line;
        i += 2;
        while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') line++; i++; }
        if (i >= n) return at('a comment opened here is never closed', start);
        i += 2;
        continue;
      }
      if (family === 'py' && c === '#') { while (i < n && s[i] !== '\n') i++; continue; }
      // Strings.
      if (family === 'py' && (c === '"' || c === "'") && s.startsWith(c.repeat(3), i)) {
        const q = c.repeat(3);
        const start = line;
        i += 3;
        while (i < n && !s.startsWith(q, i)) { if (s[i] === '\\') i++; else if (s[i] === '\n') line++; i++; }
        if (i >= n) return at('a triple-quoted string opened here is never closed', start);
        i += 3; prev = 'x';
        continue;
      }
      // A raw string in Rust: r"..." or r#"..."#, where quotes and backslashes are text.
      if (family === 'c' && (c === 'r' || c === 'b') && !/[\w$]/.test(s[i - 1] || '')) {
        const raw = /^b?r(#*)"/.exec(s.slice(i, i + 12));
        if (raw) {
          const start = line;
          const end = '"' + raw[1];
          i += raw[0].length;
          while (i < n && !s.startsWith(end, i)) { if (s[i] === '\n') line++; i++; }
          if (i >= n) return at('a raw string opened here is never closed', start);
          i += end.length; prev = 'x';
          continue;
        }
      }
      // A raw string in Go, or a quoted name in Kotlin or Swift: `...`.
      if (family === 'c' && c === '`') {
        const start = line;
        i++;
        while (i < n && s[i] !== '`') { if (s[i] === '\n') line++; i++; }
        if (i >= n) return at('a string opened with ` here is never closed', start);
        i++; prev = 'x';
        continue;
      }
      if (family === 'c' && c === "'") {
        const ch = CHAR.exec(s.slice(i, i + 16));
        i += ch ? ch[0].length : 1;
        prev = 'x';
        continue;
      }
      if (c === '"' || c === "'") {
        const start = line;
        i++;
        while (i < n && s[i] !== c) {
          if (s[i] === '\\') { i += 2; continue; }
          if (s[i] === '\n') { if (!multiLine) return at(`a string opened with ${c} here is not closed on its line`, start); line++; }
          i++;
        }
        if (i >= n) return at(`a string opened with ${c} here is never closed`, start);
        i++; prev = 'x';
        continue;
      }
      if (family === 'js' && c === '`') {
        const start = line;
        i++;
        const f = template(start);
        if (f) return f;
        prev = 'x';
        continue;
      }
      // A pattern in JavaScript: /.../flags, on one line.
      if (family === 'js' && c === '/' && (!prev || BEFORE_PATTERN.includes(prev) || (prev === 'w' && PATTERN_WORDS.has(word)))) {
        let j = i + 1;
        let inClass = false;
        while (j < n && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '[') inClass = true;
          else if (s[j] === ']') inClass = false;
          else if (s[j] === '/' && !inClass) break;
          j++;
        }
        if (j < n && s[j] === '/') { i = j + 1; while (i < n && /[a-z]/i.test(s[i])) i++; prev = 'x'; continue; }
      }
      // Brackets.
      if (c === '(' || c === '[' || c === '{') { stack.push({ ch: c, line }); prev = c; i++; continue; }
      if (c === ')' || c === ']' || c === '}') {
        const top = stack.pop();
        if (!top) return at(`a "${c}" here closes nothing`);
        if (top.ch === '${') {
          if (c !== '}') return at(`a "${c}" here closes a \${ opened on line ${top.line}`);
          i++;
          const f = template(top.line);
          if (f) return f;
          prev = 'x';
          continue;
        }
        if (PAIR[c] !== top.ch) return at(`a "${c}" here closes a "${top.ch}" opened on line ${top.line}`);
        prev = c; i++;
        continue;
      }
      // A word: kept, so a keyword before a slash can be recognised.
      const w = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 64));
      if (w) { word = w[0]; prev = 'w'; i += w[0].length; continue; }
      prev = c;
      i++;
    }
    const open = stack.pop();
    if (open) return at(`a "${open.ch === '${' ? '${' : open.ch}" opened here is never closed`, open.line);
    return null;
  }

  /**
   * A note for the model when the change from `before` to `after` left the
   * file named `name` unbalanced where it balanced before, or ''. A new
   * file (`before` null) is read on its own.
   */
  function introduced(name, before, after) {
    const family = familyOf(name);
    if (!family || after == null) return '';
    if (before != null && firstFault(before, family)) return '';
    const fault = firstFault(after, family);
    if (!fault) return '';
    return `After this change, ${name} may not parse: on line ${fault.line}, ${fault.what}.` +
      `${before != null ? ' It balanced before the change.' : ''} If that is not what you meant, read the lines around it and fix it now.`;
  }

  window.HCCodeBalance = { familyOf, firstFault, introduced };
})();
