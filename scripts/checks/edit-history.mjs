// ==============================================================
// Undo/redo checks
//
// Loads the REAL src/js/edit-history.js into a Node VM and drives it the way
// a person edits: a run of changes, a run of undos back to the start, redo
// forward again, then a new edit that makes the redo branch unreachable.
//
// The property that matters most is the one that is easy to half-build: undo
// keeps going, all the way to where the editing began, rather than only
// reversing the last thing.
//
// Run with: npm run check:edit-history
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'edit-history.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'edit-history.js' });
const H = sandbox.window.HCEditHistory;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nThe module is there:');
ok('HCEditHistory is published', !!H);
ok('create returns a history', typeof H?.create === 'function' && typeof H.create().push === 'function');

console.log('\nA fresh history has nothing to undo:');
{
  const h = H.create();
  ok('nothing to undo', !h.canUndo());
  ok('nothing to redo', !h.canRedo());
  ok('undo on an empty history is not an error', h.undo() === null);
  ok('redo on an empty history is not an error', h.redo() === null);
}

console.log('\nUndo walks all the way back, not just one step:');
{
  const h = H.create({ same: deep });
  // Five moves of one part, as five drags would make.
  const states = [0, 1, 2, 3, 4, 5].map((y) => ({ pos: [0, y, 0] }));
  for (let i = 0; i < 5; i++) h.push('move', states[i], states[i + 1]);
  ok('five edits are five steps', h.size() === 5);

  let current = states[5];
  let steps = 0;
  while (h.canUndo()) { current = h.undo().before; steps++; }
  ok('undo keeps going until the start', steps === 5);
  ok('and lands on the state before the first edit', deep(current, states[0]));
  ok('with nothing left to undo', !h.canUndo());
  ok('and everything available to redo', h.canRedo());

  let redone = 0;
  while (h.canRedo()) { current = h.redo().after; redone++; }
  ok('redo walks forward the same distance', redone === 5);
  ok('and lands back on the last state', deep(current, states[5]));
}

console.log('\nA new edit discards the branch that was undone:');
{
  const h = H.create({ same: deep });
  h.push('a', { v: 0 }, { v: 1 });
  h.push('b', { v: 1 }, { v: 2 });
  h.undo();
  ok('there is something to redo', h.canRedo());
  h.push('c', { v: 1 }, { v: 9 });
  ok('a new edit removes it', !h.canRedo());
  ok('and the history is now two steps', h.size() === 2);
  ok('undo still returns the new step first', deep(h.undo().after, { v: 9 }));
}

console.log('\nA step that changed nothing is not a step:');
{
  const h = H.create({ same: deep });
  ok('an identical before and after is refused', h.push('move', { v: 1 }, { v: 1 }) === false);
  ok('nothing was recorded', h.size() === 0 && !h.canUndo());
  ok('a real change is recorded', h.push('move', { v: 1 }, { v: 2 }) === true);
  // Deep equality matters: two separate objects holding the same numbers are
  // the same state, and a drag that returns to where it started makes exactly
  // that pair.
  ok('sameness is judged by value, not by identity',
    h.push('move', { v: 2, at: [1, 2] }, { v: 2, at: [1, 2] }) === false);
}

console.log('\nThe record is bounded:');
{
  const h = H.create({ limit: 3, same: deep });
  for (let i = 0; i < 10; i++) h.push('move', { v: i }, { v: i + 1 });
  ok('it keeps only the limit', h.size() === 3);
  ok('and it keeps the most recent', deep(h.undo().after, { v: 10 }));
  ok('the limit is reported', h.limit() === 3);
  const bad = H.create({ limit: 0 });
  ok('a nonsense limit falls back to the default', bad.limit() === H.DEFAULT_LIMIT);
}

console.log('\nClearing starts again:');
{
  const h = H.create({ same: deep });
  h.push('a', { v: 0 }, { v: 1 });
  h.undo();
  h.clear();
  ok('nothing to undo', !h.canUndo());
  ok('nothing to redo', !h.canRedo());
  ok('and it is empty', h.size() === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/edit-history.js)\n`);
process.exit(fail ? 1 : 0);
