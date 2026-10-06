// ==============================================================
// Light mode: a small model writes files, it does not call tools
//
// A model of a few billion parameters is poor at the machinery of tool calls:
// it writes a file's text inside a JSON string and gets the escaping wrong, it
// mistypes an argument, it writes its tool list back as its reply, and every
// step re-reads the descriptions of every tool before it writes a word. The
// same model, shown the project's files and asked to answer in plain text with
// each changed file written out whole, does the same work far more often, and
// in a fraction of the time.
//
// So for a small model the app does the machinery. The model is sent no tools
// and a short instruction; it answers with FILE blocks (a file's whole new
// contents), a READ line for a file it needs to see, and a sentence. This
// module reads such an answer, and turns the model's turn into the same calls
// the app already runs for a larger model, so every file it writes goes through
// the same permission question, the same undo and the same record of what was
// proven. It also turns the conversation's calls and results back into the
// plain text the model reads, so it never sees a tool call at all.
//
// Which models: those the app finds small (js/platform hashcoder sizeOf), by
// what the model app reports of a model on this computer, and otherwise by the
// size in the model's name. A setting can turn it off, or give it to
// mid-sized models too.
//
// Pure but for turnOf, which reads files through the function it is given:
// takes strings and lists, returns strings and lists. No DOM, no storage, no
// network. Loaded before the Coder mode and published as
// window.HCCodeLight. Checked by scripts/checks/code-light.mjs.
// ==============================================================

(function () {
  'use strict';

  const TICKS = '`'.repeat(3);

  /** What a model in light mode is told. Short, since a small model reads all of it at every step. */
  const SYSTEM = [
    'You are HashCoder, a coding assistant working on the person\'s project, which is shown below. You answer in plain text and do not call tools.',
    '',
    'To create or change a file, write the whole file, like this:',
    '',
    'FILE: index.html',
    TICKS,
    '<the complete new contents of the file>',
    TICKS,
    '',
    'To look at a file you cannot see, write a line that is only: READ: style.css',
    '',
    'Rules:',
    '- Paths are from the project folder. A file at its top is written by its name alone, such as index.html; one in a folder with the folder, such as src/app.js. Use the paths the project already has.',
    '- Write only the files that must change or be created, each one in full. Keep everything in them that you were not asked to change exactly as it is.',
    '- Do not change test files unless asked to.',
    '- Do not add comments saying what you changed.',
    '- Answer a question in plain words and write no FILE blocks.',
    '- After the files, say in one sentence what you did. The tests are run for you.',
    '- When the work is done, answer with that one sentence and no FILE blocks.',
  ].join('\n');

  // ── Which models ─────────────────────────────────────────────────────

  /**
   * The size of a model in billions of parameters, read from its name when
   * nothing better is known: "llama-3.1-8b-instant" is 8, "qwen2.5-coder:3b"
   * is 3, a mixture "8x7b" is 56. Null when the name gives none.
   */
  function billionsInName(value) {
    const name = String(value == null ? '' : value).toLowerCase().replace(/^cloud:[^:]*:/, '').replace(/^local:[^:]*:/, '');
    const mix = /(?:^|[^a-z0-9.])(\d+)x(\d+(?:\.\d+)?)b(?![a-z])/.exec(name);
    if (mix) return Number(mix[1]) * Number(mix[2]);
    const one = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/.exec(name);
    return one ? Number(one[1]) : null;
  }

  /**
   * Whether a run is in light mode. `pref` is the setting: 'auto' (small
   * models, the default), 'always' (small and mid-sized) or 'off'.
   */
  function applies(size, pref) {
    if (pref === 'off') return false;
    return size === 'small' || (pref === 'always' && size === 'mid');
  }

  // ── Reading an answer ────────────────────────────────────────────────

  // A line that names a file for the block under it: FILE: src/app.js, in
  // whatever emphasis a model dresses it in.
  const FILE_LINE = /^[\s>*_#-]*(?:file|filename|path)\s*[:：]\s*[`*_"']*([^\s`*"']+)[`*_"']*\s*$/i;
  const READ_LINE = /^[\s>*_#-]*read\s*[:：]\s*[`*_"']*([^\s`*"']+)[`*_"']*\s*$/i;

  /** A path as a model wrote it, tidied, or '' when it cannot be the project's own place. */
  function cleanPath(raw) {
    const p = String(raw || '').trim().replace(/^\.\//, '').replace(/[,;:.]+$/, '');
    if (!p || p.length > 260 || /[\u0000-\u001f]/.test(p) || /(^|[\\/])\.\.([\\/]|$)/.test(p)) return '';
    return p;
  }

  const fenced = (info, code) => `${TICKS}${info || ''}\n${code}\n${TICKS}\n`;

  /** Whether the text ends inside a code block that was never closed: the answer was cut off. */
  function cutOff(text) {
    const F = window.HCFences;
    const last = F ? F.splitFences(String(text == null ? '' : text)).pop() : null;
    return !!last && last.type === 'code' && last.unclosed === true;
  }

  // ── Which file a block is for ────────────────────────────────────────
  //
  // Told to write FILE: above each file, a small model names it every other
  // way as well: the "=== path ===" headers the project is shown to it with,
  // a heading or a bold line, a sentence just above the block, or a comment
  // as the block's first line. Each is read, the explicit ones first. A name
  // read from a sentence or a heading is a guess, so it must look like a file
  // and match the block's language, and it is matched to the project's own
  // files (`known`) by its name when its folder is left out.

  const EXT = 'm?js|cjs|jsx|ts|tsx|json|py|html?|css|scss|md|txt|ya?ml|toml|sh|rb|go|rs|java|c|h|cpp|vue|svelte|sql|xml|ini|cfg|env';
  const PATH_TOKEN = new RegExp(`(?:^|[\\s\`'"*(\\[])((?:[\\w.-]+/)*[\\w-][\\w.-]*\\.(?:${EXT}))(?=$|[\\s\`'"*):,;\\]]|\\.(?:\\s|$))`, 'gi');
  const HEADER_LINE = new RegExp(`^\\s*={2,}\\s*((?:[\\w.-]+/)*[\\w.-]+\\.(?:${EXT}))\\s*={2,}\\s*$`, 'i');
  const COMMENT_LINE = new RegExp(`^\\s*(?://|#|/\\*|<!--|--)\\s*((?:[\\w.-]+/)*[\\w.-]+\\.(?:${EXT}))\\s*(?:\\*/|-->)?\\s*$`, 'i');
  /** The languages a block may say it is in, by file ending. */
  const LANGS = { js: ['js', 'javascript', 'node', 'jsx'], mjs: ['js', 'javascript'], cjs: ['js', 'javascript'], jsx: ['jsx', 'js', 'javascript'], ts: ['ts', 'typescript'], tsx: ['tsx', 'ts', 'typescript'],
    json: ['json', 'jsonc'], py: ['py', 'python', 'python3'], html: ['html', 'xml'], htm: ['html'], css: ['css'], scss: ['scss', 'css'], md: ['md', 'markdown'], sh: ['sh', 'bash', 'shell'] };
  const TERMINAL = /^(?:bash|sh|zsh|shell|console|terminal|powershell|cmd|text|txt|plaintext|output|log)$/i;

  /** Whether a block in `lang` can be the file `path`: any block when it names no language. */
  function fits(path, lang) {
    const l = String(lang || '').toLowerCase();
    if (!l) return true;
    const ext = String(path).split('.').pop().toLowerCase();
    return (LANGS[ext] || [ext]).includes(l);
  }

  /** The paths a line names, each once. */
  function pathsIn(line) {
    return [...new Set([...String(line || '').matchAll(PATH_TOKEN)].map((m) => m[1].replace(/[.,:;]+$/, '')))];
  }

  /** A name as the project has it: as written, or the one known file of that name when the folder was left out. */
  function resolve(name, known) {
    const p = cleanPath(name);
    if (!p || !known || !known.length || known.includes(p)) return p;
    const base = p.split('/').pop();
    const same = known.filter((k) => k.split('/').pop() === base);
    return same.length === 1 ? same[0] : p;
  }

  /**
   * A line for the instructions when the project's tests run on Node's own
   * runner, which small models mistake for another framework: '' otherwise.
   * `whole` is the project as the model is shown it.
   */
  function testHint(whole) {
    return /"test"\s*:\s*"node --test/.test(String(whole || ''))
      ? "This project's tests use Node's own runner: const test = require('node:test'); const assert = require('node:assert'); then assert.strictEqual(actual, expected). There is no expect()."
      : '';
  }

  /** The project's files, read from the "=== path ===" headers it is shown to a model with (js/code/context.js wholeProject). */
  function knownFiles(whole) {
    return [...String(whole || '').matchAll(/^=== ([^=\n]+?) ===$/gm)].map((m) => m[1].trim()).filter((p) => !/^not text/.test(p));
  }

  /** The text of a section after a "=== path ===" header, written without a fence: to the next header, the sentences after it left out. */
  function sectionText(lines) {
    const body = lines.slice();
    const prose = (l) => /^[A-Z][^{};=<>()\[\]]*[.:!]$/.test(l.trim()) && l.trim().split(/\s+/).length >= 4;
    while (body.length && (!body[body.length - 1].trim() || prose(body[body.length - 1]))) body.pop();
    while (body.length && !body[0].trim()) body.shift();
    return body.join('\n');
  }

  /**
   * Whether text written under a FILE: line with no fence is the file: any
   * text for a file of words, and for code at least one line written as code,
   * so a FILE: line followed by a sentence about the change writes nothing.
   */
  const WORDS_FILE = /\.(?:md|markdown|txt|text|rst)$/i;
  function looksLikeFile(body, path) {
    if (WORDS_FILE.test(path)) return true;
    return String(body).split('\n').some((l) => /[{}();=<>[\]]\s*$|^\s*(?:<[!a-zA-Z/]|[.#]?[\w-]+\s*\{|(?:def|class|import|from|const|let|var|function|return|export|module)\b)/.test(l));
  }

  /**
   * A command in light mode is run by HashCortX after the change, never by
   * the model, so a RUN line the model wrote, and the result it wrote under
   * it, are made up: a small model reported its tests passing for a test
   * file that did not exist. The line goes, and with it the block or the short
   * paragraph after it that reads as a result. The app's own line under the
   * answer says what was really checked.
   */
  const RESULT_WORDS = /\b(?:pass(?:ed|es|ing)?|fail(?:ed|s|ing|ure)?|errors?|ok|success(?:ful(?:ly)?)?|output|prints?|printed|works?)\b/i;
  function withoutMadeUpRuns(said) {
    const lines = String(said).split('\n');
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*RUN:/i.test(lines[i])) { kept.push(lines[i]); continue; }
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const fence = /^\s*(`{3,}|~{3,})/.exec(lines[j] || '');
      if (fence) {
        let end = j + 1;
        while (end < lines.length && !lines[end].trim().startsWith(fence[1])) end++;
        i = end;
        continue;
      }
      let e = j;
      while (e < lines.length && lines[e].trim() && !/^\s*(?:RUN|FILE|READ):/i.test(lines[e])) e++;
      i = e > j && e - j <= 3 && RESULT_WORDS.test(lines.slice(j, e).join(' ')) ? e - 1 : i;
    }
    return kept.join('\n');
  }

  /**
   * What a model's answer holds: the files it wrote whole (`writes`, in
   * order, the last of a name winning, each `{ path, content, guessed }`),
   * the files it asked to see (`reads`), what it said besides (`said`), and
   * whether it was cut off (`cut`). `known` are the project's files, `hints`
   * the files the request names: a lone block that names no file is the one
   * file the request names, when its language fits.
   */
  function parseReply(text, { known = [], hints = [] } = {}) {
    const F = window.HCFences;
    const src = String(text == null ? '' : text);
    const out = { writes: [], reads: [], said: '', cut: false };
    if (!F) { out.said = src; return out; }
    const pieces = F.splitFences(src);
    const byPath = new Map();
    const unnamed = [];
    const keep = (path, content, guessed) => {
      const w = { path, content: content.endsWith('\n') ? content : `${content}\n`, guessed: !!guessed };
      if (byPath.has(path)) out.writes[byPath.get(path)] = w;
      else { byPath.set(path, out.writes.length); out.writes.push(w); }
    };
    const lastLine = (piece) => {
      const lines = piece && piece.type === 'text' ? piece.text.split(/\r?\n/) : [];
      let k = lines.length - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      return { lines, k, line: k >= 0 ? lines[k] : '' };
    };
    let said = '';
    pieces.forEach((p, i) => {
      if (p.type === 'text') {
        const { lines, k, line } = lastLine(p);
        const nextIsCode = pieces[i + 1] && pieces[i + 1].type === 'code';
        const naming = nextIsCode && (FILE_LINE.test(line) || HEADER_LINE.test(line));
        let section = null;
        // A section ends as a file when it holds one; a FILE: line over plain sentences is said, not written.
        const close = () => {
          const path = cleanPath(section.path);
          const words = section.loose && WORDS_FILE.test(path);
          const body = sectionText(section.lines) || (words ? section.lines.join('\n').trim() : '');
          if (body && path && (!section.loose || looksLikeFile(body, path))) keep(resolve(path, known), body, false);
          else said += `${[section.head, ...section.lines].join('\n')}\n`;
        };
        lines.forEach((l, n) => {
          const read = READ_LINE.exec(l);
          if (read) { const path = resolve(read[1], known); if (path && !out.reads.includes(path)) out.reads.push(path); return; }
          if (naming && n === k) return;
          // A "=== path ===" header, or a FILE: line, with the file under it and no fence: the section runs to the next one.
          const head = HEADER_LINE.exec(l);
          const loose = !head && FILE_LINE.exec(l);
          if (head || loose) {
            if (section) close();
            section = { path: (head || loose)[1], head: l, loose: !!loose, lines: [] };
            return;
          }
          if (section) { section.lines.push(l); return; }
          said += l + (n < lines.length - 1 ? '\n' : '');
        });
        if (section) close();
        return;
      }
      const { line } = lastLine(pieces[i - 1]);
      const firstLine = String(p.code).split('\n')[0];
      let path = '';
      let code = p.code;
      let guessed = false;
      const file = FILE_LINE.exec(line) || HEADER_LINE.exec(line);
      const comment = COMMENT_LINE.exec(firstLine);
      if (file) path = resolve(file[1], known);
      else if (comment && fits(comment[1], p.lang)) { path = resolve(comment[1], known); code = String(p.code).split('\n').slice(1).join('\n'); }
      else if (!TERMINAL.test(p.lang || '')) {
        // A heading or the sentence just above the block, naming one file only.
        const named = pathsIn(line).filter((n) => fits(n, p.lang));
        if (named.length === 1 && line.length <= 200) { path = resolve(named[0], known); guessed = true; }
      }
      // A block the answer ended inside is half a file: it is never written, and the answer counts as cut off.
      if (path && p.unclosed) return;
      if (path) keep(path, code, guessed);
      else {
        if (!TERMINAL.test(p.lang || '') && !p.unclosed) unnamed.push({ index: out.writes.length, code: p.code, lang: p.lang, at: said.length, text: fenced(p.info, p.code) });
        said += fenced(p.info, p.code);
      }
    });
    // One block naming no file, in an answer that wrote no other, is the one file the request names that it can be.
    const asked = [...new Set((hints || []).map((h) => resolve(h, known)))];
    if (!out.writes.length && unnamed.length === 1) {
      const fit = asked.filter((h) => fits(h, unnamed[0].lang));
      if (fit.length === 1) {
        keep(fit[0], unnamed[0].code, true);
        said = said.replace(unnamed[0].text, '');
      }
    }
    out.said = withoutMadeUpRuns(said).replace(/\n{3,}/g, '\n\n').trim();
    out.cut = cutOff(src);
    return out;
  }

  /** The calls the app runs for what a model wrote: its files, then the files it asked to see. */
  function callsFor(parsed) {
    return [
      ...parsed.writes.map((w) => ({ name: 'write_file', arguments: { path: w.path, content: w.content } })),
      ...parsed.reads.map((p) => ({ name: 'read_file', arguments: { path: p } })),
    ];
  }

  const NOTE = 'Note from HashCortX, not from the person:';
  const named = (paths) => (paths.length > 1 ? `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1]}` : paths[0] || '');

  /**
   * What the app does with a model's answer: the calls to run for it, and a
   * note to send back when part of it was not written. A file written much
   * shorter than it is (`current`, by path) is not written, nor is one the
   * answer was cut off inside, nor one written again exactly as it is.
   * `calls` empty and `note` '' is a plain answer: the model has finished.
   */
  /** Whether code shares a top-level definition with the file, or the file is not code that defines any. */
  function sharesDefinition(M, now, content, path) {
    const lang = M.langOf(path);
    if (!lang) return true;
    const had = M.definitions(now, lang).map((d) => d.name);
    return !had.length || M.definitions(content, lang).some((d) => had.includes(d.name));
  }

  // A file that loads itself. A small model copies the line that loads a
  // module into the module, and the file then fails to load: in JavaScript
  // the name is declared twice, in Python the import is circular. Such a
  // line is never right, so it is left out of what is written, and said.
  const JS_SELF = /^\s*(?:(?:const|let|var)\s+[^=]+=\s*require\(\s*(['"])([^'"]+)\1\s*\)(?:\.\w+)?|require\(\s*(['"])([^'"]+)\3\s*\)|import\s+(?:[^'"]+\s+from\s+)?(['"])([^'"]+)\5)\s*;?\s*$/;
  const PY_SELF = /^\s*(?:from\s+(\.?)([\w.]+)\s+import\s+[\w*, ()]+|import\s+([\w.]+)(?:\s+as\s+\w+)?)\s*$/;
  const dirOf = (p) => p.split('/').slice(0, -1);
  const noExt = (p) => p.replace(/\.(?:[cm]?js|jsx|ts|tsx)$/, '').replace(/\/index$/, '');

  /** `content` without the lines that load the file at `path` itself, and those lines' numbers. */
  function withoutSelfLoads(content, path) {
    const p = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const js = /\.(?:[cm]?js|jsx|ts|tsx)$/.test(p), py = /\.py$/.test(p);
    if (!js && !py) return { content, lines: [] };
    const self = noExt(p);
    const module = p.split('/').pop().replace(/\.py$/, '');
    const dotted = p.replace(/\.py$/, '').split('/').join('.');
    const loadsSelf = (line) => {
      if (js) {
        const m = JS_SELF.exec(line);
        const spec = m && (m[2] || m[4] || m[6]);
        if (!spec || !/^\.\.?\//.test(spec)) return false;
        const parts = dirOf(p);
        for (const s of spec.split('/')) { if (s === '..') parts.pop(); else if (s !== '.') parts.push(s); }
        return noExt(parts.join('/')) === self;
      }
      const m = PY_SELF.exec(line);
      const name = m && (m[2] || m[3]);
      return !!name && (name === module || name === dotted);
    };
    const lines = [];
    const kept = String(content).split('\n').filter((l, n) => (loadsSelf(l) ? (lines.push(n + 1), false) : true));
    return { content: lines.length ? kept.join('\n') : content, lines };
  }

  // A comment about the rename itself. Asked to rename a name, a small model
  // writes a comment saying that it did, and the comment names the old name
  // again. With the request's rename (js/code/verify.js renameOf), a line
  // comment that names the old name and the new one, or says it was renamed
  // or changed, is left out of the line; the code on the line is kept.
  const NARRATES = /\b(?:renam|chang|replac|previous|formerly|was\b|old\b|now\b)/i;
  const LINE_MARK = [[/\.(?:[cm]?[jt]sx?|java|c|cc|cpp|h|hpp|cs|go|rs|swift|kt|php|dart)$/i, '//'], [/\.(?:py|rb|sh|ya?ml|toml|r)$/i, '#']];

  /** Where a line's comment starts, outside any quoted text: -1 when it has none. */
  function commentAt(line, mark) {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (line.startsWith(mark, i)) return i;
    }
    return -1;
  }

  /** `content` with the comments about `rename` left out, and the numbers of the lines they were on. */
  function withoutRenameNotes(content, path, rename) {
    const kind = rename && rename.from && rename.to && LINE_MARK.find(([ext]) => ext.test(String(path || '')));
    if (!kind) return { content, lines: [] };
    const mark = kind[1];
    const old = new RegExp(`(^|[^\\w$])${rename.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
    const lines = [];
    const out = [];
    String(content).split('\n').forEach((line, n) => {
      const at = commentAt(line, mark);
      const note = at < 0 ? '' : line.slice(at + mark.length);
      if (!note || !old.test(note) || !(note.includes(rename.to) || NARRATES.test(note))) { out.push(line); return; }
      lines.push(n + 1);
      const code = line.slice(0, at).replace(/\s+$/, '');
      if (code.trim()) out.push(code);
    });
    return { content: lines.length ? out.join('\n') : content, lines };
  }

  // A name declared twice at the top of a JavaScript file. A small model
  // pastes one file into another, or loads a name and defines it too, and the
  // file then does not load at all. Two functions or two vars of one name are
  // allowed by the language; with a const, a let, a class or an import among
  // them it is an error, so such a file is not written and the lines are said.
  const NAME = '[A-Za-z_$][\\w$]*';
  const DECLS = [
    [new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s*(${NAME})\\s*\\(`), 'function'],
    [new RegExp(`^(?:export\\s+(?:default\\s+)?)?class\\s+(${NAME})\\b`), 'lexical'],
    [new RegExp(`^(?:export\\s+)?(const|let|var)\\s+(${NAME})\\s*=`), 'binding'],
  ];

  /** The names declared twice at the top of a JavaScript file in a way the language refuses: `[{ name, lines }]`. */
  function twiceDeclared(content, path) {
    if (!/\.(?:[cm]?js|jsx|ts|tsx)$/i.test(String(path || ''))) return [];
    const seen = new Map();
    const add = (name, kind, n) => { if (!seen.has(name)) seen.set(name, []); seen.get(name).push({ kind, line: n + 1 }); };
    String(content).split('\n').forEach((line, n) => {
      for (const [re, kind] of DECLS) {
        const m = re.exec(line);
        if (!m) continue;
        if (kind === 'binding') add(m[2], m[1] === 'var' ? 'var' : 'lexical', n); else add(m[1], kind, n);
        return;
      }
      const taken = /^(const|let|var)\s+\{([^}]*)\}\s*=/.exec(line);
      if (taken) for (const part of taken[2].split(',')) { const local = part.split(':').pop().split('=')[0].trim(); if (local) add(local, taken[1] === 'var' ? 'var' : 'lexical', n); }
      const imported = /^import\s+(.+?)\s+from\s+['"]/.exec(line);
      if (imported) {
        const spec = imported[1];
        const named = /\{([^}]*)\}/.exec(spec);
        if (named) for (const part of named[1].split(',')) { const local = part.split(/\s+as\s+/).pop().trim(); if (local) add(local, 'lexical', n); }
        const lead = spec.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+/, '').split(',')[0].trim();
        if (lead) add(lead, 'lexical', n);
      }
    });
    return [...seen].filter(([, ds]) => ds.length > 1 && ds.some((d) => d.kind === 'lexical')).map(([name, ds]) => ({ name, lines: ds.map((d) => d.line) }));
  }

  function plan(parsed, current, { rename = null } = {}) {
    const M = window.HCCodeMerge;
    const notes = [];
    const unsure = [];
    const writes = [];
    const selfLoads = [];
    const renameNotes = [];
    for (const w of parsed.writes) {
      const now = current && current[w.path];
      const self = withoutSelfLoads(w.content, w.path);
      if (self.lines.length) selfLoads.push(`${w.path} (line ${self.lines.join(', ')})`);
      const told = withoutRenameNotes(self.content, w.path, rename);
      if (told.lines.length) renameNotes.push(`${w.path} (line ${told.lines.join(', ')})`);
      let content = told.content;
      if (typeof now === 'string' && M) {
        // Part of the file, fitted in; a guessed name kept only for code that has something in common with the file it would replace.
        const fitted = M.fit(now, content, w.path);
        if (fitted != null) content = fitted;
        else if (w.guessed && !sharesDefinition(M, now, content, w.path)) { unsure.push(w.path); continue; }
      }
      writes.push({ ...w, content });
    }
    const short = shrunk(writes, current);
    const twice = writes.map((w) => ({ path: w.path, names: twiceDeclared(w.content, w.path) })).filter((t) => t.names.length);
    // A file written again exactly as it already is changes nothing: the model is done with it.
    const same = (w) => typeof (current && current[w.path]) === 'string' && current[w.path].replace(/\s+$/, '') === w.content.replace(/\s+$/, '');
    const calls = callsFor({ ...parsed, writes: writes.filter((w) => !short.includes(w.path) && !same(w) && !twice.some((t) => t.path === w.path)) });
    for (const t of twice) notes.push(`${NOTE} ${t.path} was not written: it declares ${t.names.map((d) => `${d.name} twice (lines ${d.lines.join(' and ')})`).join(', and ')}, and a file that does that does not load. Declare each name once: a name loaded from another file is not defined again, and no other file is copied in. Then write ${t.path} again, whole.`);
    if (renameNotes.length) notes.push(`${NOTE} a comment about the rename named "${rename.from}" again, so it was left out of ${renameNotes.join(' and ')}. Write no comment about what you changed.`);
    if (selfLoads.length) notes.push(`${NOTE} a file cannot load itself, so the line that did was left out of ${selfLoads.join(' and ')}. Load a file only from another file that uses it.`);
    if (unsure.length) notes.push(`${NOTE} the code in your answer did not say which file it is for, and it is not ${named(unsure)}, so nothing was written for it. Put a line FILE: and the path just above each file you write, with the whole file in the block.`);
    if (short.length) notes.push(`${NOTE} ${named(short)} would have been written much shorter than ${short.length > 1 ? 'they are' : 'it is'}, so ${short.length > 1 ? 'they were' : 'it was'} not written. Write ${short.length > 1 ? 'each one' : 'it'} again in full, keeping every part you were not asked to change.`);
    if (!parsed.writes.length && !parsed.reads.length && /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/.test(parsed.said)) notes.push(`${NOTE} your answer shows code, but no file was named for it, so nothing was written. If it belongs in a file, write a line FILE: followed by the file's path just above the code block, with the whole file in the block.`);
    if (parsed.cut) notes.push(`${NOTE} your answer was cut off inside a file, so that file was not written. Write it again, complete, and nothing else.`);
    return { calls, note: notes.join('\n') };
  }

  /**
   * A model's answer, read for the loop: `{ calls, note, said }`, the calls
   * carrying ids as a model's own would. `read(path)` gives a file as it is
   * now, to catch one written much shorter and to fit a part of it in; a
   * file it cannot read is new, or not one to read without asking, and is
   * taken as new. `opts` are parseReply's, the project's files and the files
   * the request names, and `rename`, what the request renames.
   */
  async function turnOf(text, read, opts = {}) {
    const parsed = parseReply(text, opts);
    const current = {};
    for (const w of parsed.writes) { try { current[w.path] = await read(w.path); } catch { /* new, or not read without asking */ } }
    const { calls, note } = plan(parsed, current, opts);
    const stamp = Date.now();
    return { calls: calls.map((c, i) => ({ id: `light_${stamp}_${i}`, ...c })), note, said: parsed.said };
  }

  /**
   * The files an answer would write much shorter than they are: a small model
   * asked for a whole file sometimes stops half way and the rest is lost.
   * `current` maps a path to the file as it is now. A file under 30 lines, or
   * one that keeps 60 percent of its lines, is not in the list.
   */
  function shrunk(writes, current) {
    const lines = (t) => String(t).split('\n').length;
    return (writes || []).filter((w) => {
      const now = current && current[w.path];
      return typeof now === 'string' && lines(now) >= 30 && lines(w.content) < lines(now) * 0.6;
    }).map((w) => w.path);
  }

  // ── What the model reads ─────────────────────────────────────────────

  const argsOf = (call) => { try { return JSON.parse(call.function.arguments || '{}'); } catch { return {}; } };

  /** One call of the conversation, as the plain text the model would have written it. */
  function callText(call) {
    const a = argsOf(call);
    const name = call.function && call.function.name;
    if (name === 'write_file') {
      const body = String(a.content == null ? '' : a.content);
      const ticks = body.includes(TICKS) ? '`'.repeat(4) : TICKS;
      return `FILE: ${a.path}\n${ticks}\n${body.replace(/\n$/, '')}\n${ticks}`;
    }
    if (name === 'read_file') return `READ: ${a.path}`;
    // A command in light mode is one HashCortX ran, never the model: it is said in the result, not as a line the model wrote.
    if (name === 'shell_run') return '';
    return `${name}`;
  }

  /** Added to each of the app's notes, which name tools this model does not have. */
  const NO_TOOLS = 'Here there are no tools: a file is changed by writing it whole in a FILE block, and a file is seen by writing READ: and its path. ' +
    'Commands and tests are run by HashCortX after your change; never write a RUN line or what a command printed.';

  /** How a note written for a model with tools names a tool's arguments: words this model cannot act on. */
  const TOOL_ARGS = / (?:with|using) shell_run: command "[^"]*", args \[[^\]]*\]/g;

  /** Said after files are written, so a model that has finished knows how to say so. */
  const DONE_HINT = 'Write a FILE block only for a file that must still change. If the work is done, answer with one sentence saying what you did, and no FILE blocks.';

  const clip = (text, max) => { const s = String(text == null ? '' : text); return s.length > max ? `${s.slice(0, max)}\n[cut: ${s.length - max} more characters]` : s; };

  /**
   * A command's record as a person would read it: how it ended first, then
   * what it printed with its own line breaks. A long output keeps the lines
   * that report a failure and its ending (js/code/digest.js) rather than only
   * its start, where a test runner lists what passed.
   */
  function runText(body, max) {
    let r = null;
    try { r = JSON.parse(body); } catch { /* plain text */ }
    if (!r || typeof r !== 'object' || (typeof r.stdout !== 'string' && typeof r.stderr !== 'string')) return null;
    const shorten = (t) => (t.length <= max ? t : window.HCCodeDigest ? window.HCCodeDigest.digestText(t, max) : `${t.slice(0, max >> 1)}\n[cut: ${t.length - max} characters]\n${t.slice(-(max >> 1))}`);
    const printed = [r.stdout, r.stderr].map((s) => String(s || '').replace(/\s+$/, '')).filter(Boolean).join('\n');
    const ended = r.timedOut ? 'it ran out of time and was stopped' : r.stopped ? 'it was stopped' : typeof r.code === 'number' ? `exit code ${r.code}${r.code === 0 ? '' : ', it failed'}` : '';
    return { ended, printed: printed ? shorten(printed) : '(it printed nothing)' };
  }

  /** One result, as a person's note to the model. */
  function resultText(message, call) {
    const a = call ? argsOf(call) : {};
    const name = (call && call.function.name) || message.name;
    const body = String(message.content == null ? '' : message.content);
    let error = '';
    try { const j = JSON.parse(body); if (j && typeof j === 'object' && j.error) error = String(j.error); } catch { /* plain text */ }
    if (error && name === 'read_file' && /ENOENT|no such file|There is no file/i.test(error)) return `There is no file at ${a.path}. A file already in the project is named by its place in it, its folders included, as the project shows it; READ it by that name before you change it. Only a new file is written whole in a FILE block.`;
    if (error) return `That did not work${a.path ? ` for ${a.path}` : ''}: ${clip(error, 400)}`;
    if (name === 'write_file') return `Wrote ${a.path}.`;
    if (name === 'read_file') return `${a.path}:\n${TICKS}\n${clip(body, 6000)}\n${TICKS}`;
    if (name === 'shell_run') {
      const command = [a.command, ...(Array.isArray(a.args) ? a.args : [])].filter(Boolean).join(' ');
      const run = runText(body, 2500);
      if (run) return `HashCortX ran ${command}${run.ended ? ` (${run.ended})` : ''}:\n${TICKS}\n${run.printed}\n${TICKS}`;
      return `HashCortX ran ${command}:\n${TICKS}\n${clip(body, 2500)}\n${TICKS}`;
    }
    return clip(body, 1500);
  }

  /**
   * The conversation as a model in light mode reads it: the calls and results
   * of the app's own history turned back into the plain text of the format it
   * was told to write, so no tool call is ever shown to it. The system turn
   * and the person's own turns pass through as they are.
   */
  function callMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const calls = new Map();
    for (const m of list) if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) calls.set(c.id, c);
    const out = [];
    for (const m of list) {
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const said = String(m.content || '').trim();
        const content = [said, ...m.tool_calls.map(callText)].filter(Boolean).join('\n\n');
        if (content) out.push({ role: 'assistant', content });   // a turn that was only the app's command is not the model's
      } else if (m.role === 'tool') {
        const note = resultText(m, calls.get(m.tool_call_id));
        const last = out[out.length - 1];
        if (last && last.role === 'user' && (last.fromTool || last.fromApp)) { last.content += `\n\n${note}`; last.fromTool = true; }
        else out.push({ role: 'user', content: note, fromTool: true });
        const called = calls.get(m.tool_call_id);
        if (called && called.function && called.function.name === 'write_file' && !out[out.length - 1].doneHint) { out[out.length - 1].content += `\n\n${DONE_HINT}`; out[out.length - 1].doneHint = true; }
      } else if (m.role === 'user' && (m.note || String(m.content || '').startsWith(NOTE))) {
        // The app's notes are written for a model with tools; this one changes files only by writing them.
        out.push({ ...m, content: `${String(m.content).replace(TOOL_ARGS, '')}\n\n${NO_TOOLS}`, fromApp: true });
      } else out.push(m);
    }
    // The hint goes once, at the end of the note it belongs to.
    return out.map(({ fromTool, fromApp, doneHint, ...m }) => (doneHint ? { ...m, content: `${m.content.replace(`\n\n${DONE_HINT}`, '')}\n\n${DONE_HINT}` } : m));
  }

  window.HCCodeLight = { SYSTEM, applies, billionsInName, parseReply, callsFor, shrunk, plan, turnOf, callMessages, cutOff, pathsIn, knownFiles, resolve, fits, testHint };
})();
