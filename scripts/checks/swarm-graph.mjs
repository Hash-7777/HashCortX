// ==============================================================
// Swarm graph — checks
//
// Loads the REAL src/js/swarm/graph.js. The Swarm Maker wires agents to each
// other, and the one thing that wiring must never contain is a cycle — not
// because the answer would be wrong but because the run would never finish,
// spending a person's model quota in a loop until they noticed.
//
// The important check here is not any single example. It is the property: for
// any graph at all, what comes back from breaking the cycles must have none
// left. That is asserted over a few thousand random graphs, because the shapes
// that break this kind of code are the ones nobody thinks to write down.
//
// Run with: npm run check:swarm-graph
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'swarm', 'graph.js'), 'utf8'), sandbox, { filename: 'graph.js' });
const G = sandbox.window.HCSwarmGraph;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const agents = (...ids) => ids.map((id) => ({ id }));
const wire = (...pairs) => pairs.map(([from, to]) => ({ from, to }));

/** A repeatable stream, so a failure can be looked at again. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

console.log('\nA loop is found wherever it is:');
{
  ok('a straight line is not a loop',
    !G.hasCycle(agents('a', 'b', 'c'), wire(['a', 'b'], ['b', 'c'])));
  // Two agents feeding a third is not a loop, however it looks on a drawing.
  ok('two feeding one is not a loop',
    !G.hasCycle(agents('a', 'b', 'c'), wire(['a', 'c'], ['b', 'c'])));
  ok('and one feeding two is not either',
    !G.hasCycle(agents('a', 'b', 'c'), wire(['a', 'b'], ['a', 'c'])));
  ok('a pair pointing at each other is', G.hasCycle(agents('a', 'b'), wire(['a', 'b'], ['b', 'a'])));
  ok('so is a longer ring',
    G.hasCycle(agents('a', 'b', 'c'), wire(['a', 'b'], ['b', 'c'], ['c', 'a'])));
  ok('and an agent feeding itself', G.hasCycle(agents('a'), wire(['a', 'a'])));
  // A blueprint can hold two unconnected groups, and a loop in the second one
  // must be found even though nothing reaches it from the first.
  ok('a loop in a second, unconnected group is still found',
    G.hasCycle(agents('a', 'b', 'x', 'y'), wire(['a', 'b'], ['x', 'y'], ['y', 'x'])));
  ok('nothing at all is not a loop', !G.hasCycle([], []) && !G.hasCycle(agents('a'), []));
}

console.log('\nBreaking a loop leaves the rest of the wiring alone:');
{
  const straight = wire(['a', 'b'], ['b', 'c']);
  ok('a graph with no loop is returned unchanged',
    G.breakCycles(agents('a', 'b', 'c'), straight).length === 2);
  const ring = wire(['a', 'b'], ['b', 'c'], ['c', 'a']);
  const opened = G.breakCycles(agents('a', 'b', 'c'), ring);
  ok('a ring loses exactly one connection', opened.length === 2);
  ok('and what is left has no loop', !G.hasCycle(agents('a', 'b', 'c'), opened));
  // A swarm missing one connection still does most of what was asked; a swarm
  // that will not start does nothing.
  ok('the rest of the work is still wired up', opened.length > 0);

  // An edge to an agent nobody defined cannot be run, and leaving it in hides
  // a loop that no walk from a real agent would ever reach.
  const dangling = G.breakCycles(agents('a', 'b'), wire(['a', 'b'], ['b', 'ghost'], ['ghost', 'a']));
  ok('a connection to an agent nobody defined is dropped',
    dangling.every((e) => e.to !== 'ghost' && e.from !== 'ghost'), JSON.stringify(dangling));
  ok('and what is left has no loop', !G.hasCycle(agents('a', 'b'), dangling));
}

// ── The property, over graphs nobody thought to write down ───────────────
console.log('\nWhatever the wiring, what comes back has no loop left in it:');
{
  const random = rng(20260827);
  let broken = 0;
  let hadCycle = 0;
  let lostEverything = 0;
  for (let round = 0; round < 3000; round++) {
    const count = 2 + Math.floor(random() * 7);
    const ids = Array.from({ length: count }, (_, i) => `n${i}`);
    const list = ids.map((id) => ({ id }));
    const edges = [];
    // Dense enough that most of these genuinely contain a loop.
    for (const from of ids) {
      for (const to of ids) {
        if (random() < 0.22) edges.push({ from, to });
      }
    }
    if (G.hasCycle(list, edges)) hadCycle++;
    const opened = G.breakCycles(list, edges);
    if (G.hasCycle(list, opened)) broken++;
    // Nothing may be invented: every connection that survives must be one
    // that was there.
    if (opened.some((e) => !edges.includes(e))) lostEverything++;
  }
  ok('three thousand random blueprints, none left with a loop', broken === 0, `${broken} still looped`);
  // If almost none of them had a loop, the check above proved nothing.
  ok('and most of them really did have one to break', hadCycle > 2000, `${hadCycle} of 3000`);
  ok('and nothing was invented that was not wired in the first place',
    lostEverything === 0, `${lostEverything} invented`);

  // The property that says a valid blueprint is never damaged. Built so that
  // every connection runs from a lower number to a higher one, which cannot
  // contain a loop — so nothing should be removed from any of them.
  //
  // Without this, breaking cycles by removing every edge would pass everything
  // above: no loops left, nothing invented, and a swarm that does nothing.
  let damaged = 0;
  let checked = 0;
  for (let round = 0; round < 2000; round++) {
    const count = 2 + Math.floor(random() * 7);
    const ids = Array.from({ length: count }, (_, i) => `n${i}`);
    const list = ids.map((id) => ({ id }));
    const edges = [];
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (random() < 0.4) edges.push({ from: ids[i], to: ids[j] });
      }
    }
    if (!edges.length) continue;
    checked++;
    if (G.breakCycles(list, edges).length !== edges.length) damaged++;
  }
  ok('and a blueprint that never looped keeps every connection it had',
    damaged === 0, `${damaged} of ${checked} damaged`);
}

console.log('\nAgents are laid out left to right, after whatever feeds them:');
{
  const columns = G.layers(agents('a', 'b', 'c'), wire(['a', 'b'], ['b', 'c']));
  ok('a chain is one agent per column', columns.length === 3);
  ok('and in order', columns.flat().join() === 'a,b,c');
  const fan = G.layers(agents('a', 'b', 'c'), wire(['a', 'b'], ['a', 'c']));
  ok('two fed by one share the next column', fan.length === 2 && fan[1].length === 2);
  const join = G.layers(agents('a', 'b', 'c'), wire(['a', 'c'], ['b', 'c']));
  ok('an agent waits for everything that feeds it',
    join.length === 2 && join[0].length === 2 && join[1].join() === 'c');
  ok('an agent wired to nothing still gets a place',
    G.layers(agents('a', 'lonely'), wire(['a', 'a'])).flat().includes('lonely'));

  // Nothing in a loop ever stops waiting, so none of it would be placed —
  // those agents would simply not appear on the drawing.
  const looped = G.layers(agents('a', 'b'), wire(['a', 'b'], ['b', 'a']));
  ok('agents caught in a loop are still shown rather than vanishing',
    looped.flat().sort().join() === 'a,b', JSON.stringify(looped));
  ok('nothing at all lays out as nothing', G.layers([], []).length === 0);
}

console.log('\nAnd given somewhere to sit:');
{
  const place = G.positions(agents('a', 'b', 'c'), wire(['a', 'b'], ['b', 'c']));
  ok('everything gets a position', Object.keys(place).length === 3);
  ok('each column is further right than the last', place.a.x < place.b.x && place.b.x < place.c.x);
  // A blueprint with one agent beside four should not read as the single one
  // having fallen to the top.
  const wide = G.positions(agents('a', 'b', 'c', 'd', 'e'), wire(['a', 'b'], ['a', 'c'], ['a', 'd'], ['a', 'e']));
  const column = ['b', 'c', 'd', 'e'].map((id) => wide[id].y);
  const middleOfColumn = (Math.min(...column) + Math.max(...column)) / 2;
  ok('a lone agent sits level with the middle of the column beside it',
    Math.abs(wide.a.y - middleOfColumn) < 1, `${wide.a.y} against ${middleOfColumn}`);
  ok('nothing is drawn off the top', Object.values(place).every((p) => p.y >= 24));
  ok('and nothing at all draws nothing', Object.keys(G.positions([], [])).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/graph.js)\n`);
process.exit(fail === 0 ? 0 : 1);
