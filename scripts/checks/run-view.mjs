// ==============================================================
// The run view: phases on the rail — checks
//
// Loads the real src/js/run-view.js with the real module it reads to tell a
// check from a command (js/code/verify.js commandKind) and to tell an
// answered ask (js/run-ledger.js answeredBy), and holds how a
// HashCoder run's steps are grouped into phases by the app, never by the
// model: Finding, Reading, Changing, Checking, Reviewing; the one line a
// phase folds to; the brief, each ask of the request with its state; the
// receipt under the answer, each row from a record; and where the drawing
// is wired: only into a reply whose
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
for (const f of [['js', 'code', 'verify.js'], ['js', 'run-ledger.js'], ['js', 'run-view.js']]) vm.runInContext(src(...f), box, { filename: f[f.length - 1] });
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
ok('Reviewing: how many second looks', V.line('reviewing', steps('REVIEW', ['x', 'y'])) === '2 checks');
ok('nothing yet, nothing said', V.line('reading', []) === '');
ok('a check-in from the app in a phase is never counted as work it did', V.line('reading', [{ verb: 'READ', object: 'a.js' }, { verb: 'CHECK', object: 'Checked against the request' }]) === '1 file' && V.line('changing', [{ verb: 'EDIT', object: 'a.js' }, { verb: 'CHECK', object: 'x' }, { verb: 'PLAN', object: 'y' }]) === '1 edit');

console.log('\nThe brief:');
const run = [{ verb: 'GREP', object: 'priceFor' }, { verb: 'READ', object: 'src/pricing/bundle.js' }, { verb: 'EDIT', object: 'src/pricing/bundle.js' }, { verb: 'SHELL', object: 'npm test' }, { verb: 'CHECK', object: 'Checked against the request: 1 ask open' }];
ok('a step serves an ask when it names a word the ask says: in a path, a name, a command', json(V.servedBy('Fix the discount on bundles so it applies once per order', run)) === '[1,2]' && json(V.servedBy('Rename priceFor to priceOf everywhere', run)) === '[0]' && json(V.servedBy('Add a test for it', run)) === '[3]', json([V.servedBy('Fix the discount on bundles so it applies once per order', run), V.servedBy('Rename priceFor to priceOf everywhere', run), V.servedBy('Add a test for it', run)]));
ok('...never the app\'s own check-ins, and never words as common as "file" or "change"', json(V.servedBy('Check the request against the rules', run)) === '[]' && json(V.servedBy('Change the file please', [{ verb: 'EDIT', object: 'docs/file-change.md' }])) === '[]');
const asks = ['Fix the discount on bundles so it applies once per order', 'Add a test for it', 'Rename priceFor to priceOf everywhere', 'Keep the old priceFor export working too'];
const first = 'Fix the discount on bundles so it applies once per order. Also add a test for it, and rename priceFor to priceOf everywhere.';
const mid = V.askMarks(asks, { first, said: '', steps: run.slice(0, 3) });
ok('mid-run: an ask a step served is in work, one none served is open, each with how many steps', json(mid.map((m) => m.state)) === '["working","open","working","working"]' && json(mid.map((m) => m.why)) === '["in work · 2 steps","","in work · 1 step","you added · in work · 1 step"]', json(mid));
ok('...an ask not in the request it began with is one you added while it worked', json(mid.map((m) => m.added)) === '[false,false,false,true]' && V.askMarks(asks, { steps: [] }).every((m) => !m.added));
const said = 'Fixed: the discount on bundles applies once per order now. Rename of priceFor to priceOf done everywhere.';
const end = V.askMarks(asks, { first, said, steps: run.slice(0, 3) });
ok('an ask is answered only when what it said as it finished says it, by the run record\'s own test, with the files changed for it', json(end.map((m) => m.state)) === '["answered","open","answered","working"]' && end[0].why === 'answered · 1 file' && end[2].why === 'answered', json(end));
ok('...so an ask too short for that test is never called answered', V.askMarks(['Add a test for it'], { said: 'Added a test for it.' })[0].state !== 'answered');
ok('...and nothing is answered while nothing was said', V.askMarks(asks, { first, steps: run }).every((m) => m.state !== 'answered'));
ok('an ask you added counts only the steps after it was read, never an earlier search that named it', V.askMarks(asks, { first, steps: run.slice(0, 3), since: [0, 0, 0, 3] })[3].state === 'open' && json(V.servedBy('Keep the old priceFor export working too', [...run, { verb: 'GREP', object: 'priceFor' }], 5)) === '[5]');
ok('the brief\'s count says how many are answered', V.briefCount(end) === '2 of 4 answered' && V.briefCount(mid) === '0 of 4 answered');
ok('the same asks and steps always give the same marks', json(V.askMarks(asks, { first, said, steps: run })) === json(V.askMarks(asks, { first, said, steps: run })));

console.log('\nThe receipt:');
const parts = {
  marks: end,
  changes: [{ added: 12, removed: 3, state: 'accepted' }, { added: 2, removed: 2, state: 'rejected' }, { added: 3, removed: 0, state: 'pending' }],
  files: ['src/pricing/bundle.js', 'src/pricing/index.js', 'src/pricing/legacy.js'],
  proof: { proof: { kind: 'passed', what: '`npm test` passed' }, seen: { found: 0 } },
  left: 'Not done from its plan: add a bundle test.',
};
const rows = V.receipt(parts);
ok('a row for each record with something to say, in a fixed order', json(rows.map((r) => r.label)) === '["Asked","Changed","Proven","Page read","Left"]', json(rows.map((r) => r.label)));
ok('every row names the record it is written from, never the model\'s own account', rows.every((r) => ['stop', 'asks', 'changes', 'proof', 'site', 'facts', 'keep', 'outside', 'claims', 'plan'].includes(r.from)) && json(rows.map((r) => r.from)) === '["asks","changes","proof","site","plan"]');
ok('Asked: how many are answered, and the first the app could not confirm', rows[0].text === '2 of 4 answered' && rows[0].soft === '2 not confirmed: “Add a test for it” and 1 more', rows[0].soft);
ok('Changed: the files the run changed, lines added and taken out, and what is kept, undone and still to decide', rows[1].text === '3 files' && rows[1].plus === 17 && rows[1].minus === 5 && rows[1].soft === '1 kept · 1 undone · 1 to decide' && rows[1].controls === 'decide', json(rows[1]));
ok('...and with nothing left to decide, no controls', V.receipt({ files: ['a.js'], changes: [{ added: 1, removed: 0, state: 'accepted' }] })[0].controls === '' && V.receipt({ marks: V.askMarks(['add a test for it', 'b c', 'd e'], {}) })[0].soft === '3 not confirmed: “Add a test for it” and 2 more');
ok('Proven only for a test that passed after the last change; otherwise said as not proven, not tested or not checked', rows[2].tone === 'good' && rows[2].text === '`npm test` passed' && ['failed', 'untested', 'none'].map((k) => V.receipt({ proof: { proof: { kind: k, what: 'x' } } })[0].label).join() === 'Not proven,Not tested,Not checked' && V.receipt({ proof: { proof: { kind: 'failed', what: 'x' } } })[0].tone === 'attention');
ok('a page read: what was still found, and that it was not seen on screen', rows[3].text === 'nothing found to fix · not seen on screen' && V.receipt({ proof: { proof: null, seen: { found: 2 } } })[0].text === '2 things still found to fix · not seen on screen');
ok('what was not confirmed, taken out, from other sites, said without a run, or left: each a row to look at, in its own words', V.receipt({ facts: 'A.', gone: 'B.', outside: 'C.', claim: 'D.', said: 'E.', left: 'F.' }).map((r) => `${r.label}:${r.tone}:${r.text}`).join('|') === 'Not confirmed:attention:A.|Taken out:attention:B.|Other sites:attention:C.|Not from a run:attention:D. E.|Left:attention:F.');
ok('a run stopped before it finished says why first, as a row to look at', (() => { const s = V.receipt({ stopped: 'Stopped at the step limit. Reply to continue.', left: 'Not done from its plan: x.' }); return s[0].from === 'stop' && s[0].label === 'Stopped' && s[0].tone === 'attention' && s[0].text === 'Stopped at the step limit. Reply to continue.' && s[1].from === 'plan'; })());
ok('nothing to say, no receipt', json(V.receipt({})) === '[]' && json(V.receipt()) === '[]');
ok('what is kept with a saved answer has no controls and no count of decisions, which would go stale', json(V.saved(rows).map((r) => [r.controls || '', r.from === 'changes' ? r.soft : 'x'])) === '[["","x"],["",""],["","x"],["","x"],["","x"]]');

console.log('\nWhere it is drawn:');
const stepsSrc = src('js', 'code', 'steps.js'), view = src('js', 'run-view.js'), css = src('modes', 'code', 'mode.css');
ok('every step of a list goes to it as it is drawn, and a finished step tells it whether it failed', /window\.HCRunView\?\.place\(contentEl, list, el, verb, object\)/.test(stepsSrc) && /window\.HCRunView\?\.stepDone\(el, ok\)/.test(stepsSrc));
ok('...and a reply that settles ends its phases', /window\.HCRunView\?\.end\(contentEl\)/.test(stepsSrc));
ok('phases are drawn only in a reply whose run is going on, never in a saved one drawn again', /if \(!contentEl \|\| !contentEl\.closest\('\.cdr-msg\.running'\)\) return null;/.test(view));
ok('a change waiting for Keep or Undo is never folded away', /if \(!s\.classList\.contains\('cdr-step--change'\)\) s\.classList\.toggle\('cdr-step--folded', folded\);/.test(view));
ok('the turning mark moves only while the run goes on, and not for someone who asks for less motion', /\.cdr-msg\.running \.cdr-phase\.now \.cdr-reticle svg \{ animation: cdr-lock/.test(css) && /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.cdr-reticle svg \{ animation: none; \}/.test(css));
ok('the brief is drawn only for a request of several asks, at the top of the reply, and drawn again at each step, when you add a message, and when the run ends', /code\.asks\.length < most\) return null;/.test(view) && /contentEl\.insertBefore\(box, top \? top\.nextSibling : contentEl\.firstChild\)/.test(view) && /brief\(contentEl\);\n\s+window\.HCCodePreview\?\.onStep\(contentEl, phase\);[^\n]*\n\s+signal\(contentEl\);\n\s+return st\.cur\.id;/.test(view) && /window\.HCRunView\?\.brief\(contentEl\);/.test(stepsSrc) && /brief\(contentEl\);\n\s+window\.HCCodePreview\?\.onStep\(contentEl, 'end'\);\n\s+close\(st\.cur\);/.test(view));
ok('...what it said as it finished is kept for it, and each new request starts with its own words and nothing said', /if \(HC\?\.code\) HC\.code\.said = finalText;/.test(src('js', 'agent-loop.js')) && /if \(HC\?\.code\) \{ HC\.code\.firstRequest = task; HC\.code\.said = '';/.test(src('modes', 'code', 'mode.js')));
ok('...pointing at an ask, or reaching it by keyboard, lights the steps that served it and the phase they are folded in', /cdr-step--served/.test(view) && /cdr-phase--served/.test(view) && /'mouseenter'/.test(view) && /'focus'/.test(view) && /\.cdr-step--served/.test(css));
ok('...and nothing in it moves', !/\.cdr-brief[^{]*\{[^}]*(?:animation|transition)/.test(css) && !/\.cdr-ask[^{]*\{[^}]*(?:animation|transition)/.test(css));
ok('the receipt is drawn under the answer from what the loop hands over, kept with the answer, and drawn again when a saved conversation is opened', /const kept = ui\.receipt\?\.\(\{ commit: commitOffer\(\), proof: proof \? window\.HCCodeVerify\.proofParts\(proof\) : null/.test(src('js', 'agent-loop.js')) && /if \(proven && !kept\) ui\.answer/.test(src('js', 'agent-loop.js')) && /receipt: \(parts\) => window\.HCRunView\?\.receiptIn\(contentEl, parts\)/.test(src('modes', 'code', 'mode.js')) && /\.\.\.\(sharedState\.receipt \? \{ receipt: sharedState\.receipt \} : \{\}\)/.test(src('modes', 'code', 'mode.js')) && /m\.receipt && window\.HCRunView\?\.drawReceipt\(reply, m\.receipt\)/.test(src('modes', 'code', 'mode.js')));
{
  const offer = V.receipt({ files: ['src/cart.js'], commit: { title: 'fix: keep the total in pence' } });
  const row = offer.find((r) => r.from === 'commit');
  ok('a small model\'s changes can be committed from the receipt: a row with its drafted title and a control', !!row && row.label === 'Commit' && row.controls === 'commit' && row.title === 'fix: keep the total in pence');
  ok('...which is for now only: a saved answer keeps no offer to commit', !V.saved(offer).some((r) => r.from === 'commit') && V.saved(offer).length === offer.length - 1);
  ok('...drawn with a title to edit and a button that runs the same commit, with its question', /class="cdr-commit-title" aria-label="Commit title"/.test(view) && /await window\.HC\.code\.gitCommit\(\{ title: input\.value \}\)/.test(view) && /\.cdr-receipt-ctl \.cdr-commit-title \{/.test(css));
  ok('...offered only to a small model, after it changed files, in a repository, in a conversation that asked for git work', /if \(!\(HC\?\.code\?\.gitAsked && \(sharedState\.size === 'small' \|\| sharedState\.light\) && repo && repo\.isRepo && made\.length && window\.HCCodeGit\?\.draftTitle\)\) return null;/.test(src('js', 'agent-loop.js')));
  ok('no offer, no row', !V.receipt({ files: ['a.js'] }).some((r) => r.from === 'commit'));
}
ok('Keep all keeps each change still waiting; Undo all undoes them newest first, one at a time, and stops at the first not undone', /function keepAll\(/.test(view) && /function undoAll\(/.test(view) && /\.cdr-step--change\.cdr-step--pending'\)\]\.reverse\(\)/.test(view) && /if \(el\.classList\.contains\('cdr-step--pending'\)\) return \{ done: false, undone, stopped: el \};/.test(view));
ok('Keep and Undo are one paired control; once one is chosen, only what was chosen is said on the row', /\.cdr-step--accepted \.cdr-step-btn\.undo, \.cdr-step--rejected \.cdr-step-btn\.keep \{ display: none; \}/.test(css) && /\.cdr-step-btn \+ \.cdr-step-btn \{/.test(css));
ok('...the count is drawn again only when a change row\'s own class changes, so its own redrawing never wakes it again', /if \(seen\.some\(\(m\) => m\.target\.classList && m\.target\.classList\.contains\('cdr-step--change'\)\)\)/.test(view) && /if \(row\.className !== cls\) row\.className = cls;/.test(view));
ok('...and the changes a finished reply gathers go above it, never below', /contentEl\.insertBefore\(box, contentEl\.querySelector\(':scope > \.cdr-receipt'\)\);/.test(stepsSrc));
ok('...and nothing in the receipt moves', !/\.cdr-receipt[^{]*\{[^}]*(?:animation|transition)/.test(css));
const boot = src('boot.js');
ok('it is loaded after the module it reads and before the steps that call it', boot.indexOf("'/js/run-view.js'") > boot.indexOf("'/js/code/verify.js'") && boot.indexOf("'/js/run-view.js'") < boot.indexOf("'/js/code/steps.js'"));
ok('it is part of npm run check', /npm run check:run-view\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/run-view.js)`);
process.exit(fail ? 1 : 0);
