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
  ['js/app.js', 'checking whether a host resolves off-device before a request is allowed to leave, and opening a hardcoded ecosystem link in the browser'],
  ['core/rag/knowledge-base.js', 'embeds text with the model bundled in the binary. The command takes text and a kind and returns numbers — it reads no file, runs no process, and reaches no network; the CDN import it replaced is why semantic search never ran in any shipped build'],
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
  // Per method, not per file. Counting the whole file compares two totals,
  // which passes a file holding five guarded calls and five unguarded ones —
  // and fails a method that legitimately reaches Rust twice behind one
  // question, which is what reading a PDF does: ask once, then either read the
  // bytes or read the text. What matters is that no method touches Rust
  // without having asked, and that is what this reads.
  const hashcoder = readFileSync(join(srcDir, 'platform', 'tauri', 'hashcoder.js'), 'utf8');
  const methods = [...hashcoder.matchAll(
    /\n    (?:async )?([A-Za-z]\w*)\((?:[^)]*)\)\s*\{([\s\S]*?)\n    \},/g,
  )];
  check(`the tool methods are readable (${methods.length} found)`, methods.length > 5);
  let unguarded = 0;
  for (const [, name, body] of methods) {
    if (!/HC\.invoke\(/.test(body)) continue;
    const asks = /HC\.guard\.request\(/.test(body);
    if (!asks) {
      unguarded++;
      check(`${name}() reaches Rust without asking first`, false,
        'every tool must call HC.guard.request before HC.invoke');
    }
  }
  if (unguarded === 0) {
    check('every tool method asks the guard before it reaches Rust', true);
  }
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

// ── Every argument name a call passes is one the command takes ───────────
//
// Tauri renames a command's arguments across the bridge: a Rust parameter
// written `on_chunk` is `onChunk` in JavaScript. Passing the Rust spelling
// does not fail loudly, and what happens next depends only on whether the
// parameter is optional:
//
//   required → the call is rejected outright. Coder's shell streamed through
//              `shell_run_stream` with `on_chunk`, so every command the agent
//              ran came back "missing required key onChunk" — the terminal
//              worked and the agent's shell did not.
//   optional → Tauri sees nothing, uses None, and the call SUCCEEDS with the
//              argument dropped. `fs_grep` took `file_ext` that way, so the
//              extension filter was silently ignored and grep searched
//              everything, for as long as it has existed.
//
// The second is the one worth a check: it produces no error anywhere, and the
// feature simply is not applied.
console.log('\nEvery argument a call passes is one the command takes:');
{
  const cmdDir = join(root, 'src-tauri', 'src', 'commands');
  const rustSrc = readdirSync(cmdDir)
    .filter((f) => f.endsWith('.rs'))
    .map((f) => readFileSync(join(cmdDir, f), 'utf8'))
    .join('\n');
  // Rust: `pub fn name(a: T, b_c: U, …)` up to the closing paren.
  const params = new Map();
  for (const m of rustSrc.matchAll(/pub fn ([a-z0-9_]+)\s*\(([^)]*)\)/g)) {
    params.set(m[1], new Set(
      [...m[2].matchAll(/(?:^|,)\s*([a-z0-9_]+)\s*:/g)].map((p) => p[1]),
    ));
  }
  check(`the Rust commands declare their parameters (${params.size} functions)`, params.size > 0);

  const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  let checked = 0, bad = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const call of src.matchAll(/invoke\(\s*['"]([a-z0-9_]+)['"]\s*,\s*\{([^}]*)\}/g)) {
      const [, name, argBlock] = call;
      const takes = params.get(name);
      if (!takes) continue;                       // plugin call, or not ours
      const passed = [...argBlock.matchAll(/(?:^|,)\s*([A-Za-z0-9_]+)\s*(?::|,|$)/g)]
        .map((a) => a[1]);
      for (const arg of passed) {
        checked++;
        // Accept the JavaScript spelling. The Rust spelling is the bug.
        if (takes.has(arg) && camel(arg) !== arg) {
          bad++;
          check(`${name}({ ${arg} }) uses the Rust spelling`, false,
            `Tauri exposes this parameter as "${camel(arg)}" — passing "${arg}" means it never arrives`);
        } else if (!takes.has(arg) && !takes.has(arg.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()))) {
          bad++;
          check(`${name}({ ${arg} }) is not a parameter of ${name}`, false,
            `${name} takes: ${[...takes].map(camel).join(', ') || '(nothing)'}`);
        }
      }
    }
  }
  if (bad === 0) check(`every argument name reaches its command (${checked} checked)`, true);
}

console.log(`\n${pass} passed, ${fail} failed  (native surface)`);
process.exit(fail ? 1 : 0);
