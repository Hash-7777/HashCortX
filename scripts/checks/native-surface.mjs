// ==============================================================
// Native surface checks
//
// ARCHITECTURE.md rule 1 says `src/platform/` is the only place allowed to
// touch `window.__TAURI__`. That was prose. This makes it a property.
//
// Every way the renderer can reach the machine goes through a Tauri command.
// This scans the source and asserts exactly which files may make one, so that
// adding an ungated native call to a mode file fails CI rather than shipping.
//
// It also pins the fact that Virtual OS and 3D Forge reach the machine not at
// all — which the docs got wrong for a long time in the alarming direction,
// describing an unguarded native surface those modes do not have.
//
// Run with: npm run check:native
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = join(root, 'src');

/** Files permitted to invoke a Tauri command, and why. */
const ALLOWED = new Map([
  ['platform/index.js', 'defines HC.invoke itself, plus the usage log and notch bridges'],
  ['platform/tauri/guard.js', 'the Permission Guard; writes the audit log'],
  ['platform/tauri/undo.js', 'saves and restores what a file held before a change — no model can call it, every path starts with the user clicking Undo, and a restore still goes through fs_write_file and the denylist'],
  ['platform/tauri/hashcoder.js', 'the agent tools — every one gated by HC.guard.request first'],
  ['platform/tauri/keychain.js', 'one-time migration out of the old Keychain'],
  ['main.js', 'window geometry and lifecycle at boot'],
  ['js/app.js', 'local embeddings, and opening a hardcoded ecosystem link in the browser'],
  ['js/code-mode.js', 'the Coder terminal and file pickers'],
]);

/**
 * Files that must reach the machine NOT AT ALL.
 *
 * Virtual OS looks like a filesystem and is not one: its fs_read / fs_write /
 * terminal_run tools operate on an IndexedDB project and a terminal simulated
 * in JavaScript. 3D Forge exports by handing the webview a Blob to download.
 * Neither can touch a real file, which is why neither needs the guard — and
 * why an HC.invoke appearing in either is a change worth stopping to look at.
 */
const MUST_BE_SANDBOXED = [
  'js/virtual-os.js',
  'js/forge-mode.js',
  'js/finance-mode.js',
  'js/swarm-maker.js',
  'js/system-maker.js',
  'js/sandbox.js',
  'js/rag-search.js',
  'js/agent-context.js',
  'js/agent-policy.js',
  'js/export-format.js',
  'js/power.js',
];

// `typeof window.__TAURI__ !== "undefined"` asks whether the app is running in
// Tauri. It reads nothing and calls nothing, so it is not a native call.
const FEATURE_DETECT = /typeof\s+window\.__TAURI(?:_INTERNALS)?__\s*(?:!==|===)/g;
const NATIVE_CALL = /(?:HC|window\.HC)\??\.\s*invoke\s*\(|__TAURI__\s*\.\s*\w|__TAURI_INTERNALS__\s*\.\s*invoke/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function nativeCallCount(source) {
  const withoutDetects = source.replace(FEATURE_DETECT, '');
  return (withoutDetects.match(NATIVE_CALL) || []).length;
}

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const files = walk(srcDir).sort();
const callers = new Map();
for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const n = nativeCallCount(readFileSync(file, 'utf8'));
  if (n > 0) callers.set(rel, n);
}

console.log('\nOnly known files may reach the machine:');
for (const [rel, n] of callers) {
  check(`${rel} (${n}) is an approved caller`, ALLOWED.has(rel),
    'if this is deliberate, add it to ALLOWED with the reason it is safe');
}

console.log('\nThese modes reach the machine not at all:');
for (const rel of MUST_BE_SANDBOXED) {
  const n = callers.get(rel) || 0;
  check(`${rel}`, n === 0, `${n} native call(s) — it must go through the Permission Guard`);
}

console.log('\nThe agent tools are gated:');
{
  // Every HC.code.* tool must ask the guard before invoking anything. This is
  // the single most important line in the app: it is what stands between a
  // language model and the disk.
  const hashcoder = readFileSync(join(srcDir, 'platform', 'tauri', 'hashcoder.js'), 'utf8');
  const invokes = (hashcoder.match(/HC\.invoke\(/g) || []).length;
  const requests = (hashcoder.match(/HC\.guard\.request\(/g) || []).length;
  check(`every native call has a guard request (${requests} guards / ${invokes} invokes)`,
    requests >= invokes, 'a tool is reaching Rust without asking first');
}

console.log('\nThe guard itself is reachable:');
{
  const guard = readFileSync(join(srcDir, 'platform', 'tauri', 'guard.js'), 'utf8');
  check('the guard denies by default when its dialog is missing',
    /resolve\('deny'\)/.test(guard),
    'a missing dialog element must refuse, never silently allow');
}

console.log(`\n${pass} passed, ${fail} failed  (native surface)`);
process.exit(fail ? 1 : 0);
