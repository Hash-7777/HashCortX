// ==============================================================
// Several script files, as the one script a single page can run
//
// The Agent Swarm hands back a project of files and the app also offers it as
// one page — to preview, and to download and open by double-clicking. Each
// script went into that page at the tag that referenced it, unchanged.
//
// THE DEFECT THIS FIXES. Agents write modules. A real run produced
// catalogue.js exporting its products, cart.js exporting a cart, and script.js
// importing both. Put into a page as plain scripts, the first line of the
// first one — "export const products" — is a syntax error, and a syntax error
// in a script stops that whole script dead. Nothing on the page worked, and
// nothing said so. The order was wrong as well: only script.js was referenced
// by the page, so the two files it imports were added AFTER it.
//
// WHAT HAPPENS INSTEAD. The files are joined into one script, each after the
// files it imports. An import of a file that is already in the script is
// dropped, since what it names is in scope; the "export" in front of a
// declaration is dropped, for the same reason.
//
// WHAT IT REFUSES TO DO. Only the shapes that mean exactly this are joined:
// importing names from a file of the project, and exporting a declaration.
// A default export, a namespace import, an import from a package, a re-export
// and a cycle are each left alone, because guessing at them would change what
// the code does rather than where it lives. The caller is told which, and says
// so, rather than shipping a page that is quietly wrong.
//
// Pure: files in, text out. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmBundle.
// Checked by scripts/checks/swarm-bundle.mjs.
// ==============================================================

(function () {
  'use strict';

  const MAX_FILES = 40;

  // The two shapes that can be joined: importing a list of names from a file
  // of the project, and naming a file of the project for its side effect.
  const IMPORT_NAMED = /^[ \t]*import\s*(?:(\{[^}]*\})\s*from\s*)?(['"])([^'"]+)\2[ \t]*;?[ \t]*$/;
  // Anything else that starts a line with import: a default import, a
  // namespace import, a side-effect import written across lines.
  const IMPORT_ANY = /^[ \t]*import\b/;
  // export const x = 1   |   export function f()   |   export class C
  const EXPORT_DECL = /^([ \t]*)export\s+(?=(?:const|let|var|function|class|async)\b)/;
  const EXPORT_ANY = /^[ \t]*export\b/;
  const DYNAMIC_IMPORT = /\bimport\s*\(/;

  /** Whether a file is written as a module, so joining it means changing it. */
  const isModule = (code) => /^[ \t]*(import|export)\b/m.test(String(code || ''));

  /** The file a specifier names, or null when the project does not hold it. */
  function resolve(spec, files) {
    const s = String(spec || '').trim();
    if (!/^\.{0,2}\//.test(s) && !/^[\w.-]+\.\w+$/.test(s)) return null; // a package, not a file
    const base = s.split('/').pop().toLowerCase();
    if (!base) return null;
    if (files.has(base)) return base;
    // A specifier written without its extension.
    for (const ext of ['.js', '.mjs']) if (files.has(base + ext)) return base + ext;
    return null;
  }

  /**
   * One file's lines with its module syntax taken out, or a reason it cannot
   * be. An import of a file the project holds is dropped and that file is
   * noted as needed; an import of anything else stops the whole join.
   */
  function rewrite(name, code, files) {
    const out = [];
    const needs = [];
    if (DYNAMIC_IMPORT.test(code)) return { reason: `${name} loads a module while it runs` };
    for (const line of String(code).split('\n')) {
      if (IMPORT_ANY.test(line)) {
        const m = IMPORT_NAMED.exec(line);
        if (!m) return { reason: `${name} imports in a way that cannot be joined` };
        if (m[1] && /\bas\b/.test(m[1])) return { reason: `${name} renames what it imports` };
        const target = resolve(m[3], files);
        if (!target) return { reason: `${name} imports ${m[3]}, which is not one of the files` };
        needs.push(target);
        continue; // what it names is in scope once the files are joined
      }
      if (EXPORT_ANY.test(line)) {
        if (EXPORT_DECL.test(line)) { out.push(line.replace(EXPORT_DECL, '$1')); continue; }
        if (/^[ \t]*export\s*\{[^}]*\}[ \t]*;?[ \t]*$/.test(line) && !/\bas\b/.test(line)) continue;
        return { reason: `${name} exports in a way that cannot be joined` };
      }
      out.push(line);
    }
    return { code: out.join('\n'), needs };
  }

  /**
   * The one script an entry file becomes, with everything it imports before
   * it.
   *
   * Returns null when the file is not a module and can go into the page as it
   * is. Returns { code, used } when it was joined, and { reason } when it was
   * not — the caller keeps the file as written and says what stopped it.
   */
  function bundleFor(entry, filesIn) {
    const files = filesIn && typeof filesIn.get === 'function' ? filesIn : new Map(Object.entries(filesIn || {}));
    const start = String(entry || '').toLowerCase();
    const first = files.get(start);
    if (!first) return { reason: `${entry} is not one of the files` };
    if (!isModule(first.content)) return null;

    const done = new Map();
    const open = new Set();
    const order = [];
    let stopped = null;

    const walk = (name) => {
      if (stopped || done.has(name)) return;
      if (open.has(name)) { stopped = { reason: `${name} and the files it imports import each other` }; return; }
      if (order.length >= MAX_FILES) { stopped = { reason: 'too many files to join' }; return; }
      const file = files.get(name);
      if (!file) { stopped = { reason: `${name} is not one of the files` }; return; }
      const done1 = rewrite(name, file.content, files);
      if (done1.reason) { stopped = done1; return; }
      open.add(name);
      for (const need of done1.needs) walk(need);
      open.delete(name);
      if (stopped) return;
      done.set(name, done1.code);
      order.push(name);
    };
    walk(start);
    if (stopped) return stopped;

    const code = order.map((n) => `/* ${n} */\n${done.get(n)}`).join('\n');
    return { code, used: order };
  }

  window.HCSwarmBundle = { bundleFor, isModule, resolve };
})();
