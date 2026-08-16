// ==============================================================
// Vector map checks
//
// Loads the REAL src/js/vector-map.js into a Node VM and runs it over vectors
// whose right answer is known before the code sees them.
//
// This is a layout, so a defect here does not throw — it draws a picture that
// looks plausible and says something untrue about the memory. Three ways that
// can happen, and all three are pinned below:
//
//   · The arrangement stops meaning anything. Facts that mean the same thing
//     must come out closer together than facts that do not. If the projection
//     silently degrades to noise, the map still looks like a map.
//
//   · The picture moves between openings. Power iteration seeded at random
//     redraws everything each time, so nobody can learn where anything is, and
//     no check can hold it to anything. The seed comes from the data instead,
//     and "twice gives the same answer" is checked directly.
//
//   · A link disappears because a similarity was judged against a cut-off.
//     bge-small scores unrelated text around 0.41, so any threshold either
//     admits everything or nothing. The band case below feeds vectors that are
//     ALL highly similar and requires every fact to still find its relatives.
//
// Run with: npm run check:vector-map
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'vector-map.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'vector-map.js' });
const V = sandbox.window.HCVectorMap;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── Synthetic vectors ────────────────────────────────────────────────────────
// A fixed generator, so the vectors are the same on every machine and every
// run. A check that uses Math.random can fail once a month and pass when you
// look into it.
const DIM = 384;
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function normalise(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 1e-12 ? v.map((x) => x / n) : v;
}
/** A vector near `axis`, jittered by `spread` — the shape real facts have. */
function near(axis, spread, rand) {
  const v = new Array(DIM).fill(0);
  v[axis] = 1;
  for (let i = 0; i < DIM; i++) v[i] += (rand() - 0.5) * spread;
  return normalise(v);
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// Three groups of three, each group clustered around its own axis.
const rand = lcg(7);
const THREE_GROUPS = [
  near(0, 0.05, rand), near(0, 0.05, rand), near(0, 0.05, rand),
  near(1, 0.05, rand), near(1, 0.05, rand), near(1, 0.05, rand),
  near(2, 0.05, rand), near(2, 0.05, rand), near(2, 0.05, rand),
];
const groupOf = (i) => Math.floor(i / 3);

console.log('\nThe arrangement carries meaning:');
{
  const { points, degenerate, kept } = V.project(THREE_GROUPS);
  ok('every fact gets a point', points.length === THREE_GROUPS.length);
  ok('the points are finite', points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  ok('vectors with real spread are not called degenerate', degenerate === false);

  // The property the whole map rests on: closer in meaning, closer on screen.
  let worstWithin = 0;
  let bestAcross = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist(points[i], points[j]);
      if (groupOf(i) === groupOf(j)) worstWithin = Math.max(worstWithin, d);
      else bestAcross = Math.min(bestAcross, d);
    }
  }
  ok('facts that mean the same thing land closer than facts that do not',
    worstWithin < bestAcross,
    `furthest pair inside a group ${worstWithin.toFixed(3)}, closest pair across groups ${bestAcross.toFixed(3)}`);

  // Three tight groups differ along two directions, so a flat picture keeps
  // nearly all of it. This is the number the map reports to the user, so it has
  // to be a real measurement and not a decoration.
  ok('it reports how much of the spread the flat picture keeps',
    kept > 0.8 && kept <= 1, `kept ${kept.toFixed(3)}`);
  ok('the scale is normalised to the widest axis',
    Math.max(...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) === 1);
}

console.log('\nThe same facts always draw the same map:');
{
  const a = V.project(THREE_GROUPS);
  const b = V.project(THREE_GROUPS);
  ok('two runs agree exactly', JSON.stringify(a) === JSON.stringify(b));
  // Order is the one thing a caller cannot promise: the store sorts by time, so
  // adding a fact renumbers everything. The SHAPE must survive that — distances
  // between the same two facts, not their coordinates.
  const order = [8, 3, 5, 0, 7, 1, 6, 2, 4];
  const shuffled = V.project(order.map((i) => THREE_GROUPS[i]));
  const before = dist(a.points[0], a.points[1]);
  const after = dist(shuffled.points[order.indexOf(0)], shuffled.points[order.indexOf(1)]);
  ok('reordering the facts does not change how far apart two of them sit',
    Math.abs(before - after) < 1e-6, `${before.toFixed(6)} vs ${after.toFixed(6)}`);
}

console.log('\nNothing draws a map it cannot draw:');
{
  ok('no facts', JSON.stringify(V.project([])) === JSON.stringify({ points: [], kept: 0, degenerate: true }));
  const one = V.project([near(0, 0.05, lcg(1))]);
  ok('one fact sits at the centre and is called degenerate',
    one.degenerate === true && one.points.length === 1 && one.points[0].x === 0 && one.points[0].y === 0);

  // Facts that mean the identical thing have no directions to project onto.
  // Stacking them all at one point would read as a single fact, so they go on a
  // ring — and `degenerate` is what tells the UI not to claim the positions
  // mean anything.
  const same = normalise(new Array(DIM).fill(0).map((_, i) => (i === 5 ? 1 : 0)));
  const identical = V.project([same, same, same, same]);
  ok('identical facts are laid out separately and flagged degenerate',
    identical.degenerate === true &&
    identical.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
    new Set(identical.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size === 4);
  ok('a degenerate layout keeps nothing, and says so', identical.kept === 0);

  // A vector from an older build of the model is a different width. Comparing
  // across two spaces produces confident nonsense, so it is refused rather than
  // mixed in.
  const mixed = V.project([near(0, 0.05, lcg(2)), new Array(8).fill(0.1)]);
  ok('vectors of different widths are refused, not mixed', mixed.degenerate === true);
  ok('a vector holding a non-number is refused',
    V.project([near(0, 0.05, lcg(3)), new Array(DIM).fill(NaN)]).degenerate === true);
  ok('two facts are allowed, on a line', V.project([near(0, 0.05, lcg(4)), near(1, 0.05, lcg(5))]).points.length === 2);
}

console.log('\nLinks are a ranking, never a cut-off:');
{
  const edges = V.neighbourLinks(THREE_GROUPS, { perNode: 2 });
  ok('every fact reaches somebody', new Set(edges.flatMap((e) => [e.a, e.b])).size === THREE_GROUPS.length);
  ok('a pair is listed once', new Set(edges.map((e) => `${e.a}-${e.b}`)).size === edges.length);
  ok('an edge always runs from the lower index to the higher', edges.every((e) => e.a < e.b));
  ok('each edge carries the similarity to show', edges.every((e) => Number.isFinite(e.sim)));
  ok('inside a tight group, the links stay inside it',
    edges.filter((e) => e.mutual).every((e) => groupOf(e.a) === groupOf(e.b)));

  // THE REGRESSION THIS FILE EXISTS FOR. Every pair here scores above 0.9 —
  // the compressed band the real model produces. A threshold anywhere in the
  // usual range would either keep every link or drop the lot; a ranking still
  // finds each fact's nearest relatives.
  const band = lcg(11);
  const CLOSE = [0, 1, 2, 3, 4, 5].map((i) => near(0, 0.02 + i * 0.003, band));
  const sims = [];
  for (let i = 0; i < CLOSE.length; i++) {
    for (let j = i + 1; j < CLOSE.length; j++) sims.push(V.dot(CLOSE[i], CLOSE[j]));
  }
  ok('the band case really is all-similar', Math.min(...sims) > 0.9, `lowest pair ${Math.min(...sims).toFixed(3)}`);
  const bandEdges = V.neighbourLinks(CLOSE, { perNode: 2 });
  ok('every fact still finds relatives when everything is similar',
    new Set(bandEdges.flatMap((e) => [e.a, e.b])).size === CLOSE.length);

  // And the same in the other direction: nothing is dropped for scoring low.
  const apart = [0, 1, 2, 3].map((axis) => near(axis, 0.01, lcg(20 + axis)));
  const apartEdges = V.neighbourLinks(apart, { perNode: 1 });
  ok('nothing is dropped for scoring low either',
    new Set(apartEdges.flatMap((e) => [e.a, e.b])).size === apart.length,
    `similarities around ${V.dot(apart[0], apart[1]).toFixed(3)}`);

  ok('one fact has no links', V.neighbourLinks([near(0, 0.05, lcg(6))], { perNode: 2 }).length === 0);
  ok('no vectors, no links', V.neighbourLinks([], { perNode: 2 }).length === 0);
  const twice = JSON.stringify(V.neighbourLinks(THREE_GROUPS, { perNode: 3 }));
  ok('two runs give the same links', twice === JSON.stringify(V.neighbourLinks(THREE_GROUPS, { perNode: 3 })));
}

console.log('\nGroups come from the pairs that chose each other:');
{
  const edges = V.neighbourLinks(THREE_GROUPS, { perNode: 2 });
  const groups = V.groupsFromLinks(THREE_GROUPS.length, edges);
  ok('a group index per fact', groups.length === THREE_GROUPS.length);
  ok('the three clusters come out as three groups', new Set(groups).size === 3, `got ${new Set(groups).size}`);
  ok('facts in the same cluster share a group',
    [0, 3, 6].every((start) => groups[start] === groups[start + 1] && groups[start] === groups[start + 2]));
  ok('groups are numbered from zero by first appearance', groups[0] === 0 && Math.max(...groups) === 2);

  // A one-sided link is what every fact has — something is always nearest to
  // it, however unrelated. Joining on those puts the whole memory in one blob.
  const oneSided = V.groupsFromLinks(2, [{ a: 0, b: 1, sim: 0.99, mutual: false }]);
  ok('a one-sided link does not join a group', oneSided[0] !== oneSided[1]);
  ok('a mutual link does', (() => {
    const g = V.groupsFromLinks(2, [{ a: 0, b: 1, sim: 0.99, mutual: true }]);
    return g[0] === g[1];
  })());
  ok('an edge naming a fact that is not there is ignored',
    V.groupsFromLinks(2, [{ a: 0, b: 9, mutual: true }]).length === 2);
  ok('no facts, no groups', V.groupsFromLinks(0, []).length === 0);
}

console.log('\nA group is named after what is in it:');
{
  ok('the stem most keys share wins', V.groupLabel(['cat_name', 'cat_age', 'dog_name']) === 'cat');
  ok('a key with no underscore counts as its own stem', V.groupLabel(['education', 'education_year']) === 'education');
  ok('a tie goes to the alphabetically first, not to insertion order',
    V.groupLabel(['work_role', 'home_city']) === V.groupLabel(['home_city', 'work_role']));
  ok('spaces and dashes separate a stem too', V.groupLabel(['favourite food', 'favourite-drink']) === 'favourite');
  ok('case does not matter', V.groupLabel(['CAT_NAME', 'cat_age']) === 'cat');
  ok('nothing to name', V.groupLabel([]) === '' && V.groupLabel(['', null]) === '');
  ok('punctuation alone is not a name', V.groupLabel(['___', '...']) === '');
}

console.log('\nLabels stop overlapping without losing the arrangement:');
{
  const sizes = new Array(4).fill({ w: 100, h: 40 });
  const stacked = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 10 }, { x: 5, y: 12 }];
  const out = V.spread(stacked, sizes, { iterations: 200, gap: 6 });
  let collisions = 0;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (Math.abs(out[i].x - out[j].x) < 100 && Math.abs(out[i].y - out[j].y) < 40) collisions++;
    }
  }
  ok('boxes piled on each other end up apart', collisions === 0, `${collisions} still overlapping`);
  ok('it does not move anything that was already clear', (() => {
    const clear = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
    const kept = V.spread(clear, [{ w: 100, h: 40 }, { w: 100, h: 40 }], { iterations: 50 });
    return JSON.stringify(kept) === JSON.stringify(clear);
  })());
  ok('two runs agree', JSON.stringify(out) === JSON.stringify(V.spread(stacked, sizes, { iterations: 200, gap: 6 })));
  ok('the input is not modified', stacked[0].x === 0 && stacked[0].y === 0);
  ok('points exactly on top of each other are still separated', (() => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    const s = V.spread(same, [{ w: 80, h: 30 }, { w: 80, h: 30 }], { iterations: 100 });
    return Math.abs(s[0].x - s[1].x) >= 80 || Math.abs(s[0].y - s[1].y) >= 30;
  })());
  ok('no sizes given is safe', V.spread([{ x: 1, y: 1 }], [], { iterations: 5 }).length === 1);
}

console.log('\nFitting to the window does not stretch the picture:');
{
  const square = [{ x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }];
  const fitted = V.toBox(square, { width: 1200, height: 800, pad: 100 });
  ok('the picture is centred on the box',
    Math.abs(fitted.reduce((s, p) => s + p.x, 0) / 4 - 600) < 1e-9 &&
    Math.abs(fitted.reduce((s, p) => s + p.y, 0) / 4 - 400) < 1e-9);
  ok('both axes are scaled by the same amount, so distances still mean something',
    Math.abs((fitted[1].x - fitted[0].x) - (fitted[1].y - fitted[0].y)) < 1e-9);
  ok('it stays inside the box',
    fitted.every((p) => p.x >= 0 && p.x <= 1200 && p.y >= 0 && p.y <= 800));
  ok('the padding is respected on the short axis',
    Math.min(...fitted.map((p) => p.y)) >= 100 - 1e-9);
  ok('a single point lands in the middle', (() => {
    const [p] = V.toBox([{ x: 0, y: 0 }], { width: 1200, height: 800, pad: 100 });
    return p.x === 600 && p.y === 400;
  })());
  ok('no points, no coordinates', V.toBox([], { width: 1200, height: 800 }).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/vector-map.js)`);
process.exit(fail ? 1 : 0);
