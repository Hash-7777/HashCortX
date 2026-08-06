// ==============================================================
// The cross-module bridge — checks
//
// A mode file loads after app.js and shares nothing with it. window._H is the
// whole seam between them. Both ways of getting it wrong are silent, and this
// repo has shipped both.
//
// A NAME CALLED BUT NOT EXPOSED. This is the expensive one, and it was live
// until the commit that added this file.
//
// platform/tauri/hashcoder.js gives the Coder agent two memory tools —
// remember_fact and recall_facts — and the system prompt tells the model it
// has them. Both call through this bridge. Neither name was ever on it. Both
// call sites are written defensively:
//
//     fn: (p) => { if (window._H?.memAdd) return window._H.memAdd(...);
//                  return { ok: false, error: 'Memory not available' }; }
//
// so the model asked to save a fact, was told memory was not available, and
// carried on. Every time, in every build. modes/code/mode.js's automatic fact
// extraction was optional-chained and did nothing at all. Three names missing;
// a feature that had never once worked and never once raised an error.
//
// A NAME EXPOSED THAT NOBODY CALLS. Cheaper, but it is how a seam stops being
// a seam. The bridge held 38 members and 23 of them were reachable from every
// mode for no reason — four provider-specific turn functions, the swarm
// runner, the error banner. Anything reachable eventually gets reached, and
// then the boundary is wherever someone happened to stop.
//
// So the rule is equality, both directions, with exceptions written down.
//
// Run with: npm run check:bridge
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/**
 * Members allowed on the bridge with nothing calling them, and why.
 *
 * Keep this list at nearly nothing. An entry is a promise that the member is
 * an interface rather than a leftover.
 */
const ALLOWED_UNCALLED = new Map([
  ['registerMode', 'the documented way for a mode to register itself. Every mode currently writes window._registeredModes directly, so nothing calls it — but it is the extension point the whole mode system is built on, and deleting it would leave the architecture with no stated entry point'],
]);

/** Every file that could call the bridge — everything but app.js, which defines it. */
function consumers() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html)$/.test(entry.name)) {
        const rel = relative(srcDir, full).split('\\').join('/');
        if (rel !== 'js/app.js') out.push(rel);
      }
    }
  };
  walk(srcDir);
  return out.sort();
}

// ── Read what the bridge exposes ─────────────────────────────────────────
const app = readFileSync(join(srcDir, 'js', 'app.js'), 'utf8');
const start = app.indexOf('  window._H = {');
let body = '';
if (start !== -1) {
  let depth = 0;
  for (let k = start + '  window._H = '.length; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') {
      depth--;
      if (depth === 0) { body = app.slice(start, k); break; }
    }
  }
}
const exposed = new Set();
for (const m of body.matchAll(/^ {4}(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(,]|^ {4}([A-Za-z_$][\w$]*),\s*$/gm)) {
  exposed.add(m[1] || m[2]);
}

// ── Read what actually calls it ──────────────────────────────────────────
const called = new Map(); // member → files
for (const file of consumers()) {
  const src = readFileSync(join(srcDir, file), 'utf8');
  for (const m of src.matchAll(/_H\??\.([A-Za-z_$][\w$]*)/g)) {
    if (!called.has(m[1])) called.set(m[1], new Set());
    called.get(m[1]).add(file);
  }
}

console.log('\nThe bridge exists and is readable:');
check('window._H is defined in app.js', start !== -1);
check(`it exposes members (${exposed.size})`, exposed.size > 0);
check(`something calls it (${called.size} members used)`, called.size > 0);

// ── 1. Everything called is exposed ──────────────────────────────────────
console.log('\nEvery name a mode calls is on the bridge:');
{
  const missing = [...called.keys()].filter((n) => !exposed.has(n)).sort();
  if (missing.length === 0) {
    check('nothing is called that the bridge does not provide', true);
  } else {
    for (const name of missing) {
      check(`_H.${name}`, false,
        `called from ${[...called.get(name)].join(', ')} but never exposed — the call sites are guarded, so this fails as a polite refusal rather than an error`);
    }
  }
}

// ── 2. Everything exposed is called ──────────────────────────────────────
console.log('\nEvery name on the bridge is one something calls:');
{
  const unused = [...exposed].filter((n) => !called.has(n)).sort();
  const undeclared = unused.filter((n) => !ALLOWED_UNCALLED.has(n));
  if (undeclared.length === 0) {
    check(`no unexplained member (${unused.length} listed as deliberate)`, true);
  } else {
    for (const name of undeclared) {
      check(`_H.${name}`, false,
        'on the bridge but nothing calls it — remove it, or add it to ALLOWED_UNCALLED with the reason it is an interface rather than a leftover');
    }
  }
  // The exception list must not rot either.
  for (const [name] of ALLOWED_UNCALLED) {
    check(`${name} is still on the bridge`, exposed.has(name),
      'listed as a deliberate uncalled member but no longer exposed — remove the entry');
    check(`${name} is still uncalled`, !called.has(name),
      `now called from ${called.has(name) ? [...called.get(name)].join(', ') : ''} — remove the entry, it is a normal member`);
  }
}

console.log(`\n${pass} passed, ${fail} failed  (cross-module bridge)`);
process.exit(fail ? 1 : 0);
