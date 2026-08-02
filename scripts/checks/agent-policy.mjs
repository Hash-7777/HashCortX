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

const { effectOf, planBatches, shouldContinue, iterationMadeProgress, BUDGET } =
  sandbox.window.HCAgentPolicy;

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
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/agent-policy.js)`);
process.exit(fail ? 1 : 0);
