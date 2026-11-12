// ==============================================================
// The line endings a new file takes
//
// A model writes LF. A file it replaces keeps the CRLF endings it had
// (js/code/patch.js keepLineEndings), but a NEW file was written as the model
// wrote it, so in a project that uses CRLF every file the agent made stood
// out from the files beside it, and a tool that reads the project by its
// endings saw a mixture. A new file now takes the endings the project says it
// uses, asked in this order:
//
//   1. the project's .gitattributes (`eol=crlf`, `eol=lf`; a file marked
//      `binary` or `-text` is left as it is), the last matching line winning;
//   2. its .editorconfig (`end_of_line`), the last matching section winning;
//   3. most of the files beside the new one, of its own kind first.
//
// Only the project folder's own two settings files are read, not ones in its
// folders. Only text with plain LF endings is ever changed, and only to CRLF:
// text that carries a CR already is how a model that means its endings says
// so, as keepLineEndings has it. A project that says nothing changes nothing.
//
// The matchers and the choice are pure; forNewFile reads through what it is
// handed, so it never asks and never throws.
// Published as window.HCCodeLineEndings. Checked by scripts/checks/line-endings.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many files beside a new one are read to see what most of them use. */
  const MOST_BESIDE = 5;
  /** A file larger than this is passed over: a few small ones say as much. */
  const MOST_BYTES = 200000;

  const escape = (c) => c.replace(/[.+^$()|\\]/g, '\\$&');

  /**
   * A regular expression for a .gitattributes or .editorconfig pattern,
   * matched against a path from the project folder with `/` between names.
   * A pattern with no slash in it matches the name in any folder.
   */
  function matcher(pattern, { braces = false } = {}) {
    let p = String(pattern).trim();
    const anywhere = !p.replace(/\/$/, '').includes('/');
    p = p.replace(/^\//, '');
    let out = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*' && p[i + 1] === '*') {
        if (p[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else if (c === '*') out += '[^/]*';
      else if (c === '?') out += '[^/]';
      else if (c === '[') {
        const end = p.indexOf(']', i + 1);
        if (end < 0) { out += '\\['; continue; }
        out += '[' + p.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = end;
      } else if (braces && c === '{') {
        const end = p.indexOf('}', i + 1);
        const inside = end < 0 ? '' : p.slice(i + 1, end);
        if (!inside.includes(',')) { out += '\\{'; continue; }
        out += '(?:' + inside.split(',').map((s) => s.split('').map(escape).join('').replace(/\*/g, '[^/]*')).join('|') + ')';
        i = end;
      } else out += escape(c);
    }
    return new RegExp('^' + (anywhere ? '(?:.*/)?' : '') + out + '$');
  }

  const lower = (s) => String(s).toLowerCase();

  /** 'crlf', 'lf', 'none' (marked as not text) or null, from a .gitattributes file for `rel`. */
  function fromGitattributes(text, rel) {
    if (typeof text !== 'string') return null;
    let eol = null, isText = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [pattern, ...attrs] = line.split(/\s+/);
      let re;
      try { re = matcher(pattern); } catch { continue; }
      if (!re.test(rel)) continue;
      for (const a of attrs.map(lower)) {
        if (a === 'eol=crlf') eol = 'crlf';
        else if (a === 'eol=lf') eol = 'lf';
        else if (a === 'binary' || a === '-text') isText = false;
        else if (a === 'text' || a.startsWith('text=')) isText = true;
      }
    }
    if (isText === false) return 'none';
    return eol;
  }

  /** 'crlf', 'lf' or null, from an .editorconfig file for `rel`. */
  function fromEditorconfig(text, rel) {
    if (typeof text !== 'string') return null;
    let eol = null, re = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const section = /^\[(.*)\]$/.exec(line);
      if (section) {
        try { re = matcher(section[1], { braces: true }); } catch { re = null; }
        continue;
      }
      const kv = /^([^=:]+)[=:](.*)$/.exec(line);
      if (!kv || !re || lower(kv[1].trim()) !== 'end_of_line' || !re.test(rel)) continue;
      const v = lower(kv[2].trim());
      eol = v === 'crlf' || v === 'lf' ? v : null;
    }
    return eol;
  }

  /** 'crlf' or 'lf' when most of `texts` end every line that way, else null. */
  function fromFiles(texts) {
    let crlf = 0, lf = 0;
    for (const t of texts || []) {
      const s = String(t);
      if (!s.includes('\n')) continue;
      if (!/(^|[^\r])\n/.test(s)) crlf++;
      else if (!s.includes('\r')) lf++;
    }
    return crlf > lf ? 'crlf' : lf > crlf ? 'lf' : null;
  }

  /** `{ eol, from }`: the first of the three that says, in order. */
  function choose({ gitattributes = null, editorconfig = null, beside = null } = {}) {
    if (gitattributes === 'none') return { eol: null, from: '.gitattributes' };
    if (gitattributes) return { eol: gitattributes, from: '.gitattributes' };
    if (editorconfig) return { eol: editorconfig, from: '.editorconfig' };
    if (beside) return { eol: beside, from: 'the files beside it' };
    return { eol: null, from: '' };
  }

  /** `{ text, changed }`: plain LF text given CRLF when `eol` is 'crlf'; anything else as written. */
  function apply(text, eol) {
    const t = String(text);
    if (eol !== 'crlf' || t.includes('\r') || !t.includes('\n')) return { text: t, changed: false };
    return { text: t.replace(/\n/g, '\r\n'), changed: true };
  }

  const slashes = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const extOf = (name) => (/\.([^./]+)$/.exec(name) || [])[1]?.toLowerCase() || '';

  /**
   * `{ eol, from }` for a new file at `path` in the project at `root`.
   * `io.read(path)` gives a file's text and `io.list(dir)` a folder's entries
   * ({ name, path, is_dir, size }); either may throw, which is taken as
   * nothing to read. Nothing outside the project is read.
   */
  async function forNewFile(path, root, io) {
    const none = { eol: null, from: '' };
    const r = slashes(root), p = slashes(path);
    if (!r || !lower(p).startsWith(lower(r) + '/')) return none;
    const rel = p.slice(r.length + 1);
    const read = async (at) => { try { return await io.read(at); } catch { return null; } };
    const sep = String(root).includes('\\') && !String(root).includes('/') ? '\\' : '/';
    const inRoot = (name) => String(root).replace(/[\\/]+$/, '') + sep + name;
    const gitattributes = fromGitattributes(await read(inRoot('.gitattributes')), rel);
    if (gitattributes) return choose({ gitattributes });
    const editorconfig = fromEditorconfig(await read(inRoot('.editorconfig')), rel);
    if (editorconfig) return choose({ editorconfig });
    const cut = Math.max(String(path).lastIndexOf('/'), String(path).lastIndexOf('\\'));
    const dir = String(path).slice(0, cut), name = String(path).slice(cut + 1);
    let entries = [];
    try { entries = await io.list(dir); } catch { entries = []; }
    const ext = extOf(name);
    const files = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && !e.is_dir && e.name !== name && !e.name.startsWith('.') && !(e.size > MOST_BYTES))
      .sort((a, b) => (extOf(b.name) === ext) - (extOf(a.name) === ext))
      .slice(0, MOST_BESIDE);
    const texts = [];
    for (const f of files) {
      const t = await read(f.path);
      if (typeof t === 'string' && !t.includes('\0') && !t.startsWith('[Binary file')) texts.push(t);
    }
    return choose({ beside: fromFiles(texts) });
  }

  window.HCCodeLineEndings = { MOST_BESIDE, MOST_BYTES, matcher, fromGitattributes, fromEditorconfig, fromFiles, choose, apply, forNewFile };
})();
