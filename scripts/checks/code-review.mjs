// ============================================================
// A second look at HashCoder's work, with a clean slate —
// src/js/code/review.js, and where the Coder uses it.
// Run with: npm run check:code-review
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(src('js', 'diff.js'), box, { filename: 'diff.js' });
vm.runInContext(src('js', 'fences.js'), box, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'verify.js'), box, { filename: 'verify.js' });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'review.js'), box, { filename: 'review.js' });
const R = box.window.HCCodeReview;
const V = box.window.HCCodeVerify;
const diffLines = box.window.HCDiff.diffLines;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('What a run changed:');
{
  const changes = new Map();
  R.track(changes, '/p/cli.js', { existed: true, content: 'a\nb\nc\n', after: 'a\nB\nc\n' });
  R.track(changes, '/p/cli.js', { existed: true, content: 'a\nB\nc\n', after: 'a\nB\nc\nd\n' });
  R.track(changes, '/p/new.js', { existed: false, content: null, after: 'x\n' });
  R.track(changes, '/p/logo.png', { existed: true, content: null, unrestorable: 'not text', after: null });
  const cli = changes.get('/p/cli.js');
  ok('a file changed twice keeps what it held before the run, and what it holds now', cli.before === 'a\nb\nc\n' && cli.after === 'a\nB\nc\nd\n');
  ok('a new file had nothing before it', changes.get('/p/new.js').before === null);
  const shown = R.diffText(changes, diffLines);
  ok('the reviewer sees each change marked, with the file named', /--- \/p\/cli\.js\n[^]*- b\n\+ B[^]*\+ d/.test(shown.text) && /--- \/p\/new\.js \(new\)\n\+ x/.test(shown.text), shown.text);
  ok('a file the app keeps no copy of is named, not shown', /--- \/p\/logo\.png\n\(not shown/.test(shown.text));
  ok('and how much changed, in lines and files', shown.changed >= 4 && shown.files === 3, `${shown.changed} ${shown.files}`);
  const big = new Map([['/p/big.js', { before: '', after: Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') }]]);
  ok('long changes are cut, saying so', /the rest of the changes are not shown/.test(R.diffText(big, diffLines).text) && R.diffText(big, diffLines).text.length < R.MAX_SHOWN + 100);
  const unchanged = new Map([['/p/same.js', { before: 'a\n', after: 'a\n' }]]);
  ok('a file written back as it was shows nothing', R.diffText(unchanged, diffLines).text === '');
}

console.log('\nWhich work gets a second look:');
{
  ok('a large model\'s change to several files', R.worthReview({ size: 'full', files: 2, changed: 4 }));
  ok('or of enough lines to one', R.worthReview({ size: 'full', files: 1, changed: R.MIN_LINES }) && !R.worthReview({ size: 'full', files: 1, changed: R.MIN_LINES - 1 }));
  ok('never a small or mid-sized model, which checks against the request instead', !R.worthReview({ size: 'mid', files: 3, changed: 90 }) && !R.worthReview({ size: 'small', files: 3, changed: 90 }));
  ok('not with proving switched off', !R.worthReview({ size: 'full', prove: false, files: 3, changed: 90 }));
  ok('and once a run at most', !R.worthReview({ size: 'full', files: 3, changed: 90, reviewed: 1 }));
}

console.log('\nWhat the reviewer is asked, and what counts as a finding:');
{
  const m = R.messages('Add a --json flag', 'Checked after the last change: `npm test` passed.', '--- /p/cli.js\n+ x');
  ok('instructions, then the request, the proof and the changes, and nothing of the conversation', m.length === 2 && m[0].role === 'system' && m[0].content === R.INSTRUCTIONS && /The request:\nAdd a --json flag/.test(m[1].content) && /npm test` passed/.test(m[1].content) && /\+ x$/.test(m[1].content));
  ok('says what nothing run looks like', /nothing was run/.test(R.messages('r', '', 'd')[1].content));
  ok('LOOKS RIGHT is not a finding', R.verdict('LOOKS RIGHT').ok);
  const found = R.verdict('PROBLEMS:\n- cli.js: --json prints nothing when there are no rows\n2) tests/cli.test.js: the assertion was loosened');
  ok('each problem is a finding, however it is listed', !found.ok && found.problems.length === 2 && /^cli\.js: --json prints nothing/.test(found.problems[0]) && /^tests\/cli\.test\.js/.test(found.problems[1]));
  ok('"none" under the heading is not a finding', R.verdict('PROBLEMS:\n- none').ok && R.verdict('**PROBLEMS:**\nNo problems found.').ok);
  ok('an empty or rambling answer holds nothing up', R.verdict('').ok && R.verdict(null).ok && R.verdict('The change seems fine overall.').ok);
  ok('at most a handful of problems are sent back', R.verdict('PROBLEMS:\n' + Array.from({ length: 20 }, (_, i) => `- p${i}`).join('\n')).problems.length === 8);
}

console.log('\nThe note sending the agent back:');
{
  const note = V.freshReviewNote(['cli.js: --json prints nothing']);
  ok('names each problem, to fix where right and answer where not', note.kind === 'fresh' && V.isAppNote(note.message) && /- cli\.js: --json prints nothing/.test(note.message) && /If one is wrong, say why/.test(note.message));
  ok('a saved conversation names the step', V.noteStep(note.message) === 'Sent back with what a second look found');
}

console.log('\nHashCoder:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('keeps what each changed file held, from the undo records', /window\.HCCodeReview\?\.track\(changes, p, HC\?\.undo\?\.lastFor\?\.\(p\)\)/.test(mode));
  ok('asks for a second look only when nothing else sent the agent back, the site check included, and it answered', /\|\| \(finalText\.trim\(\) \? \(await siteLook\(\)\) \|\| \(await secondLook\(\)\) : null\);/.test(mode));
  ok('of the same model, with no tools and nothing of the conversation', /await callWithRouter\(R\.messages\(\(window\.HCCodeAttach\?\.shownRequest \|\| String\)\(V\.requestIn\(messages\)\), V\.proofLine\(proof\), shown\.text\), \[\], 0, signal, coderModel\)/.test(mode));
  ok('a second look that fails holds nothing up, but Stop still stops', /catch \(e\) \{ if \(signal\?\.aborted\) throw e; return null; \}/.test(mode));
  ok('the run shows the step', /verb: 'REVIEW', object: found\.ok \? 'looks right'/.test(mode));
  ok('the helpers that split a task between agents are gone', !/runMultiTurn|agentCount/.test(mode) && !/cdrAgentCount/.test(src('core', 'settings', 'panel.html')));
  ok('Settings says the second look belongs to the proving switch', /After a larger change, a larger model takes a second look at it with a clean slate/.test(src('core', 'settings', 'panel.html')));
  ok('it is loaded before the mode', src('boot.js').includes("'/js/code/review.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/review.js)`);
process.exit(fail ? 1 : 0);
