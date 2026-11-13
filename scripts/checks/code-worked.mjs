// ==============================================================
// The commands that worked in a project — checks
//
// Loads the real src/js/code/worked.js and holds what HashCoder writes down
// by itself, from its own record of a run, about how a project is tested
// and built on this computer: only checks that passed, never a command that
// names a place on the disk or a home folder, a few per project and system,
// newest first, and told to the model at the start of a conversation as the
// app's own record.
//
// Run with: npm run check:code-worked
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
const json = (x) => JSON.stringify(x);

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'worked.js'), sandbox, { filename: 'worked.js' });
const W = sandbox.HCCodeWorked || {};
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const ROOT = '/work/harbour-shop';

console.log('What is written down:');
{
  const s = store();
  W.record(s, ROOT, [{ kind: 'test', command: 'npm test', pass: true }, { kind: 'build', command: 'npm run build', pass: true }, { kind: 'test', command: 'npm run e2e', pass: false }], { os: 'macos' });
  ok('the checks that passed, by kind, and none that failed', json(W.forProject(s, ROOT, { os: 'macos' })) === json([{ kind: 'build', command: 'npm run build' }, { kind: 'test', command: 'npm test' }]), json(W.forProject(s, ROOT, { os: 'macos' })));
  W.record(s, ROOT, [{ kind: 'test', command: 'npm test', pass: true }], { os: 'macos' });
  ok('a command that passes again moves to the front, kept once', json(W.forProject(s, ROOT, { os: 'macos' }).map((c) => c.command)) === '["npm test","npm run build"]');
  W.record(s, ROOT, [{ kind: 'test', command: 'pytest /home/sam/shop/tests', pass: true }, { kind: 'test', command: 'pytest ~/shop/tests', pass: true }, { kind: 'test', command: 'C:\\shop\\run.bat', pass: true }, { kind: 'lint', command: `npm run lint ${'x'.repeat(200)}`, pass: true }], { os: 'macos' });
  ok('never one that names a place on the disk, a home folder, or one too long to be a plain command', json(W.forProject(s, ROOT, { os: 'macos' }).map((c) => c.command)) === '["npm test","npm run build"]');
  ok('another system keeps its own: what runs here may not run there', W.forProject(s, ROOT, { os: 'windows' }).length === 0);
  for (let i = 0; i < 9; i++) W.record(s, ROOT, [{ kind: 'test', command: `npm run t${i}`, pass: true }], { os: 'macos' });
  ok(`at most ${W.MOST} a project, the newest kept`, W.forProject(s, ROOT, { os: 'macos' }).length === W.MOST && W.forProject(s, ROOT, { os: 'macos' })[0].command === 'npm run t8');
  ok('nothing kept for no project, and a store that throws breaks nothing', (() => { W.record(s, '', [{ kind: 'test', command: 'npm test', pass: true }]); const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }; W.record(bad, ROOT, [{ kind: 'test', command: 'npm test', pass: true }]); return W.forProject(bad, ROOT).length === 0; })());
  ok('only the record\'s own kinds are kept: a command that is not a test, a build or a lint is not', (() => { const t = store(); W.record(t, ROOT, [{ kind: 'run', command: 'node server.js', pass: true }, { kind: 'test', command: 'npm test', pass: true }], {}); return json(W.forProject(t, ROOT, {}).map((c) => c.command)) === '["npm test"]'; })());
}

console.log('\nWhat the model is told:');
{
  const s = store();
  W.record(s, ROOT, [{ kind: 'test', command: 'npm test', pass: true }, { kind: 'build', command: 'npm run build', pass: true }], { os: 'linux' });
  const line = W.line(s, ROOT, { os: 'linux' });
  ok('one line, said to be the app\'s own record, each command in backticks with its kind', line === "Commands that passed in this project on this computer before, recorded by HashCortX from its own runs: `npm run build` (build), `npm test` (test).", line);
  ok('nothing recorded, nothing said', W.line(store(), ROOT, { os: 'linux' }) === '');
  const loop = src('js', 'agent-loop.js'), mode = src('modes', 'code', 'mode.js');
  ok('the loop writes it down as a run ends, from its record of what passed', /window\.HCCodeWorked\?\.record\(window\.localStorage, sharedState\.projectRoot, proof \? proof\.checks : \[\], \{ os: sharedState\.platform\?\.os \}\)/.test(loop));
  ok('the start of a conversation says it, beside the project\'s lessons', /window\.HCCodeWorked\?\.line\(localStorage, sharedState\.projectRoot, \{ os: sharedState\.platform\?\.os \}\)/.test(mode));
  ok('it is loaded before the Coder, and part of npm run check', src('boot.js').indexOf("'/js/code/worked.js'") > 0 && /npm run check:code-worked\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/worked.js)`);
process.exit(fail ? 1 : 0);
