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
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = join(root, 'src');

/** Files permitted to invoke a Tauri command, and why. */
const ALLOWED = new Map([
  ['platform/index.js', 'defines HC.invoke itself, plus the usage log and notch bridges'],
  ['platform/tauri/guard.js', 'the Permission Guard; writes the audit log'],
  ['platform/tauri/undo.js', 'saves and restores what a file held before a change — no model can call it, every path starts with the user clicking Undo, and a restore still goes through fs_write_file and the denylist'],
  ['platform/tauri/save.js', 'writes an export to the disk — no model can call it, every path starts with the user clicking Export and naming a file in the native dialog, and the write still passes the denylist in export_write_file'],
  ['platform/tauri/hashcoder.js', 'the agent tools — every one gated by HC.guard.request first'],
  ['platform/tauri/keychain.js', 'one-time migration out of the old Keychain'],
  ['main.js', 'window geometry and lifecycle at boot'],
  ['js/app.js', 'local embeddings, checking whether a host resolves off-device before a request is allowed to leave, and opening a hardcoded ecosystem link in the browser'],
  ['modes/code/mode.js', 'the Coder terminal and file pickers'],
  ['core/settings/local-model.js', 'reads which operating system this is, so step one shows the right install instructions instead of handing a Windows user a curl command; and opens the one download page in the real browser. The command takes no argument, and the URL is a fixed string in index.html that no code writes — no model reaches either'],
]);

/**
 * Files that must reach the machine NOT AT ALL.
 *
 * Virtual OS looks like a filesystem and is not one: its fs_read / fs_write /
 * terminal_run tools operate on an IndexedDB project and a terminal simulated
 * in JavaScript. Neither it nor 3D Forge can touch a real file on its own,
 * which is why neither needs the guard — and why an HC.invoke appearing in
 * either is a change worth stopping to look at.
 *
 * These modes do save exports to the disk, through HC.save. That is deliberate
 * and it is not a hole in this rule: the write lives in platform/tauri/save.js
 * behind a native dialog the user answers, so the destination is theirs rather
 * than the mode's, and the bytes still pass the denylist in Rust.
 */
const MUST_BE_SANDBOXED = [
  'modes/virtual-os/mode.js',
  'modes/forge/mode.js',
  'modes/finance/mode.js',
  'modes/agent-maker/mode.js',
  'modes/systems/mode.js',
  'modes/sandbox/mode.js',
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

console.log('\nEvery command the renderer calls is registered, and every registered command is called:');
{
  // Two failures this catches, both of which look like working code.
  //
  // A name the renderer invokes that Rust never registered fails at runtime
  // inside a catch, so the feature behind it simply stops happening — this
  // repo's oldest defect, in its native form.
  //
  // A command registered with nothing calling it is the reverse: an entry
  // point into the machine that exists for no reason. Each one is reachable
  // from the renderer, so a dead one is attack surface with no feature paying
  // for it.
  const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const handler = /generate_handler!\s*\[([\s\S]*?)\]/.exec(lib)?.[1] || '';
  const registered = new Set(
    handler.split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
      .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name)),
  );
  check('lib.rs registers a command list', registered.size > 0);

  const invoked = new Map(); // name → the file that calls it
  for (const file of files) {
    const rel = relative(srcDir, file).split('\\').join('/');
    for (const m of readFileSync(file, 'utf8').matchAll(/invoke\(\s*['"]([^'"]+)['"]/g)) {
      // `plugin:` names belong to a Tauri plugin and are granted in
      // src-tauri/capabilities/default.json, not in generate_handler!.
      if (!m[1].startsWith('plugin:')) invoked.set(m[1], rel);
    }
  }

  for (const [name, where] of invoked) {
    check(`${name} is registered (called from ${where})`, registered.has(name),
      'the invoke would reject at runtime and the feature behind it would stop happening');
  }

  /**
   * Registered commands with no caller in the renderer, and why each one stays.
   *
   * Anything not listed here and not called is a live entry point into the
   * machine that nothing uses. Delete it rather than adding it below.
   */
  const REGISTERED_WITHOUT_A_CALLER = new Map([
    ['embed_available', 'reports whether the bundled embedding model loaded; reads nothing and takes no argument'],
  ]);
  for (const name of registered) {
    if (invoked.has(name)) continue;
    check(`${name} is registered without a caller for a stated reason`,
      REGISTERED_WITHOUT_A_CALLER.has(name),
      'nothing calls it — remove it from generate_handler! rather than leaving the renderer an entry point nobody uses');
  }
  // And the list must not outlive its entries.
  for (const name of REGISTERED_WITHOUT_A_CALLER.keys()) {
    check(`${name} is still uncalled, as recorded`, registered.has(name) && !invoked.has(name),
      'it is called now, or gone — remove the entry');
  }
}

console.log('\nThe guard is shown the whole action, not half of it:');
{
  // A shell command's working directory is chosen by the model and decides
  // what every relative path in that command means. The dialog used to show
  // only the command, so approving `rm output.o` said nothing about which
  // folder was about to lose a file. Loading the REAL hashcoder.js and
  // recording what the guard is handed is the only way to check that.
  const asked = [];
  const sandbox = {
    console,
    HC: {
      isTauri: true,
      guard: { request: (action, target, reason) => { asked.push({ action, target, reason }); return Promise.resolve(true); } },
      invoke: () => Promise.resolve({ stdout: '', stderr: '', code: 0 }),
      undo: { capture: () => Promise.resolve(null) },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(srcDir, 'platform', 'tauri', 'hashcoder.js'), 'utf8'),
    sandbox, { filename: 'hashcoder.js' });

  await sandbox.HC.code.shellRun('rm', ['output.o'], '/Users/x/other-project', 'cleaning up');
  const withCwd = asked.at(-1);
  check('a shell request names the folder the command will run in',
    withCwd?.target.includes('/Users/x/other-project'),
    `the user was asked to approve "${withCwd?.target}" with no mention of where`);
  check('and still names the command itself',
    withCwd?.target.startsWith('rm output.o'), withCwd?.target);

  await sandbox.HC.code.shellRun('npm', ['test'], null, '');
  check('a command with no folder of its own is unchanged',
    asked.at(-1)?.target === 'npm test', asked.at(-1)?.target);

  // Reading a web page is a network call whose address the model chose, made
  // by the mode that can read every file in the project. Chat does it without
  // asking; here that would be a way for anything just read to leave inside a
  // query string.
  sandbox.window._H = { runOneTool: () => Promise.resolve('{}') };
  const before = asked.length;
  await sandbox.HC.code.TOOL_DEFINITIONS
    .find((t) => t.name === 'fetch_url')
    .fn({ url: 'https://example.com/page' });
  const fetchAsk = asked.slice(before).find((a) => a.action === 'fetch');
  check('reading a web page asks first', !!fetchAsk,
    'a URL the model chose can carry what it just read off the machine');
  check('and the dialog names the address',
    fetchAsk?.target === 'https://example.com/page', fetchAsk?.target);
}

console.log('\nEvery tool Coder hands to chat is a tool chat has:');
{
  // `runOneTool` answers an unknown name with {"error": "Unknown tool: x"},
  // which the model reads as a failure and works around. So a delegated tool
  // whose name drifts does not break loudly — the feature just stops being
  // available, which is this repo's oldest defect wearing a new hat.
  const hashcoder = readFileSync(join(srcDir, 'platform', 'tauri', 'hashcoder.js'), 'utf8');
  const app = readFileSync(join(srcDir, 'js', 'app.js'), 'utf8');

  const delegated = [...hashcoder.matchAll(/viaChatTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  check('Coder delegates at least one tool to chat', delegated.length > 0);

  const table = /const AGENT_TOOLS = \{([\s\S]*?)\n  \};/.exec(app)?.[1] || '';
  const chatTools = new Set(
    [...table.matchAll(/^ {4}([a-z_]+): \{/gm)].map((m) => m[1]),
  );
  check('chat exposes a tool table to compare against', chatTools.size > 0);

  for (const name of delegated) {
    check(`${name} exists in chat's AGENT_TOOLS`, chatTools.has(name),
      'runOneTool would answer "Unknown tool" and the model would route around it');
  }
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
