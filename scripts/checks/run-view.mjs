// ==============================================================
// The run view: phases on the rail — checks
//
// Loads the real src/js/run-view.js with the real module it reads to tell a
// check from a command (js/code/verify.js commandKind), and holds how a
// HashCoder run's steps are grouped into phases by the app, never by the
// model: Finding, Reading, Changing, Checking, Reviewing; the one line a
// phase folds to; and where the drawing is wired: only into a reply whose
// run is going on, its turning mark only while it runs. The drawing itself
// is looked at in a browser. Every step here is invented.
//
// Run with: npm run check:run-view
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
for (const f of [['js', 'code', 'verify.js'], ['js', 'run-view.js']]) vm.runInContext(src(...f), box, { filename: f[f.length - 1] });
const V = box.HCRunView;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

console.log('\nThe phase of a step:');
ok('looking for where things are, before anything changed, is Finding', ['FIND', 'GREP', 'LIST'].every((v) => V.phaseOf(v, 'x', false) === 'finding'));
ok('...and after a change, Reading', ['FIND', 'GREP', 'LIST'].every((v) => V.phaseOf(v, 'x', true) === 'reading'));
ok('reading a file, a page or a search is Reading', ['READ', 'FETCH', 'SEARCH', 'KB', 'PHOTOS', 'RECALL'].every((v) => V.phaseOf(v, 'x', false) === 'reading'));
ok('a change to a file is Changing', ['EDIT', 'WROTE', 'DELETE', 'MOVE'].every((v) => V.phaseOf(v, 'src/a.js', false) === 'changing'));
ok('a command that checks the work is Checking', ['npm test', 'npm run lint', 'npx tsc --noEmit', 'npm run build', 'pytest -q', 'cargo test'].every((c) => V.phaseOf('SHELL', c, true) === 'checking'), json(['npm test', 'npm run lint', 'npx tsc --noEmit', 'npm run build', 'pytest -q', 'cargo test'].map((c) => V.phaseOf('SHELL', c, true))));
ok('...any other command, and one that formats, is Changing', ['mkdir -p site/css', 'git mv a b', 'npx prettier --write .'].every((c) => V.phaseOf('SHELL', c, true) === 'changing'));
ok('a second look is Reviewing', V.phaseOf('REVIEW', 'looks right', true) === 'reviewing');
ok('a check-in from the app is a row of its own in the phase it happened in, never a phase', V.phaseOf('CHECK', 'Sent back to prove it', true) === null);
ok('a step that belongs to no phase, a plan or a lesson, stays in the phase it is in', V.phaseOf('PLAN', '3 steps', true) === null && V.phaseOf('LESSON', 'x', true) === null && V.phaseOf('', '', false) === null);
ok('the same step always gets the same phase', V.phaseOf('SHELL', 'npm test', true) === V.phaseOf('SHELL', 'npm test', true));
ok('...the phases, in the order a run goes through them, each with a name and a drawn mark', json(V.PHASES) === '["finding","reading","changing","checking","reviewing"]' && V.PHASES.every((p) => V.NAMES[p] && /<path|<circle/.test(V.ICONS[p])));

console.log('\nThe one line a phase folds to:');
const steps = (verb, objs, failed = []) => objs.map((o, i) => ({ verb, object: o, failed: failed.includes(i) }));
ok('Finding: how many searches', V.line('finding', steps('GREP', ['priceFor'])) === '1 search' && V.line('finding', steps('FIND', ['a', 'b', 'c'])) === '3 searches');
ok('Reading: how many files, each once', V.line('reading', steps('READ', ['src/a.js', 'src/b.js', 'src/a.js'])) === '2 files' && V.line('reading', steps('READ', ['src/a.js'])) === '1 file');
ok('...and what else was read', V.line('reading', [...steps('READ', ['src/a.js']), ...steps('FETCH', ['https://example.org/docs'])]) === '1 file, 1 other read');
ok('Changing: how many edits, and how many commands', V.line('changing', steps('EDIT', ['a', 'b'])) === '2 edits' && V.line('changing', [...steps('EDIT', ['a']), ...steps('SHELL', ['mkdir x'])]) === '1 edit, 1 command');
ok('Checking: how many commands, and how many failed', V.line('checking', steps('SHELL', ['npm test'])) === '1 command' && V.line('checking', steps('SHELL', ['npm test', 'npm test'], [0])) === '2 commands, 1 failed');
ok('Reviewing: how many checks', V.line('reviewing', steps('CHECK', ['x', 'y'])) === '2 checks');
ok('nothing yet, nothing said', V.line('reading', []) === '');

console.log('\nWhere it is drawn:');
const stepsSrc = src('js', 'code', 'steps.js'), view = src('js', 'run-view.js'), css = src('modes', 'code', 'mode.css');
ok('every step of a list goes to it as it is drawn, and a finished step tells it whether it failed', /window\.HCRunView\?\.place\(contentEl, list, el, verb, object\)/.test(stepsSrc) && /window\.HCRunView\?\.stepDone\(el, ok\)/.test(stepsSrc));
ok('...and a reply that settles ends its phases', /window\.HCRunView\?\.end\(contentEl\)/.test(stepsSrc));
ok('phases are drawn only in a reply whose run is going on, never in a saved one drawn again', /if \(!contentEl \|\| !contentEl\.closest\('\.cdr-msg\.running'\)\) return null;/.test(view));
ok('a change waiting for Keep or Undo is never folded away', /if \(!s\.classList\.contains\('cdr-step--change'\)\) s\.classList\.toggle\('cdr-step--folded', folded\);/.test(view));
ok('the turning mark moves only while the run goes on, and not for someone who asks for less motion', /\.cdr-msg\.running \.cdr-phase\.now \.cdr-reticle svg \{ animation: cdr-lock/.test(css) && /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.cdr-reticle svg \{ animation: none; \}/.test(css));
const boot = src('boot.js');
ok('it is loaded after the module it reads and before the steps that call it', boot.indexOf("'/js/run-view.js'") > boot.indexOf("'/js/code/verify.js'") && boot.indexOf("'/js/run-view.js'") < boot.indexOf("'/js/code/steps.js'"));
ok('it is part of npm run check', /npm run check:run-view\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/run-view.js)`);
process.exit(fail ? 1 : 0);
