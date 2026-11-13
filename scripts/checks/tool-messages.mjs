// ==============================================================
// What a tool says when it will not do what it was asked — checks
//
// A model that is told only that a call failed makes the same call again,
// or gives up. So every refusal and error a HashCoder tool sends back says,
// in this order, what was wrong and what to send instead; and when the call
// itself was the mistake (an argument missing or wrong), the call written
// right, with the model's own values where they are known.
//
// This drives each of those paths in the real code (platform/tauri/
// hashcoder.js, js/code/patch.js, calls.js, seen.js, plan.js, lessons.js),
// with stand-ins for the native side and the guard, and holds every answer
// to that rule:
//   · what was wrong: the answer opens with a statement of four words or more;
//   · what to send instead: a sentence that tells it what to do;
//   · for a call mistake: the call written out, `Call it as {...}` or
//     `command "...", args [...]`, holding the values the model gave.
//
// Run with: npm run check:tool-messages
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const R = '/work/saltmarsh-cafe';
const disk = new Map([[`${R}/menu.js`, 'const price = 3;\nconst price = 3;\n'], [`${R}/notes.txt`, 'a\nb\n']]);
const bytes = (p) => (disk.has(p) ? Buffer.from(disk.get(p)) : null);
let answer = true;
const box = { console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, RegExp, Buffer, TextEncoder, TextDecoder, atob, btoa };
box.window = box;
box.HC = {
  guard: {
    projectRoot: () => R,
    request: async () => answer,
    allowedWithoutAsking: async (action, target) => String(target).startsWith(R),
    isProtected: () => false,
    holds: () => ({ untrusted: false }),
  },
  undo: {
    capture: async (path) => ({ id: 'c', path, existed: disk.has(path), content: disk.get(path) ?? null, unrestorable: null }),
    seal: async () => {}, drop: async () => {}, lastFor: () => null,
  },
  invoke: async (cmd, a) => {
    if (cmd === 'fs_read_base64') { const b = bytes(a.path); if (!b) throw new Error(`Cannot access "${a.path}"`); return { base64: b.toString('base64'), bytes: b.length }; }
    if (cmd === 'fs_read_file') { if (!disk.has(a.path)) throw new Error(`Cannot access "${a.path}"`); return disk.get(a.path); }
    if (cmd === 'fs_write_file') { disk.set(a.path, a.content); return null; }
    if (cmd === 'fs_grep') return [];
    return null;
  },
};
vm.createContext(box);
for (const f of [['js', 'text-safety.js'], ['js', 'secret-shapes.js'], ['js', 'fences.js'], ['js', 'code', 'search.js'], ['js', 'code', 'paths.js'], ['js', 'code', 'patch.js'],
  ['js', 'code', 'codemap.js'], ['js', 'code', 'uses.js'], ['js', 'code', 'calls.js'], ['js', 'code', 'seen.js'], ['js', 'code', 'plan.js'], ['js', 'code', 'lessons.js'], ['js', 'code', 'git.js'], ['platform', 'tauri', 'hashcoder.js']]) {
  vm.runInContext(src(...f), box, { filename: f.at(-1) });
}
const code = box.HC.code;
const tool = (name) => code.TOOL_DEFINITIONS.find((t) => t.name === name);
const said = async (fn) => {
  try {
    const out = await fn();
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    try { const o = JSON.parse(text); return String(o.error || o.result && JSON.parse(o.result).error || text); } catch { return text; }
  } catch (e) { return String((e && e.message) || e); }
};

/** Sentences that tell the model what to do. */
const TELLS = /(?:^|[.:;!?,]\s+|\n|\bor\s+|\bthen\s+)(?:use|call|send|write|give|add|read|make|set|leave|try|run|close|ask|say|take|find|change|put|copy|re-read|pass|carry on|choose|do|work|tell|name|look|narrow)\b/i;
/** A call written out. */
const CALL = /Call it (?:again )?as \{|command "[^"]+", args \[/;
function judge(kind, text, own = []) {
  const first = String(text).split(/(?<=[.!?])\s+/)[0];
  const parts = [];
  if (first.trim().split(/\s+/).length < 4) parts.push('what was wrong');
  if (!TELLS.test(text)) parts.push('what to send instead');
  if (kind === 'call' && !CALL.test(text)) parts.push('the call written right');
  if (kind === 'call') for (const v of own) if (!String(text).includes(v)) parts.push(`the model's own ${JSON.stringify(v)}`);
  return parts;
}

const P = box.HCCodePatch;
const cases = [
  // A call that is itself the mistake.
  ['call', 'write_file with no content', () => code.writeFile(`${R}/new.js`, null), ['new.js']],
  ['call', 'patch_file with no search', () => tool('patch_file').fn({ path: `${R}/notes.txt`, replace: 'x' }), ['notes.txt']],
  ['call', 'patch_file with no replace', () => tool('patch_file').fn({ path: `${R}/notes.txt`, search: 'a' }), ['notes.txt']],
  ['call', 'patch_file whose search is found twice', () => tool('patch_file').fn({ path: `${R}/menu.js`, search: 'const price = 3;', replace: 'const price = 4;' }), ['menu.js']],
  ['call', 'an edit with no search', () => tool('patch_file').fn({ path: `${R}/notes.txt`, search: 'a', replace: 'A', edits: [{ replace: 'B' }] }), ['notes.txt']],
  ['call', 'an edit with no replace', () => tool('patch_file').fn({ path: `${R}/notes.txt`, search: 'a', replace: 'A', edits: [{ search: 'b' }] }), ['notes.txt']],
  ['call', 'move_file with a side missing', () => tool('move_file').fn({ from: `${R}/notes.txt` }), []],
  ['call', 'search_knowledge with no query', () => tool('search_knowledge').fn({}), []],
  ['call', 'fetch_url with no address', () => tool('fetch_url').fn({}), []],
  ['call', 'web_search with no query', () => tool('web_search').fn({}), []],
  ['call', 'update_plan with no steps', () => tool('update_plan').fn({}), []],
  ['call', 'save_lesson with no text', () => box.HCCodeLessons.save(new Map(), '/p', '').error, []],
  ['call', 'a call missing what it needs and giving what it does not take', () => box.HCCodeCalls.missing('read_file', { file: 'a.js' }, code.toolList().find((t) => t.function.name === 'read_file')), ['read_file']],
  // What the file or the run is like.
  ['state', 'patch_file on a file that is not text', () => P.textOf(new Uint8Array([0x25, 0x50, 0x00, 0x01]), 'logo.png'), []],
  ['state', 'patch_file on a file in another encoding', () => P.textOf(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'old.txt'), []],
  ['state', 'patch_file whose search is not there', () => P.applyPatch('one\ntwo\n', 'three', 'four', 'notes.txt'), []],
  ['state', 'patch_file on a file that is not there', () => tool('patch_file').fn({ path: `${R}/gone.txt`, search: 'a', replace: 'b' }), []],
  ['state', 'a write of what the file already holds', () => code.writeFile(`${R}/notes.txt`, 'a\nb\n'), []],
  ['state', 'move_file onto itself', () => tool('move_file').fn({ from: `${R}/notes.txt`, to: `${R}/notes.txt` }), []],
  ['state', 'a change to a file not read', async () => { const r = await box.HCCodeSeen.before({ name: 'patch_file', arguments: { path: `${R}/notes.txt`, search: 'a', replace: 'b' } }, [], { root: R, current: async () => 'a\nb\n' }); return JSON.parse(r.result).error; }, []],
  ['state', 'a change to names other files use', () => box.HCCodeSeen.usersNote('menu.js', [{ was: 'price', now: 'cost' }], [{ path: 'order.js', lines: [4] }]), []],
  ['state', 'the same failing call again', () => { const m = box.HCCodeCalls.memory(); m.after({ id: '1', name: 'read_file', arguments: { path: 'x' } }, JSON.stringify({ error: 'Cannot access "x"' }), false); const r = m.before({ id: '2', name: 'read_file', arguments: { path: 'x' } }); return r && JSON.parse(r.result).error; }, []],
  ['state', 'a lesson too long', () => box.HCCodeLessons.save(new Map(), '/p', 'x '.repeat(400)).error, []],
  ['state', 'a reading tool outside the project in a finding run', () => code.readingQuietly('read_file', { path: '/elsewhere/a.txt' }), []],
  ['call', 'read_file given paths where it reads one file a call', () => tool('read_file').fn({ paths: [`${R}/menu.js`, `${R}/notes.txt`] }), ['menu.js']],
  ['call', 'read_file given more than six paths', () => tool('read_file').fn({ paths: ['a1.js', 'a2.js', 'a3.js', 'a4.js', 'a5.js', 'a6.js', 'a7.js'] }), ['a1.js']],
  ['call', 'read_file given a result id where no run is reading', () => tool('read_file').fn({ result: 'call_4', start_line: 3, end_line: 9 }), ['call_4']],
  ['state', 'git init in a conversation that asked for no git work', () => { code.gitAsked = false; try { return code.shellRun('git', ['init']); } finally { code.gitAsked = undefined; } }, []],
  ['state', 'a workflow file in a conversation that asked for none', () => { code.ciAsked = false; try { return code.writeFile(`${R}/.github/workflows/ci.yml`, 'on: push'); } finally { code.ciAsked = undefined; } }, []],
  ['state', 'a finding run asking for a tool that writes', () => code.readingQuietly('write_file', { path: 'a.txt' }), []],
  // Switched off, or not there.
  ['off', 'remembering a fact with memory switched off', () => { code.memoryOn = false; return tool('remember_fact').fn({ key: 'k', value: 'v' }); }, []],
  ['off', 'remembering a fact where memory is not loaded', () => { code.memoryOn = true; return tool('remember_fact').fn({ key: 'k', value: 'v' }); }, []],
  ['off', 'a lesson with lessons switched off', () => tool('save_lesson').fn({ text: 'tests run with npm test' }), []],
  ['off', 'the knowledge base not loaded', () => tool('search_knowledge').fn({ query: 'opening hours' }), []],
  ['off', 'a tool the chat runs, where the chat is not loaded', () => tool('execute_python').fn({ code: 'print(1)' }), []],
  ['off', 'find_photos where its module is not loaded', async () => { const keep = box.HCSwarmPhotos; delete box.HCSwarmPhotos; try { return await tool('find_photos').fn({ subject: 'harbour cafe' }); } finally { if (keep) box.HCSwarmPhotos = keep; } }, []],
  // The person said no.
  ['no', 'a write the person refused', () => { answer = false; return code.writeFile(`${R}/new2.js`, 'x'); }, []],
  ['no', 'a delete the person refused', () => code.deleteFile(`${R}/notes.txt`), []],
];

console.log('\nEvery refusal and error says what was wrong and what to send instead, and a call mistake the call written right:');
for (const [kind, label, run, own] of cases) {
  const text = await said(run);
  const missing = judge(kind, text, own);
  ok(`${label} (${kind})`, missing.length === 0, missing.length ? `lacks ${missing.join(', ')}: ${JSON.stringify(String(text).slice(0, 220))}` : '');
}
answer = true;

console.log(`\n${pass} passed, ${fail} failed  (what HashCoder's tools say when they do not do what was asked)`);
process.exit(fail ? 1 : 0);
