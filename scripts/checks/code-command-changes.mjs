// ==============================================================
// What a command changed — checks
//
// Loads the real src/js/code/command-changes.js (with the permission rules
// it asks) and holds how HashCoder tells what a command changed in the
// project: a quick record of the project's files is taken before and after
// a command that is not a plain read (src-tauri/src/commands/fs.rs
// fs_snapshot), and every file changed, added or removed between them is
// said to the model in the command's result and shown to the person in the
// receipt, as having no Undo.
//
// Run with: npm run check:code-command-changes
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
for (const f of [['js', 'secret-shapes.js'], ['js', 'code', 'permissions.js'], ['js', 'code', 'command-changes.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
const C = sandbox.HCCodeCommandChanges || {};
const ROOT = '/work/harbour-shop';

console.log('Which commands are watched:');
{
  const w = (command, args) => (typeof C.watches === 'function' ? C.watches({ command, args }, { root: ROOT }) : null);
  ok('a command that only reads is not: nothing to record', w('git', ['status']) === false && w('ls', ['src']) === false);
  ok('a build, an install, a script or a test is', [['npm', ['run', 'build']], ['npm', ['install']], ['python3', ['tools/make.py']], ['npm', ['test']], ['rm', ['-r', 'dist']]].every(([c, a]) => w(c, a) === true));
}

console.log('\nWhat changed between the two records:');
{
  const before = { files: [{ path: 'src/cart.js', size: 10, modified: 100 }, { path: 'src/old.js', size: 5, modified: 50 }, { path: 'README.md', size: 3, modified: 30 }], cut: false };
  const after = { files: [{ path: 'src/cart.js', size: 12, modified: 200 }, { path: 'src/new.js', size: 7, modified: 210 }, { path: 'README.md', size: 3, modified: 30 }], cut: false };
  const d = typeof C.diff === 'function' ? C.diff(before, after) : { paths: [] };
  ok('each file changed, added or removed, by place, and none that stayed as it was', json(d.changed) === '["src/cart.js"]' && json(d.added) === '["src/new.js"]' && json(d.removed) === '["src/old.js"]' && json(d.paths) === '["src/cart.js","src/new.js","src/old.js"]', json(d));
  ok('a time that moved with the size the same is a change too', json(C.diff({ files: [{ path: 'a', size: 1, modified: 1 }] }, { files: [{ path: 'a', size: 1, modified: 2 }] }).changed) === '["a"]');
  ok('nothing changed: nothing said', C.diff(before, before).paths.length === 0 && C.note(C.diff(before, before)) === '');
  const note = C.note(d);
  ok('the model is told each file, how it changed, and that Undo cannot put it back', /^\[The command changed these files in the project: src\/cart\.js \(changed\), src\/new\.js \(new\), src\/old\.js \(removed\)\./.test(note) && /Undo cannot put them back/.test(note), note);
  const many = { files: Array.from({ length: 30 }, (_, i) => ({ path: `f${String(i).padStart(2, '0')}.js`, size: 1, modified: 1 })) };
  const lots = C.note(C.diff({ files: [] }, many));
  ok('...the first twenty by name, and how many more', /f19\.js \(new\), and 10 more\./.test(lots) && !/f20\.js/.test(lots), lots);
  ok('a record cut at its most files says so', /covers the first 2,000 files/.test(C.note(C.diff({ files: [], cut: true }, { files: [{ path: 'a', size: 1, modified: 1 }], cut: true }))));
}

console.log('\nWired into the loop, the tools and the receipt:');
{
  const loop = src('js', 'agent-loop.js'), tools = src('platform', 'tauri', 'hashcoder.js'), view = src('js', 'run-view.js');
  ok('the loop takes a record before and after a watched command, and adds what changed to its result', /const before = watch \? await HC\.code\.snapshot\(\)\.catch\(\(\) => null\) : null;/.test(loop) && /window\.HCCodeCommandChanges\.note\(d\)/.test(loop) && /commandChanged\.push\(/.test(loop));
  ok('...without counting them as the run\'s own changes, so a check that writes files does not undo its own proof', !/commandChanged[^\n]*proof\.edited/.test(loop));
  ok('the record is the native side\'s, of the open project', /HC\.code\.snapshot = \(\) => HC\.invoke\('fs_snapshot', \{ root: HC\.guard\.projectRoot\(\) \}\)/.test(tools));
  ok('the receipt shows the files as changed by commands, with no Undo', /from: 'commands', label: 'By commands'/.test(view) && /no Undo for these/.test(view));
  ok('it is loaded before the Coder, and part of npm run check', src('boot.js').indexOf("'/js/code/command-changes.js'") > 0 && /npm run check:code-command-changes\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/command-changes.js)`);
process.exit(fail ? 1 : 0);
