// ==============================================================
// Files that use each other, joined up
//
// Moving a function into a file of its own, a small model writes the new file
// and the calls to it, and leaves out what joins them: the new file exports
// nothing, and the files that call it never load it. Each file reads well on
// its own, and the project stops working.
//
// This reads the project's CommonJS files (require and module.exports) and
// finds four such gaps in the files a run changed: a file that calls a
// function another file of the project defines, without loading it or
// defining it itself; a file that takes a name from another file that does
// not export it; a file another loads that exports nothing; and a file
// loaded whole and called as a function when it exports an object of names. Each is said
// with what would join it up. Files written as ES modules, and names the
// language has itself, are left alone.
//
// Pure: files in, findings out. Loaded after js/code/merge.js, whose reading
// of definitions it uses, before the Coder mode, and published as
// window.HCCodeWiring. Checked by scripts/checks/code-wiring.mjs.
// ==============================================================

(function () {
  'use strict';

  const M = () => window.HCCodeMerge;
  const JS = /\.(?:c?js)$/i;
  const NOTE = 'Note from HashCortX, not from the person:';

  /** A path as `./x` from the folder of `from`, the way require writes it. */
  function relative(from, to) {
    const a = String(from).split('/').slice(0, -1);
    const b = String(to).replace(/\.c?js$/i, '').split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const up = a.slice(i).map(() => '..');
    const rest = b.slice(i).join('/');
    return up.length ? `${up.join('/')}/${rest}` : `./${rest}`;
  }

  /** The project file a require from `from` names, or ''. */
  function target(from, spec, paths) {
    if (!/^\.\.?\//.test(spec)) return '';
    const parts = String(from).split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '.' || !seg) continue;
      if (seg === '..') parts.pop(); else parts.push(seg);
    }
    const base = parts.join('/');
    return [base, `${base}.js`, `${base}.cjs`, `${base}/index.js`].find((p) => paths.includes(p)) || '';
  }

  /** What a file loads (`{ spec, names, whole }` for each require) and what it exports, by name, and whether it exports at all. */
  function shapeOf(text) {
    const t = String(text || '');
    const loads = [];
    for (const m of t.matchAll(/(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const names = m[1].startsWith('{') ? m[1].slice(1, -1).split(',').map((s) => s.split(':')[0].trim()).filter(Boolean) : [];
      loads.push({ spec: m[2], names, whole: m[1].startsWith('{') ? '' : m[1] });
    }
    const exported = new Set();
    let exports = false;
    for (const m of t.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) { exports = true; m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).forEach((n) => exported.add(n)); }
    for (const m of t.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) { exports = true; exported.add(m[1]); }
    if (/module\.exports\s*=\s*(?!\{)/.test(t)) exports = true;
    return { loads, exported, exports, esm: /^\s*(?:import\s|export\s)/m.test(t) };
  }

  /**
   * The gaps among `files` (`[{ path, text }]`, the project's) in those the
   * run changed (`changed`, paths from the project's folder): `[{ path, say }]`.
   */
  function gaps(files, changed) {
    const js = (files || []).filter((f) => JS.test(f.path));
    const paths = js.map((f) => f.path);
    const shape = new Map(js.map((f) => [f.path, shapeOf(f.text)]));
    const defines = new Map(js.map((f) => [f.path, (M() ? M().definitions(f.text, 'js') : []).map((d) => d.name)]));
    const owner = new Map();
    for (const [p, names] of defines) for (const n of names) owner.set(n, owner.has(n) ? '' : p);   // a name two files define has no one owner
    const touched = new Set((changed || []).map(String));
    const out = [];
    for (const f of js) {
      const s = shape.get(f.path);
      if (s.esm) continue;
      const mine = new Set([...defines.get(f.path), ...s.loads.flatMap((l) => [...l.names, l.whole].filter(Boolean))]);
      for (const l of s.loads) {
        const to = target(f.path, l.spec, paths);
        if (!to || shape.get(to).esm) continue;
        if (!touched.has(f.path) && !touched.has(to)) continue;
        if (!shape.get(to).exports) { out.push({ path: to, say: `${to} exports nothing, and ${f.path} loads it: add module.exports = { ${defines.get(to).join(', ')} }; at its end.` }); continue; }
        // Loaded whole, called as a function, from a file that exports an object of names.
        if (l.whole && touched.has(f.path) && shape.get(to).exported.has(l.whole) && new RegExp(`(?<![\\w$.])${l.whole}\\s*\\(`).test(f.text)) {
          out.push({ path: f.path, say: `${f.path} calls ${l.whole}(...), but ${to} exports an object holding ${l.whole}: write const { ${l.whole} } = require('${l.spec}'); in place of const ${l.whole} = require('${l.spec}');.` });
        }
        for (const n of l.names) if (!shape.get(to).exported.has(n)) out.push({ path: to, say: `${f.path} takes ${n} from ${to}, which does not export it: add ${n} to its module.exports.` });
      }
      if (!touched.has(f.path)) continue;
      const body = String(f.text).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, ' ');
      for (const m of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const n = m[1], from = owner.get(n);
        if (!from || from === f.path || mine.has(n)) continue;
        mine.add(n);
        out.push({ path: f.path, say: `${f.path} calls ${n}, which ${from} defines, without loading it: add const { ${n} } = require('${relative(f.path, from)}'); at its top.` });
      }
    }
    return out.filter((g, i) => out.findIndex((x) => x.say === g.say) === i);
  }

  /** The note sending a run back to join them up, or null when there is nothing to join. */
  function note(found) {
    if (!found || !found.length) return null;
    return { kind: 'wiring', step: 'Sent back: files that use each other are not joined up', message: `${NOTE} the files you changed use each other, and are not joined up:\n${found.slice(0, 8).map((g) => `- ${g.say}`).join('\n')}\nMake these changes, keeping everything else in those files as it is, then finish.` };
  }

  window.HCCodeWiring = { relative, target, shapeOf, gaps, note };
})();
