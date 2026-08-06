// ==============================================================
// Element-lookup checks
//
// Every `$("someId")` and `getElementById("someId")` in the source is matched
// against the ids that actually exist — the static markup in index.html, plus
// any id the source creates at runtime.
//
// WHY THIS CHECK EXISTS
// ---------------------
// `document.getElementById` returns null for an id that is not there. It does
// not throw, and the code around it is usually written defensively, so the
// feature behind it simply stops happening. Nothing fails, nothing logs, and
// the code still reads as though it works.
//
// That is not hypothetical here. A feature was taken out of the settings UI
// while the code that read its checkbox stayed. The lookup returned null, the
// function guarding on it returned early every time, and everything downstream
// became unreachable — including the knowledge base, whose only call on the
// send path sat inside that dead branch. The app reported that retrieval was
// on and then retrieved nothing, for a long time, with no error anywhere.
//
// So a lookup that can never resolve has to be a deliberate, written-down
// decision rather than something discovered years later. Each one below is
// listed with the reason it is allowed to stay.
//
// Run with: npm run check:dom
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = join(root, 'src');

/**
 * Lookups that resolve to nothing, and are allowed to.
 *
 * Add an entry only with a reason that says why the missing element is
 * correct. If the answer is "the feature was removed", the code that reads it
 * should usually be removed too — that is the whole point of this check.
 */
const KNOWN_ABSENT = {
  // ── Settings controls removed from the UI, code kept and null-safe ──
  nvidiaModel:
    'The NVIDIA model picker was removed; the provider list supplies the model instead.',
  settingsNotes:
    'The settings notes pane was removed; the toggle below is bound optionally.',
  settingsNotesToggle:
    'Toggle for the notes pane above. Bound with ?. so its absence is inert.',

  // ── Panels owned by another mode, absent until that mode builds them ──
  'swarm-log-entries': 'Built by Agent Swarm when it runs; absent until then.',
  'cv-swarm-terminate': 'See swarm-log-entries.',
  'cv-swarm-result-box': 'See swarm-log-entries.',
  'cv-swarm-result-body': 'See swarm-log-entries.',
  'cv-swarm-result-title': 'See swarm-log-entries.',
  amkPolishBtn: 'Agent Maker polish control, rendered only in some editor states.',
  voidEditModeBtn: 'Virtual OS control not present in the current shell markup.',
  voidPrompt: 'See voidEditModeBtn.',
  voidTermClearBtn: 'See voidEditModeBtn.',
};

const html = readFileSync(join(srcDir, 'index.html'), 'utf8');

/**
 * Every script the app ships, wherever it lives.
 *
 * This used to read src/js/ and nothing else — a flat listing of one folder.
 * That was already blind to src/platform/, and it went blind to the modes the
 * moment each one moved into src/modes/<id>/: four ids it had been tracking
 * looked, overnight, like ids nothing looks up any more. Nothing was wrong
 * with the app. The check had simply stopped reading most of it.
 *
 * A guard that reads one directory is a guard the code can walk out of.
 */
function walkScripts(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkScripts(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const jsFiles = walkScripts(srcDir).sort();

const staticIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// Ids the source builds at runtime, in any quoting style the codebase uses.
const allSource = jsFiles.map((f) => readFileSync(f, 'utf8')).join('\n') + html;
const dynamicIds = new Set();
for (const m of allSource.matchAll(/id=\\?["'`]([A-Za-z0-9_-]+)/g)) dynamicIds.add(m[1]);
for (const m of allSource.matchAll(/\.id\s*=\s*["'`]([A-Za-z0-9_-]+)/g)) dynamicIds.add(m[1]);

// An id built from a template literal — `id="frgModel_${agent.id}"` — is
// captured above only as far as the `${`, giving a prefix like `frgModel_`.
// A lookup for one of the ids that pattern produces is therefore resolved by
// its prefix. Without this, `$("frgModel_god")` looks like a lookup of
// something that never exists, when the element is built for every agent.
const dynamicPrefixes = [...dynamicIds].filter((id) => id.endsWith('_'));
const exists = (id) =>
  staticIds.has(id) ||
  dynamicIds.has(id) ||
  dynamicPrefixes.some((prefix) => id.length > prefix.length && id.startsWith(prefix));

let pass = 0;
let fail = 0;
const ok = (msg) => { pass++; console.log(`  ok    ${msg}`); };
const bad = (msg) => { fail++; console.log(`  FAIL  ${msg}`); };

// ── Every lookup resolves, or is written down ────────────────────────────────
console.log('\nEvery element lookup resolves, or is a listed exception:');

const unresolved = new Map();
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  const name = file.slice(srcDir.length + 1);
  const found = new Set();
  for (const m of src.matchAll(/\$\("([^"]+)"\)/g)) found.add(m[1]);
  for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) found.add(m[1]);
  for (const id of found) {
    if (exists(id)) continue;
    if (!unresolved.has(id)) unresolved.set(id, []);
    unresolved.get(id).push(name);
  }
}

const undeclared = [...unresolved].filter(([id]) => !(id in KNOWN_ABSENT));
if (undeclared.length === 0) {
  ok(`all ${[...unresolved.keys()].length} unresolved lookups are listed with a reason`);
} else {
  for (const [id, files] of undeclared) {
    bad(`"${id}" is looked up in ${files.join(', ')} but no element with that id is ever created.
          Either the element is missing, or the code that reads it is dead.
          If it is deliberate, add it to KNOWN_ABSENT in this file with the reason.`);
  }
}

// ── The exception list does not rot ──────────────────────────────────────────
console.log('\nThe exception list still describes reality:');

const stale = Object.keys(KNOWN_ABSENT).filter((id) => exists(id));
if (stale.length === 0) ok('no listed exception has quietly gained an element');
else for (const id of stale) {
  bad(`"${id}" is listed as absent but an element with that id now exists — remove it from KNOWN_ABSENT.`);
}

const unused = Object.keys(KNOWN_ABSENT).filter((id) => !unresolved.has(id));
if (unused.length === 0) ok('no listed exception is for a lookup that no longer happens');
else for (const id of unused) {
  bad(`"${id}" is listed as absent but nothing looks it up any more — remove it from KNOWN_ABSENT.`);
}

// ── The router that started this cannot come back unnoticed ──────────────────
console.log('\nThe knowledge base is reachable from the send path:');

const app = readFileSync(join(srcDir, 'js', 'app.js'), 'utf8');
const injectSites = [...app.matchAll(/queryRAGMerged\(/g)].length;
// One definition plus at least two call sites: the preview and the send path.
if (injectSites >= 3) ok(`queryRAGMerged is called from more than one path (${injectSites - 1} call sites)`);
else bad(`queryRAGMerged has ${Math.max(0, injectSites - 1)} call site(s) — retrieval has lost a path again`);

const sendGuard = /if \(injectionEnabled && !_isExternalModel\) \{/.test(app);
if (sendGuard) ok('retrieval on the send path is gated on the toggle and a local model, nothing else');
else bad('the send-path retrieval guard changed shape — check it has not been nested behind a dead condition again');

console.log(`\n${pass} passed, ${fail} failed  (element lookups)`);
process.exit(fail ? 1 : 0);
