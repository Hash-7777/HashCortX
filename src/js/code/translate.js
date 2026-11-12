// ==============================================================
// Reading commands answered by the app's own tools
//
// Models list, read and search with the commands they learned: `ls`, `cat`,
// `grep -rn`, `find -name`, and on Windows `dir`, `type`, `findstr`,
// `Get-Content`, `Select-String`. Each started a program, which on Windows
// was often not there (no `grep`, no `cat` outside PowerShell's aliases),
// and each asked in Manual and failed or asked again. The app has a tool for
// each of them, which needs no program and asks nothing inside the project:
//
//   ls, dir, Get-ChildItem (one folder)          list_dir
//   cat, type, Get-Content, head (one file)      read_file, its first N lines
//   grep -r, rg, findstr /s, Select-String       grep_code
//   find -name, where /r, Get-ChildItem -Recurse -Filter    fuzzy_find
//   pwd, cd alone, Get-Location                  the folder commands run in
//   which, where, Get-Command                    the programs the app found
//                                                (js/code/host-tools.js)
//
// Only when every word is one the table knows: a flag it does not, a pipe,
// a redirect or a second command, and the command runs exactly as before.
// `dir`, `type`, `findstr` and `where` are translated on Windows only, where
// they are those programs. The answer says the app gave it and which tool to
// call next time, so a model learns the shorter road; the tool it runs is
// the tool's own, Permission Guard and all.
//
// toTool, said and isAnswer are pure. Published as window.HCCodeTranslate.
// Checked by scripts/checks/translate.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How an answer from the app begins, so nothing counts it as a command that ran. */
  const ANSWERED = "Answered by the app";
  const WHAT = { list_dir: 'listing', read_file: 'reading', grep_code: 'search', fuzzy_find: 'search by name' };

  /** The words of a command written in one string, quotes kept together; null for a pipe, a redirect or a second command. */
  function tokenize(s) {
    const text = String(s || '');
    if (/[|<>;&`]|\$\(/.test(text)) return null;
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }

  function wordsOf(command, args) {
    const head = tokenize(command);
    if (!head || !head.length) return null;
    const rest = Array.isArray(args) ? args.map(String) : [];
    if (rest.some((a) => /^[|<>;&]+$/.test(a))) return null;
    return [...head, ...rest];
  }

  const progOf = (w) => String(w || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  const extOf = (spec) => { const m = /^\*\.([A-Za-z0-9]+)$/.exec(String(spec || '')); return m ? m[1] : null; };
  /** A file spec such as src\*.js or *.js: its folder and kind, or null. */
  function specOf(spec) {
    const s = String(spec || '');
    const at = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const ext = extOf(at >= 0 ? s.slice(at + 1) : s);
    if (!ext) return null;
    return { dir: at >= 0 ? s.slice(0, at) || '.' : '.', ext };
  }
  const nameOf = (pat) => { const q = String(pat || '').replace(/[*?]/g, ''); return q || null; };
  const posInt = (s) => (/^\d+$/.test(String(s)) && Number(s) > 0 ? Number(s) : null);

  /** PowerShell's way: -Name value pairs, bare switches, and the words left over; null for a parameter not in `known`. */
  function psArgs(words, known, switches) {
    const named = {}, loose = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^-[A-Za-z]/.test(w)) {
        const k = w.slice(1).toLowerCase();
        if (switches.includes(k)) { named[k] = true; continue; }
        if (!known.includes(k) || i + 1 >= words.length) return null;
        named[k] = words[++i];
      } else loose.push(w);
    }
    return { named, loose };
  }

  const list = (path) => ({ tool: 'list_dir', arguments: { path: path || '.' } });
  const read = (path, n) => ({ tool: 'read_file', arguments: n ? { path, start_line: 1, end_line: n } : { path } });
  const grep = (dir, pattern, ext) => ({ tool: 'grep_code', arguments: { dir: dir || '.', pattern, ...(ext ? { file_ext: ext } : {}) } });
  const find = (dir, query) => (query ? { tool: 'fuzzy_find', arguments: { dir: dir || '.', query } } : null);

  function ls(w) {
    const flags = w.filter((x) => x.startsWith('-')), rest = w.filter((x) => !x.startsWith('-'));
    if (!flags.every((f) => /^-[lahAF1Gp]+$/.test(f)) || rest.length > 1) return null;
    return list(rest[0]);
  }

  function gci(w) {
    const p = psArgs(w, ['path', 'literalpath', 'filter'], ['force', 'name', 'file', 'recurse']);
    if (!p || p.loose.length > 1) return null;
    const dir = p.named.path || p.named.literalpath || p.loose[0];
    if (p.named.recurse) return p.named.filter ? find(dir, nameOf(p.named.filter)) : null;
    if (p.named.filter) return null;
    return list(dir);
  }

  function cat(w) {
    if (w.some((x) => x.startsWith('-')) || w.length !== 1) return null;
    return read(w[0]);
  }

  function getContent(w) {
    const p = psArgs(w, ['path', 'literalpath', 'totalcount', 'head', 'first'], ['raw']);
    if (!p) return null;
    const files = [p.named.path || p.named.literalpath, ...p.loose].filter(Boolean);
    if (files.length !== 1) return null;
    const count = p.named.totalcount || p.named.head || p.named.first;
    if (count != null && !posInt(count)) return null;
    return read(files[0], count != null ? posInt(count) : null);
  }

  function head(w) {
    let n = 10;
    const rest = [];
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      if (x === '-n' && posInt(w[i + 1])) { n = posInt(w[++i]); continue; }
      const m = /^(?:-n|-|--lines=)(\d+)$/.exec(x);
      if (m && posInt(m[1])) { n = posInt(m[1]); continue; }
      if (x.startsWith('-')) return null;
      rest.push(x);
    }
    return rest.length === 1 ? read(rest[0], n) : null;
  }

  function grepCmd(w) {
    let recursive = false, ext = null, pattern = null;
    const rest = [];
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      if (/^-[rRniHIs]+$/.test(x)) { if (/[rR]/.test(x)) recursive = true; continue; }
      if (x === '--recursive') { recursive = true; continue; }
      if (x === '--line-number' || x === '--ignore-case') continue;
      if (x.startsWith('--include=')) { ext = extOf(x.slice(10)); if (!ext) return null; continue; }
      if (x === '--include') { ext = extOf(w[++i]); if (!ext) return null; continue; }
      if (x === '-e') { pattern = w[++i]; if (pattern == null) return null; continue; }
      if (x.startsWith('-')) return null;
      rest.push(x);
    }
    if (pattern == null) pattern = rest.shift();
    if (!recursive || !pattern || rest.length > 1) return null;
    return grep(rest[0], pattern, ext);
  }

  function rg(w) {
    let ext = null;
    const rest = [];
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      if (['-n', '-i', '-S', '--line-number', '--ignore-case', '--smart-case'].includes(x)) continue;
      if (x === '-t' || x === '--type') { ext = w[++i]; if (!/^[A-Za-z0-9]+$/.test(ext || '')) return null; continue; }
      if (x.startsWith('--type=')) { ext = x.slice(7); if (!/^[A-Za-z0-9]+$/.test(ext)) return null; continue; }
      if (x === '-g' || x === '--glob') { ext = extOf(w[++i]); if (!ext) return null; continue; }
      if (x.startsWith('-')) return null;
      rest.push(x);
    }
    const pattern = rest.shift();
    if (!pattern || rest.length > 1) return null;
    return grep(rest[0], pattern, ext);
  }

  function findstr(w) {
    let sub = false, pattern = null;
    const rest = [];
    for (const x of w) {
      const f = x.toLowerCase();
      if (f === '/s') { sub = true; continue; }
      if (['/n', '/i', '/p'].includes(f)) continue;
      if (f.startsWith('/c:')) { pattern = x.slice(3); continue; }
      if (x.startsWith('/')) return null;
      rest.push(x);
    }
    if (pattern == null) pattern = rest.shift();
    if (!sub || !pattern || rest.length !== 1) return null;
    const spec = specOf(rest[0]);
    return spec ? grep(spec.dir, pattern, spec.ext) : null;
  }

  function selectString(w) {
    const p = psArgs(w, ['path', 'pattern'], ['simplematch', 'casesensitive']);
    if (!p || p.loose.length || !p.named.path || !p.named.pattern) return null;
    const spec = specOf(p.named.path);
    return spec ? grep(spec.dir, p.named.pattern, spec.ext) : null;
  }

  function findCmd(w) {
    let i = 0, dir = '.', name = null;
    if (w[0] && !w[0].startsWith('-')) { dir = w[0]; i = 1; }
    for (; i < w.length; i++) {
      const x = w[i];
      if ((x === '-name' || x === '-iname') && w[i + 1]) { name = w[++i]; continue; }
      if (x === '-type' && w[i + 1] === 'f') { i++; continue; }
      return null;
    }
    return name ? find(dir, nameOf(name)) : null;
  }

  function which(w, o) {
    const H = window.HCCodeHostTools;
    if (w.length !== 1 || !H || !Array.isArray(o.programs) || !H.NAMES.includes(w[0])) return null;
    return { answer: `${w[0]} is ${o.programs.includes(w[0]) ? '' : 'not '}installed here (the app looked where a command would; nothing was run).` };
  }

  /**
   * The app's own tool for a reading command: { tool, arguments } with the
   * places as written, or { answer } for where it is and which programs are
   * here; null for anything else, which runs as a command. `o`: os, here
   * (the folder it runs in), programs (js/code/host-tools.js ask).
   */
  function toTool(command, args, o = {}) {
    const w = wordsOf(command, args);
    if (!w) return null;
    const prog = progOf(w[0]), rest = w.slice(1), windows = String(o.os || '').toLowerCase() === 'windows';
    switch (prog) {
      case 'ls': return ls(rest);
      case 'get-childitem': case 'gci': return gci(rest);
      case 'dir': return windows && rest.every((x) => !x.startsWith('/') || ['/b', '/w'].includes(x.toLowerCase())) && rest.filter((x) => !x.startsWith('/')).length <= 1 ? list(rest.find((x) => !x.startsWith('/'))) : null;
      case 'cat': return cat(rest);
      case 'type': return windows && rest.length === 1 && !rest[0].startsWith('/') ? read(rest[0]) : null;
      case 'get-content': case 'gc': return getContent(rest);
      case 'head': return head(rest);
      case 'grep': return grepCmd(rest);
      case 'rg': return rg(rest);
      case 'findstr': return windows ? findstr(rest) : null;
      case 'select-string': case 'sls': return selectString(rest);
      case 'find': return findCmd(rest);
      case 'where': return windows && rest[0] && rest[0].toLowerCase() === '/r' && rest.length === 3 ? find(rest[1], nameOf(rest[2])) : windows ? which(rest, o) : null;
      case 'pwd': case 'get-location': return !rest.length && o.here ? { answer: `The folder commands run in: ${o.here}` } : null;
      case 'cd': return !rest.length && o.here ? { answer: `The folder commands run in: ${o.here}` } : null;
      case 'which': case 'get-command': case 'gcm': return which(rest, o);
      default: return null;
    }
  }

  /** What goes before the answer: that the app gave it, with no program started, and what to call next time. */
  function said(t) {
    if (!t || !t.tool) return `${ANSWERED}, with no program started.\n`;
    const more = t.tool === 'grep_code' ? " The app's search is case-insensitive and covers the folder and every folder in it." : t.tool === 'fuzzy_find' ? ' It matches names approximately.' : '';
    return `${ANSWERED}'s own ${WHAT[t.tool]} (${t.tool}), with no program started; call ${t.tool} directly next time.${more}\n`;
  }

  /** Whether a tool result is one of these answers, and so no command ran. */
  const isAnswer = (text) => String(text == null ? '' : text).startsWith(ANSWERED);

  window.HCCodeTranslate = { toTool, said, isAnswer };
})();
