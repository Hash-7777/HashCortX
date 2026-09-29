// ==============================================================
// Agent loop policy checks
//
// Loads the real src/js/agent-policy.js. Batching is the kind of change that
// looks fine until the day it reorders a write past a read and corrupts
// someone's file, so the ordering rules are pinned here rather than trusted.
//
// Run with: npm run check:policy
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'agent-policy.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'agent-policy.js' });

const {
  effectOf, planBatches, shouldContinue, iterationMadeProgress, BUDGET,
  newRunBudget, runBudgetExceeded, chargeRunBudget, RUN_BUDGET,
} = sandbox.window.HCAgentPolicy;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const call = (name, args) => ({ name, arguments: args || {} });
const shape = (batches) => batches.map(b => b.map(c => c.name).join('+')).join(' | ');

console.log('\nWhat each tool does:');
check('reads are reads', effectOf('read_file') === 'read' && effectOf('grep_code') === 'read');
check('writes are writes', effectOf('write_file') === 'write' && effectOf('delete_file') === 'write');
check('shell is exec', effectOf('shell_run') === 'exec');
check('an UNKNOWN tool is treated as exec, not as a read',
  effectOf('some_new_tool') === 'exec',
  'the safe assumption about something unfamiliar is that it changes things');

console.log('\nBatching — reads run together:');
{
  const b = planBatches([call('read_file', { path: '/a' }), call('read_file', { path: '/b' }),
                         call('grep_code', { dir: '/x' })]);
  check('three independent reads become one batch', shape(b) === 'read_file+read_file+grep_code', shape(b));
}
{
  const b = planBatches([call('read_file'), call('read_file'), call('read_file'),
                         call('read_file'), call('read_file'), call('read_file')]);
  check('batches are capped so the UI can still show what is happening',
    b.length === 2 && b[0].length === 5 && b[1].length === 1, shape(b));
}

console.log('\nBatching — order is never rearranged:');
{
  // The one that matters. A read after a write must see the write.
  const b = planBatches([call('read_file', { path: '/a' }), call('write_file', { path: '/a' }),
                         call('read_file', { path: '/a' })]);
  check('a write separates the reads around it',
    shape(b) === 'read_file | write_file | read_file', shape(b));
}
{
  const b = planBatches([call('write_file'), call('write_file')]);
  check('two writes never run together', shape(b) === 'write_file | write_file', shape(b));
}
{
  const b = planBatches([call('shell_run'), call('read_file')]);
  check('a command runs alone, before the read that follows it',
    shape(b) === 'shell_run | read_file', shape(b));
}
{
  const b = planBatches([call('read_file'), call('shell_run'), call('read_file'), call('read_file')]);
  check('reads either side of a command stay on their own sides',
    shape(b) === 'read_file | shell_run | read_file+read_file', shape(b));
}
check('no calls are lost',
  planBatches([call('read_file'), call('write_file'), call('read_file')])
    .reduce((n, b) => n + b.length, 0) === 3);
check('an empty turn produces no batches', planBatches([]).length === 0);
check('a null call is skipped rather than fatal',
  planBatches([null, call('read_file')]).length === 1);

console.log('\nWhen to stop:');
check('an early iteration continues',
  shouldContinue({ iteration: 3 }).continue === true);
check('the hard limit stops it whatever it claims',
  shouldContinue({ iteration: BUDGET.hardLimit, madeProgress: true }).continue === false);
check('repeating itself stops it',
  shouldContinue({ iteration: 5, stalledIterations: BUDGET.stallLimit }).reason === 'stalled');
check('past the soft limit it continues ONLY while still changing something',
  shouldContinue({ iteration: BUDGET.softLimit, madeProgress: true }).continue === true &&
  shouldContinue({ iteration: BUDGET.softLimit, madeProgress: false }).continue === false);
check('it is warned before the budget runs out',
  typeof shouldContinue({ iteration: BUDGET.softLimit - 2 }).nudge === 'string');
check('every stop explains itself to the user',
  ['hard-limit', 'stalled', 'soft-limit'].every(r => {
    const cases = {
      'hard-limit': { iteration: BUDGET.hardLimit },
      'stalled': { iteration: 5, stalledIterations: BUDGET.stallLimit },
      'soft-limit': { iteration: BUDGET.softLimit, madeProgress: false },
    };
    const out = shouldContinue(cases[r]);
    return out.continue === false && typeof out.message === 'string' && out.message.length > 20;
  }));
check('the new budget is larger than the old fixed 16',
  BUDGET.softLimit > 16 && BUDGET.hardLimit > BUDGET.softLimit);

console.log('\nProgress detection:');
{
  const seen = new Set();
  check('a write is progress', iterationMadeProgress([call('write_file', { path: '/a' })], seen));
  check('a shell command is progress', iterationMadeProgress([call('shell_run')], seen));
  check('a NEW read is progress',
    iterationMadeProgress([call('read_file', { path: '/new' })], seen));
  check('re-reading the SAME file is not progress',
    iterationMadeProgress([call('read_file', { path: '/new' })], seen) === false,
    'this is the signature of an agent that has lost the thread');
  check('nothing at all is not progress', iterationMadeProgress([], seen) === false);
  const test = call('shell_run', { command: 'npm', args: ['test'] });
  check('a command run again with the same arguments is not progress', iterationMadeProgress([test], seen) && iterationMadeProgress([call('shell_run', { command: 'npm', args: ['test'] })], seen) === false);
  check('... nor a write repeated as it was', iterationMadeProgress([call('write_file', { path: '/b', content: 'x' })], seen) && iterationMadeProgress([call('write_file', { path: '/b', content: 'x' })], seen) === false);
  check('... while the same command with other arguments is', iterationMadeProgress([call('shell_run', { command: 'npm', args: ['test', '--', 'range'] })], seen));
  check('a caller keeping no record counts every command as progress', iterationMadeProgress([test]) && iterationMadeProgress([test]));
}

console.log('\nAn agent repeating itself is told to do something different:');
{
  const out = shouldContinue({ iteration: 6, stalledIterations: 2 });
  check('after two steps that changed nothing it goes on, told to do something different', out.continue && out.reason === 'repeating' && /Do something different/.test(out.nudge));
  check('one such step is not yet repeating', shouldContinue({ iteration: 6, stalledIterations: 1 }).reason === 'within-budget');
  check('and at the stall limit it stops, as before', shouldContinue({ iteration: 6, stalledIterations: BUDGET.stallLimit }).reason === 'stalled');
}

console.log('\nAn agent that has done its work is told to finish, and is not blamed for looking:');
{
  const seen = new Set();
  const read = (p) => call('read_file', { path: p });
  iterationMadeProgress([read('/p/style.css'), read('/p/index.html')], seen);
  check('reading back a file just changed is checking it, not repeating', iterationMadeProgress([call('patch_file', { path: '/p/style.css', search: 'a', replace: 'b' })], seen) && iterationMadeProgress([read('/p/style.css')], seen));
  check('...while a file nothing changed is still a repeat', iterationMadeProgress([read('/p/index.html')], seen) === false);
  check('...and a second read of the changed file is a repeat again', iterationMadeProgress([read('/p/style.css')], seen) === false);
  iterationMadeProgress([call('list_dir', { path: '/p' })], seen);
  check('a new file makes its folder new to list', iterationMadeProgress([call('write_file', { path: '/p/new.js', content: 'x' })], seen) && iterationMadeProgress([call('list_dir', { path: '/p' })], seen));
  check('a move makes both ends new to read', iterationMadeProgress([read('/p/a.js'), read('/p/b.js')], seen) && iterationMadeProgress([call('move_file', { from: '/p/a.js', to: '/p/b.js' })], seen) && iterationMadeProgress([read('/p/b.js')], seen));
  const same = call('write_file', { path: '/p/loop.js', content: 'same' });
  iterationMadeProgress([same], seen); iterationMadeProgress([read('/p/loop.js')], seen);
  check('a write repeated as it was does not make its file new to read, so writing and reading in a loop still stalls',
    iterationMadeProgress([call('write_file', { path: '/p/loop.js', content: 'same' })], seen) === false && iterationMadeProgress([read('/p/loop.js')], seen) === false);
  const grep = (pattern) => call('grep_code', { dir: '/p', pattern });
  check('a search for other words in the same folder is progress', iterationMadeProgress([grep('reveal')], seen) && iterationMadeProgress([grep('hero-img')], seen));
  check('...the same search again is not', iterationMadeProgress([grep('reveal')], seen) === false);
  check('...until a file in that folder changes', iterationMadeProgress([call('patch_file', { path: '/p/css/site.css', search: 'x', replace: 'y' })], seen) && iterationMadeProgress([grep('reveal')], seen));
  const part = (start) => call('read_file', { path: '/p/long.js', start_line: start, end_line: start + 199 });
  check('another part of a long file is progress, the same part again is not', iterationMadeProgress([part(1)], seen) && iterationMadeProgress([part(200)], seen) && iterationMadeProgress([part(200)], seen) === false);
  check('a folder whose name begins like a changed file\'s folder is not taken for it', iterationMadeProgress([call('list_dir', { path: '/p2' })], seen) && iterationMadeProgress([call('write_file', { path: '/p/x.js', content: '1' })], seen) && iterationMadeProgress([call('list_dir', { path: '/p2' })], seen) === false);
  const plan = (done) => call('update_plan', { steps: [{ step: 'page', status: 'done' }, { step: 'styles', status: done ? 'done' : 'doing' }] });
  check('a step of the plan marked done is progress', iterationMadeProgress([plan(false)], seen) && iterationMadeProgress([plan(true)], seen));
  check('...the same plan sent again is not', iterationMadeProgress([plan(true)], seen) === false);
  const done = shouldContinue({ iteration: 9, stalledIterations: 2, changed: 3, planDone: true });
  check('with every step of its plan done, it is told to finish now', done.continue && /Every step of your plan is done/.test(done.nudge) && /Finish now/.test(done.nudge));
  const changedOnly = shouldContinue({ iteration: 9, stalledIterations: 2, changed: 1 });
  check('with its change made, it is told to finish if the change is complete', /If the change is complete, finish now/.test(changedOnly.nudge));
  const stop = shouldContinue({ iteration: 12, stalledIterations: BUDGET.stallLimit, changed: 3 });
  check('stopped after its changes, the person is told the changes are there to keep or undo, and nobody is blamed',
    stop.reason === 'stalled' && /made its changes/.test(stop.message) && /Keep and Undo/.test(stop.message) && !/repeating itself/.test(stop.message));
  check('stopped having changed nothing, it says so as before', /repeating itself/.test(shouldContinue({ iteration: 6, stalledIterations: BUDGET.stallLimit }).message));
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  check('HashCoder says whether files changed and whether the plan is done',
    /changed: proof \? proof\.changed\.length : 0,/.test(mode) && /planDone: !!HC\?\.code\?\.plan && !!window\.HCCodePlan && !window\.HCCodePlan\.openSteps\(HC\.code\.plan\)\.length,/.test(mode));
}

// ── The ceiling on one generation ─────────────────────────────────────────
//
// ERP's pipeline retries, then fails over, then runs a second pipeline that
// retries again — and every failure moved to the next provider instead of
// stopping. Nothing bounded the total, so a run that could not succeed worked
// through every configured model rather than ending. These pin the ceiling
// that now does end it.
console.log('\nOne generation has an end:');
{
  const t0 = 1_000_000;
  const budget = newRunBudget(t0, { ms: 60_000, calls: 3 });

  check('a fresh budget allows a call', runBudgetExceeded(budget, t0) === null);
  check('time left and calls left both allow it',
    runBudgetExceeded(budget, t0 + 59_000) === null);

  // The clock alone must end it. A model that answers slowly never exhausts a
  // call count, which is the shape of the run that felt like a hang.
  check('running out of time stops it', typeof runBudgetExceeded(budget, t0 + 60_000) === 'string');
  check('the deadline is inclusive, not one tick late',
    runBudgetExceeded(budget, t0 + 60_001) !== null);

  // And the call count alone must end it, for a run of fast failures that
  // would otherwise burn the whole provider list well inside the time limit.
  const fast = newRunBudget(t0, { ms: 60_000, calls: 3 });
  chargeRunBudget(fast); chargeRunBudget(fast);
  check('under the call ceiling still runs', runBudgetExceeded(fast, t0) === null);
  chargeRunBudget(fast);
  check('running out of calls stops it', typeof runBudgetExceeded(fast, t0) === 'string');

  // The message is what the user sees after minutes of waiting, so it has to
  // say what was spent and what to do, not just that something failed.
  const reason = runBudgetExceeded(fast, t0);
  check('the reason says how much was spent', /3 model calls/.test(reason), reason);
  check('the reason says what to do next', /try a different one/.test(reason), reason);

  // A refusal must not consume anything, or asking twice would charge twice.
  const untouched = newRunBudget(t0, { ms: 60_000, calls: 3 });
  runBudgetExceeded(untouched, t0);
  runBudgetExceeded(untouched, t0);
  check('asking does not spend', untouched.callsUsed === 0);

  // No budget means no ceiling — every other caller of this module is
  // unaffected by the ERP change.
  check('no budget never stops anything', runBudgetExceeded(null, t0) === null);
  check('there is a default ceiling', RUN_BUDGET.ms > 0 && RUN_BUDGET.calls > 0);
}

console.log('\nA tool that answers with a failure has failed:');
{
  const F = sandbox.HCAgentPolicy.failedResult;
  check('an answer of { error } is a failure', F({ error: 'query is required' }) && F({ ok: false, error: 'key and value are required' }));
  check('... and so is { ok: false } with no error named', F({ ok: false }));
  check('what a tool found, or nothing at all, is not', !F({ ok: true, saved: { key: 'a' } }) && !F({ facts: [] }) && !F('text') && !F(null) && !F(undefined) && !F([{ error: 'a row' }]) && !F({ error: null }));
  const app = readFileSync(join(here, '..', '..', 'src', 'js', 'app.js'), 'utf8');
  const run = app.slice(app.indexOf('async function runOneTool'), app.indexOf('async function agentTurnOllama'));
  check('chat marks and records a tool by it, so a memory save that saved nothing is not reported as saved',
    /const failed = HCAgentPolicy\.failedResult\(result\);/.test(run) && /tracker\.push\(\{ name, ok: !failed,/.test(run) && /failed \? "failed" : "done"/.test(run));
}

console.log('\nThe same file changed again and again:');
{
  const { editLoop, EDIT_LOOP } = sandbox.HCAgentPolicy;
  const edit = (path) => ({ name: 'patch_file', arguments: { path, search: 'a', replace: 'b' } });
  const counts = new Map();
  const notes = [];
  for (let i = 1; i <= EDIT_LOOP * 2; i++) notes.push(editLoop(counts, [edit('/p/src/text.js')], false));
  check('says nothing for the first few changes to a file', notes.slice(0, EDIT_LOOP - 1).every((n) => n === ''));
  check(`tells the agent to stop and read at ${EDIT_LOOP} changes, naming the file, and again at twice that`,
    /text\.js 4 times in this run with no check passing since/.test(notes[EDIT_LOOP - 1]) && /read the file as it is now and the last error in full/.test(notes[EDIT_LOOP - 1])
    && notes.slice(EDIT_LOOP, EDIT_LOOP * 2 - 1).every((n) => n === '') && /8 times/.test(notes[EDIT_LOOP * 2 - 1]));
  check('marks the note as from the app', notes[EDIT_LOOP - 1].startsWith('Note from HashCortX, not from the person:'));
  check('a check that passes starts every count again', editLoop(counts, [edit('/p/src/text.js')], true) === '' && counts.size === 0);
  const other = new Map();
  editLoop(other, [edit('/p/a.js'), edit('/p/b.js'), { name: 'read_file', arguments: { path: '/p/a.js' } }], false);
  check('files are counted apart, and reading is not changing', other.get('/p/a.js') === 1 && other.get('/p/b.js') === 1 && other.size === 2);
  check('whole rewrites count too', (() => { const m = new Map(); editLoop(m, [{ name: 'write_file', arguments: { path: '/p/x.py' } }], false); return m.get('/p/x.py') === 1; })());
  const mode = readFileSync(join(here, '..', '..', 'src', 'modes', 'code', 'mode.js'), 'utf8');
  check('HashCoder counts each turn\'s edits, with whether a check passed in it, and says the note once',
    /loopNote = policy\.editLoop\(edited, turn\.tool_calls, !!proof && proof\.checks\.slice\(checked\)\.some\(\(c\) => c\.pass\)\) \|\| loopNote;/.test(mode)
    && /\[verdict\.nudge, loopNote, window\.HCCodePlan\?\.recite\(HC\?\.code\?\.plan\)\]\.filter\(Boolean\)\.join\('\\n\\n'\); loopNote = '';/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-policy.js)`);
process.exit(fail ? 1 : 0);
