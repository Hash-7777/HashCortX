// ==============================================================
// A change a model wrote as a diff in its reply
//
// Asked to fix a failing test, a mid-sized model on this computer wrote the
// fix as a diff in its reply, with the file's name and the lines to take out
// and put in, and changed nothing; sent back to make the change, it wrote
// the diff again. Light mode already reads whole files out of a small
// model's answer (js/code/light.js); a diff is read here.
//
// Each file in a diff block becomes one patch_file call: every hunk's
// unchanged and removed lines are what to find, its unchanged and added
// lines what to put in their place, the hunks of one file made together or
// not at all. A file the diff creates from nothing becomes a write_file
// call. The calls go through the tools like any others: patch_file finds
// the passage as it finds any, loosely when the spacing differs, and fails,
// saying where the nearest passage is, when the diff does not match the
// file. A hunk with nothing unchanged or removed to find it by, or one that
// changes nothing, is left out.
//
// The loop asks for this only when the request asks for a change, the run
// has changed nothing, and the reply shows code (js/code/verify.js
// unmadeChange), and not for the largest models, which call the tools.
//
// Pure. Checked by scripts/checks/code-diffs.mjs. Loaded before the Coder
// mode and published as window.HCCodeDiffs.
// ==============================================================

(function () {
  'use strict';

  const DIFF_LANG = /^(?:diff|patch|udiff)$/i;
  const LOOKS_LIKE_DIFF = /^(?:diff --git |--- |\+\+\+ |@@ )/m;

  /** A path in a diff header, without its a/ or b/ side, or '' for none. */
  function pathOf(header) {
    const p = String(header || '').trim().split('\t')[0].replace(/^"|"$/g, '');
    if (!p || p === '/dev/null') return '';
    return p.replace(/^[ab]\//, '');
  }

  /**
   * The files a diff changes: `[{ path, created, hunks: [{ search, replace }] }]`.
   * A diff with no file named in it gives nothing.
   */
  function parse(text) {
    const files = [];
    let file = null, hunk = null, from = '';
    const close = () => { if (hunk && file) file.hunks.push(hunk); hunk = null; };
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const git = /^diff --git a\/(\S+) b\/(\S+)/.exec(raw);
      if (git) { close(); file = null; from = git[1]; continue; }
      // A file's header, "--- " then "+++ ", ends the hunk before it; a removed line that starts "-- " does not.
      if (raw.startsWith('--- ') && (!hunk || String(lines[i + 1] || '').startsWith('+++ '))) { close(); from = raw.slice(4); continue; }
      if (raw.startsWith('+++ ') && !hunk) {
        close();
        const path = pathOf(raw.slice(4)) || pathOf(from);
        file = path ? { path, created: pathOf(from) === '' && from.trim().startsWith('/dev/null'), hunks: [] } : null;
        if (file) files.push(file);
        continue;
      }
      if (raw.startsWith('@@')) { close(); if (file) hunk = { old: [], new: [] }; continue; }
      if (!hunk) continue;
      if (raw.startsWith('\\')) continue;   // "\ No newline at end of file"
      const mark = raw[0], body = raw.slice(1);
      if (mark === '-') hunk.old.push(body);
      else if (mark === '+') hunk.new.push(body);
      else if (mark === ' ') { hunk.old.push(body); hunk.new.push(body); }
      else if (raw === '') { hunk.old.push(''); hunk.new.push(''); }   // a blank line whose leading space was dropped
      else { close(); }
    }
    close();
    return files.map((f) => ({
      path: f.path,
      created: f.created,
      hunks: f.hunks.map((h) => ({ search: trimBlank(h.old).join('\n'), replace: trimBlank(h.new).join('\n'), lines: h.new }))
        .filter((h) => f.created || (h.search.trim() && h.search !== h.replace)),
    })).filter((f) => f.hunks.length);
  }

  /** Lines without the blank ones at either end, which a model adds or drops freely. */
  function trimBlank(lines) {
    let a = 0, b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b);
  }

  /** The diff blocks of a reply, and its words without them. */
  function blocksOf(reply) {
    const F = window.HCFences;
    const parts = F && F.splitFences ? F.splitFences(String(reply || '')) : [];
    const diffs = [], words = [];
    for (const p of parts) {
      if (p.type === 'code' && (DIFF_LANG.test(String(p.lang || '')) || LOOKS_LIKE_DIFF.test(String(p.code || '')))) diffs.push(String(p.code || ''));
      else words.push(p.type === 'code' ? `\`\`\`${p.lang || ''}\n${p.code}\n\`\`\`` : p.text);
    }
    return { diffs, said: words.join('').replace(/\n{3,}/g, '\n\n').trim() };
  }

  /** The calls the diffs in a reply make, `[{ name, arguments }]`. */
  function callsOf(reply) {
    const calls = [];
    for (const block of blocksOf(reply).diffs) {
      for (const f of parse(block)) {
        if (f.created) {
          calls.push({ name: 'write_file', arguments: { path: f.path, content: f.hunks.flatMap((h) => h.lines).join('\n') + '\n' } });
          continue;
        }
        const [first, ...rest] = f.hunks;
        calls.push({ name: 'patch_file', arguments: { path: f.path, search: first.search, replace: first.replace, ...(rest.length ? { edits: rest.map((h) => ({ search: h.search, replace: h.replace })) } : {}) } });
      }
    }
    return calls;
  }

  /** The turn the reply's diffs make, `{ calls, said }`, each call with an id of its own, or null when it has none. */
  function turnOf(reply) {
    const calls = callsOf(reply);
    if (!calls.length) return null;
    const stamp = Date.now();
    return { calls: calls.map((c, i) => ({ id: `diff_${stamp}_${i}`, ...c })), said: blocksOf(reply).said };
  }

  window.HCCodeDiffs = { parse, blocksOf, callsOf, turnOf };
})();
