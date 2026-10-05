// ==============================================================
// A part of a file, fitted into the whole
//
// Asked to change one function in a long file, a small model writes back that
// function and nothing else. Written as the file, it would throw the rest
// away; refused, nothing is changed at all. So when what a model writes for a
// file holds some of the file's top-level definitions and leaves others out,
// it is read as those definitions, and each is put in place of the one of the
// same name in the file as it is. A definition the file does not have is
// added: in a script before its exports, in Python before its main guard,
// otherwise at the end. An exports list it writes adds its names to the
// file's own, and a module it loads that the file does not is loaded with the
// others. Everything else in the file stays exactly as it was.
//
// JavaScript (and the languages written like it) and Python. A file in any
// other language, or a part with no definitions in it, is not merged.
//
// Pure: strings in, a string out. Loaded before the Coder mode and published
// as window.HCCodeMerge. Checked by scripts/checks/code-merge.mjs.
// ==============================================================

(function () {
  'use strict';

  const JS = /\.(?:m?js|cjs|jsx|ts|tsx)$/i;
  const PY = /\.py$/i;
  const langOf = (path) => (JS.test(path) ? 'js' : PY.test(path) ? 'py' : '');

  const JS_DECL = /^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|class\s+([A-Za-z_$][\w$]*)\b|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/;
  const PY_DECL = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(|^class\s+([A-Za-z_]\w*)\b/;

  /** Where a JavaScript definition starting at `from` ends: past its closing bracket, or its line, with the rest of that line. */
  function jsEnd(text, from) {
    let depth = 0, quote = '', i = from;
    for (; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === '/' && n === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e - 1; continue; }
      if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{' || c === '(' || c === '[') { depth++; continue; }
      if (c === '}' || c === ')' || c === ']') { depth--; continue; }
      if (c === '\n' && depth <= 0) {
        // At the margin of its brackets a line ends the definition, unless it leaves an arrow or an operator hanging.
        const line = text.slice(text.lastIndexOf('\n', i - 1) + 1, i).trim();
        if (!/(?:=>|[=+\-*/,(&|?:.])$/.test(line)) return i + 1;
      }
    }
    return text.length;
  }

  /** Where a Python definition starting at `from` ends: before the next line at the margin that is not blank, a comment or a decorator of what follows. */
  function pyEnd(text, from) {
    let at = text.indexOf('\n', from);
    while (at >= 0 && at < text.length) {
      const next = text.indexOf('\n', at + 1);
      const line = text.slice(at + 1, next < 0 ? text.length : next);
      if (line.trim() && !/^\s/.test(line)) return at + 1;
      if (next < 0) return text.length;
      at = next;
    }
    return text.length;
  }

  /** The top-level definitions in a file: `{ name, start, end }` in order, `start` at the start of its line. */
  function definitions(text, lang) {
    const out = [];
    const src = String(text || '');
    const re = /^.*$/gm;
    let m;
    while ((m = re.exec(src))) {
      if (m.index === re.lastIndex) re.lastIndex++;
      const d = (lang === 'py' ? PY_DECL : JS_DECL).exec(m[0]);
      if (!d) continue;
      const name = d[1] || d[2] || d[3];
      const end = lang === 'py' ? pyEnd(src, m.index) : jsEnd(src, m.index);
      out.push({ name, start: m.index, end });
      re.lastIndex = Math.max(re.lastIndex, end);
    }
    return out;
  }

  const LOADS = { js: /^(?:(?:const|let|var)\s+[^=\n]+=\s*require\s*\([^)]*\)[ \t]*;?|import\s[^\n]*from\s+['"][^'"]+['"][ \t]*;?|import\s+['"][^'"]+['"][ \t]*;?)[ \t]*$/gm, py: /^(?:import\s+[\w., ]+|from\s+[\w.]+\s+import\s+[^\n]+)[ \t]*$/gm };
  const EXPORTS = /^module\.exports\s*=\s*\{([^}]*)\}\s*;?\s*$/m;

  /**
   * Whether `written` is part of `current` rather than the whole of it: it
   * defines something and leaves out something the file defines, and it is
   * either only new definitions, or only some of the file's own. One that
   * keeps some of the file's definitions, leaves out others and brings new
   * names is the whole file rewritten, a rename among it.
   */
  function isPart(current, written, path) {
    const lang = langOf(path);
    if (!lang || typeof current !== 'string') return false;
    const had = definitions(current, lang).map((d) => d.name);
    const gave = definitions(written, lang).map((d) => d.name);
    const kept = gave.filter((n) => had.includes(n));
    const fresh = gave.filter((n) => !had.includes(n));
    const missing = had.filter((n) => !gave.includes(n));
    if (!gave.length || !missing.length) return false;
    return !kept.length || !fresh.length;
  }

  /**
   * `current` with the definitions `written` holds put in, as the head of
   * this file describes. Returns null when `written` is not part of the file.
   */
  function fit(current, written, path) {
    if (!isPart(current, written, path)) return null;
    const lang = langOf(path);
    let out = String(current);
    const parts = definitions(written, lang).map((d) => ({ name: d.name, text: written.slice(d.start, d.end).replace(/\s+$/, '') }));
    for (const part of parts) {
      const here = definitions(out, lang).find((d) => d.name === part.name);
      if (here) {
        const tail = out.slice(here.start, here.end).match(/\s*$/)[0] || '\n';
        out = out.slice(0, here.start) + part.text + tail + out.slice(here.end);
        continue;
      }
      // A new definition goes before the exports or the main guard, else at the end.
      const guard = lang === 'py' ? /^if __name__\s*==/m.exec(out) : /^(?:module\.exports\b|export\s*\{)/m.exec(out);
      const gap = lang === 'py' ? '\n\n\n' : '\n\n';
      if (guard) out = `${out.slice(0, guard.index)}${part.text}${gap}${out.slice(guard.index)}`;
      else out = `${out.replace(/\s*$/, '')}${gap}${part.text}\n`;
    }
    // Modules the part loads that the file does not.
    const loads = (String(written).match(LOADS[lang]) || []).map((l) => l.trim()).filter((l) => !out.includes(l));
    if (loads.length) {
      const have = [...out.matchAll(LOADS[lang])];
      const at = have.length ? have[have.length - 1].index + have[have.length - 1][0].length : 0;
      out = at ? `${out.slice(0, at)}\n${loads.join('\n')}${out.slice(at)}` : `${loads.join('\n')}\n${out}`;
    }
    // An exports list adds its names to the file's own.
    if (lang === 'js') {
      const mine = EXPORTS.exec(out), theirs = EXPORTS.exec(written);
      if (mine && theirs) {
        const names = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
        const all = [...names(mine[1])];
        for (const n of names(theirs[1])) if (!all.includes(n)) all.push(n);
        out = out.replace(EXPORTS, `module.exports = { ${all.join(', ')} };`);
      }
    }
    return out;
  }

  window.HCCodeMerge = { langOf, definitions, isPart, fit };
})();
