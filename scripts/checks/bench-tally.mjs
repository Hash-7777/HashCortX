// ==============================================================
// Counting a benchmark when each task is run more than once — checks
//
// Loads the REAL scripts/bench/coder/tally.mjs and holds that rows are grouped
// by task, that a run which never reached the agent is left out of every
// count, that a task is told steady or mixed by its own runs, and that two
// result sets with different numbers of runs are set side by side per run.
// The benchmark itself needs a browser and a model and is not part of this.
//
// Run with: npm run check:bench-tally
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const T = await import(pathToFileURL(join(here, '..', 'bench', 'coder', 'tally.mjs')).href);

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const row = (task, passed, extra = {}) => ({ task, kind: 'fix', model: 'm', pass: passed, notRun: false, notes: [], seconds: 60, steps: 4, failedEdits: 0, tokens: { input: 1000, output: 200 }, ...extra });
const missed = (task) => row(task, false, { notRun: true, seconds: null, notes: ['the time budget for this run was used up'] });
const broke = (task) => row(task, false, { notes: ['the run did not complete: the page threw'] });

console.log('Rows are grouped by task:');
{
  const g = T.groupRows([row('a', true), row('b', false), row('a', false), row('b', false)]);
  ok('in the order the tasks first appear', g.map((x) => x.task).join() === 'a,b');
  ok('each with its own runs', g[0].rows.length === 2 && g[1].rows.length === 2);
  ok('and its passes out of its runs', g[0].passes === 1 && g[0].ran === 2 && g[1].passes === 0);
  ok('nothing in, nothing out', T.groupRows([]).length === 0 && T.groupRows(null).length === 0 && T.groupRows([null, undefined]).length === 0);
}

console.log('\nA task is told steady or mixed by its own runs:');
{
  const kind = (...passes) => T.groupRows(passes.map((p) => row('t', p)))[0].kind;
  ok('every run passed', kind(true, true) === 'steady pass');
  ok('no run passed', kind(false, false) === 'steady fail');
  ok('some did and some did not: that is the noise', kind(true, false) === 'mixed' && kind(false, true, true) === 'mixed');
  ok('one run is steady either way', kind(true) === 'steady pass' && kind(false) === 'steady fail');
  ok('the fraction reads passes over runs', T.fraction(T.groupRows([row('t', true), row('t', false)])[0]) === '1/2' && T.fraction(T.groupRows([row('t', true)])[0]) === '1/1');
}

console.log('\nA run that never reached the agent says nothing:');
{
  const g = T.groupRows([row('t', true), missed('t')])[0];
  ok('it is not counted as a run, or as a failure', g.ran === 1 && g.passes === 1 && g.notRun === 1 && g.kind === 'steady pass');
  const h = T.groupRows([row('t', true), broke('t')])[0];
  ok('nor is one that did not complete', h.ran === 1 && h.kind === 'steady pass');
  const none = T.groupRows([missed('t'), missed('t')])[0];
  ok('a task none of whose runs ran says so', none.kind === 'not run' && T.fraction(none) === '-');
  ok('and is counted apart in the totals', T.overall([none, ...T.groupRows([row('u', true)])]).notRun === 1);
}

console.log('\nThe totals:');
{
  const rows = [row('a', true), row('a', true), row('b', true), row('b', false), row('c', false), row('c', false), missed('d')];
  const t = T.overall(T.groupRows(rows));
  ok('runs and passes', t.runs === 6 && t.passes === 3, JSON.stringify(t));
  ok('tasks that passed every run, failed every run, or did both', t.steadyPass === 1 && t.steadyFail === 1 && t.mixed === 1 && t.notRun === 1 && t.tasks === 4);
}

console.log('\nThe table for repeated runs:');
{
  const lines = T.repeatedLines([row('a', true), row('a', true), row('b', true), row('b', false), row('c', false, { seconds: 120, steps: 6, failedEdits: 2 }), row('c', false, { seconds: 180, steps: 8, failedEdits: 1 })]);
  const text = lines.join('\n');
  ok('a line for each task, with passes out of runs', /a\s+2\/2/.test(text) && /b\s+1\/2/.test(text) && /c\s+0\/2/.test(text));
  ok('and what each task is', /2\/2[^\n]*steady pass/.test(text) && /1\/2[^\n]*mixed/.test(text) && /0\/2[^\n]*steady fail/.test(text));
  ok('time and steps are means of its runs, failed edits their total', /c\s+0\/2\s+2\.5\s+7\.0\s+3\s/.test(text), lines.find((l) => /^\s+c /.test(l)));
  ok('the totals say how many tasks were steady and how many mixed', /passed 3 of 6 runs over 3 tasks/.test(text) && /every run passed: 1 · no run passed: 1 · both: 1/.test(text));
  ok('a task that never ran is shown as not run, with no figures', /d\s+-\s+-\s+-/.test(T.repeatedLines([missed('d'), missed('d')]).join('\n')));
}

console.log('\nTwo result sets, set side by side per run:');
{
  const then = [row('a', false), row('b', true), row('only-then', true)];
  const now = [row('a', true), row('a', false), row('b', true), row('b', true), row('only-now', true)];
  const lines = T.comparisonLines('m', now, then, 'abc1234');
  const text = lines.join('\n');
  ok('only the tasks that ran in both', /2 tasks in both/.test(text) && !/only-/.test(text));
  ok('passes out of runs on each side, though the number of runs differs', /passed 1 of 2 runs then, 3 of 4 now/.test(text), text);
  ok('and the tasks whose result moved, as fractions', /a: 0\/1 then, 1\/2 now/.test(text) && !/b: /.test(text));
  ok('figures are per run, so two runs and one are comparable', /minutes a run 1\.0 then, 1\.0 now/.test(text) && /tokens in a run 1,000 then, 1,000 now/.test(text));
  ok('the earlier run is named', /^Against abc1234 · m/.test(text));
  ok('nothing in common says nothing', T.comparisonLines('m', [row('x', true)], [row('y', true)], '') === null);
  ok('a task that did not run on one side is left out', !T.comparisonLines('m', [row('a', true), row('z', true)], [row('a', true), missed('z')], '').join('\n').includes('z:'));
}

console.log('\nThe runner uses it:');
{
  const run = readFileSync(join(here, '..', 'bench', 'coder', 'run.mjs'), 'utf8');
  ok('--runs is read, a whole number from 1 to 5', /a === '--runs'\) opt\.runs = Number\(next\(i\+\+\)\)/.test(run) && /opt\.runs < 1 \|\| opt\.runs > 5/.test(run));
  ok('each task is run that many times, one after the other, and each row says which run it was', /for \(let again = 1; again <= opt\.runs; again\+\+\)/.test(run) && /row\.run = again/.test(run));
  ok('the time budget still ends the whole run, and the runs left are reported as not run', /Date\.now\(\) > stopAt/.test(run) && /task: task\.id, run: again/.test(run));
  ok('the table and the comparison come from the tally', /repeatedLines\(mine\)/.test(run) && /comparisonLines\(/.test(run));
  ok('the result file says how many runs each task had', /runsPerTask: opt\.runs/.test(run));
  ok('with one run a task is printed as it always was', /if \(opt\.runs > 1\)/.test(run) && /passed \$\{passed\} of \$\{rows\.length\}/.test(run));
  const pkg = readFileSync(join(here, '..', '..', 'package.json'), 'utf8');
  ok('this check is part of npm run check', /npm run check:bench-tally/.test(pkg));
}

console.log(`\n${pass} passed, ${fail} failed  (scripts/bench/coder/tally.mjs)`);
process.exit(fail ? 1 : 0);
