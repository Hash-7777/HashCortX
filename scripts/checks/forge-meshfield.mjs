// ==============================================================
// Forge mesh distance field — checks
//
// Loads the REAL src/js/forge/meshfield.js into a Node VM and asks it about
// meshes whose true answer is arithmetic a person can do: a tessellated sphere,
// where the distance from any point is its length minus the radius, and a cube,
// where it is the box formula every other shape in this app already uses.
//
// That is the whole point. A distance field cannot be checked against itself —
// it has to be checked against a shape we already know the answer for, at
// points chosen without reference to how it works.
//
// The sign is checked separately and harder than the distance, because the sign
// is what goes subtly wrong: using the nearest face's own normal looks right in
// the middle of every face and is wrong at every edge and corner.
//
// Run with: npm run check:forge-meshfield
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const rel of [
  ['src', 'js', 'forge', 'meshfield.js'],
  ['src', 'js', 'model-plan.js'],
  ['src', 'js', 'forge', 'field.js'],
  ['src', 'js', 'forge', 'surface.js'],
]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel.at(-1) });
}
const F = sandbox.window.HCForgeMeshField;
const Field = sandbox.window.HCForgeField;
const Surface = sandbox.window.HCForgeSurface;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A repeatable stream of numbers, so a failure can be looked at again. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Fixtures, built here rather than by anything being checked ───────────
function sphereMesh(radius, rings, segments) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      positions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const at = (i, j) => i * (segments + 1) + j;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      // Wound INWARDS, as it happens — which is exactly what a real export
      // sometimes does, and is why the field measures its own volume rather
      // than trusting the winding it was handed.
      indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
      indices.push(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
    }
  }
  return { positions, indices };
}

function cubeMesh(half) {
  const h = half;
  const c = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const f = [
    [4, 5, 6], [4, 6, 7], [1, 0, 3], [1, 3, 2],
    [5, 1, 2], [5, 2, 6], [0, 4, 7], [0, 7, 3],
    [7, 6, 2], [7, 2, 3], [0, 1, 5], [0, 5, 4],
  ];
  return { positions: c.flat(), indices: f.flat() };
}

/** The truth for a box, which is the formula every other shape here uses. */
function boxDistance(h, x, y, z) {
  const q = [Math.abs(x) - h, Math.abs(y) - h, Math.abs(z) - h];
  const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
  return Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0) + outside;
}

console.log('\nThe fast inner loop computes what the readable one does:');
{
  // The distance search runs a version written to avoid allocating, and the
  // readable statement of the same arithmetic sits beside it. Two ways of
  // saying one thing is two ways for one of them to be wrong.
  const random = rng(424242);
  let worstPoint = 0;
  let featureMismatch = 0;
  for (let i = 0; i < 3000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 4);
    const tri = [0, 1, 2].map(() => [0, 1, 2].map(() => (random() - 0.5) * 2));
    const readable = F.closestOnTriangle(p, tri[0], tri[1], tri[2]);
    const out = { x: 0, y: 0, z: 0, feature: 6 };
    const squared = F.closestSquaredInto(p[0], p[1], p[2], ...tri[0], ...tri[1], ...tri[2], out);
    worstPoint = Math.max(worstPoint,
      Math.hypot(out.x - readable.point[0], out.y - readable.point[1], out.z - readable.point[2]));
    if (out.feature !== readable.feature) featureMismatch++;
    const truth = Math.hypot(p[0] - readable.point[0], p[1] - readable.point[1], p[2] - readable.point[2]);
    worstPoint = Math.max(worstPoint, Math.abs(Math.sqrt(squared) - truth));
  }
  ok('they find the same point', worstPoint < 1e-12, `worst ${worstPoint}`);
  // The feature is what decides the sign later, so a disagreement here would
  // be invisible in the distance and wrong at every edge.
  ok('and agree about which part of the triangle it sits on', featureMismatch === 0, `${featureMismatch} differed`);
}

console.log('\nA mesh has to be closed and small enough to be worth it:');
{
  const built = F.build(sphereMesh(1, 12, 16));
  ok('a closed mesh is recognised as closed', built.closed === true);
  ok('and this one happens to be wound inwards, which is noticed', built.inverted === true);
  // A sphere drawn as rings of quads has a row of zero-area triangles at each
  // pole. They are not part of the surface and are dropped before anything
  // else — left in, they contribute no direction to a pseudonormal while still
  // being able to be the nearest thing to a sample.
  ok('the sphere really does arrive with zero-area triangles at its poles', built.dropped === 2 * 16);
  ok('and reports the triangles that were left', built.triangles === 12 * 16 * 2 - 2 * 16);
  ok('and how big it is', built.bounds[1][1] > 0.99 && built.bounds[0][1] < -0.99);
  ok('nothing usable comes back as nothing', F.build({ positions: [] }) === null);
  ok('a mesh past the ceiling is refused rather than built',
    F.build({ positions: new Array((F.MAX_TRIANGLES + 1) * 9).fill(0) }) === null);

  // Inside and outside mean nothing for a surface with a hole in it, and this
  // must say so rather than answer confidently.
  const open = cubeMesh(0.5);
  open.indices = open.indices.slice(0, open.indices.length - 6);
  ok('a surface with a hole in it is not called closed', F.build(open).closed === false);
}

console.log('\nA sphere answers what a sphere answers:');
{
  const radius = 0.7;
  const built = F.build(sphereMesh(radius, 40, 60));
  const random = rng(20260824);
  let worst = 0;
  let worstAt = null;
  for (let i = 0; i < 4000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 3);
    const truth = Math.hypot(p[0], p[1], p[2]) - radius;
    const got = built.distance(p[0], p[1], p[2]);
    const error = Math.abs(got - truth);
    if (error > worst) { worst = error; worstAt = p; }
  }
  // A flat-sided sphere sits slightly inside the round one it stands for, so
  // some error is the tessellation and not the field. At this density the gap
  // between the two is under a thousandth of the radius.
  ok('every point measured agrees with the sphere it stands for',
    worst < 0.002, `worst ${worst.toFixed(5)} at ${worstAt}`);

  ok('the centre is a whole radius inside', Math.abs(built.distance(0, 0, 0) + radius) < 0.002);
  ok('a point on the surface is at nothing', Math.abs(built.distance(0, radius, 0)) < 0.002);
  ok('and the sign is negative inside, positive outside',
    built.distance(0, 0, 0) < 0 && built.distance(0, 2, 0) > 0);
}

console.log('\nA cube answers what a box answers, corners and all:');
{
  const half = 0.5;
  const built = F.build(cubeMesh(half));
  const random = rng(7777);
  let worst = 0;
  let worstAt = null;
  for (let i = 0; i < 4000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 3);
    const error = Math.abs(built.distance(p[0], p[1], p[2]) - boxDistance(half, ...p));
    if (error > worst) { worst = error; worstAt = p; }
  }
  // A cube IS flat-sided, so there is no tessellation error to allow for. This
  // is exact or it is wrong.
  ok('every point measured agrees with the box formula exactly',
    worst < 1e-9, `worst ${worst} at ${worstAt}`);
}

console.log('\nThe sign is right where it is easiest to get wrong:');
{
  const half = 0.5;
  const built = F.build(cubeMesh(half));
  // Just inside a CORNER, where three faces are equally close. Taking the
  // nearest face's own normal picks one of the three and calls this outside.
  const e = 1e-4;
  ok('just inside a corner is inside', built.distance(half - e, half - e, half - e) < 0);
  ok('just outside a corner is outside', built.distance(half + e, half + e, half + e) > 0);
  // Just inside an EDGE, where two faces are equally close.
  ok('just inside an edge is inside', built.distance(half - e, half - e, 0) < 0);
  ok('just outside an edge is outside', built.distance(half + e, half + e, 0) > 0);
  // And the ordinary case, so the hard cases are not passing by accident.
  ok('just inside a face is inside', built.distance(0, 0, half - e) < 0);
  ok('just outside a face is outside', built.distance(0, 0, half + e) > 0);

  // Every one of the eight corners and twelve edge midpoints, nudged in and
  // out. One wrong sign anywhere here is a hole in a printed part.
  let wrong = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    if (built.distance(sx * (half - e), sy * (half - e), sz * (half - e)) >= 0) wrong++;
    if (built.distance(sx * (half + e), sy * (half + e), sz * (half + e)) <= 0) wrong++;
  }
  ok('all eight corners agree, in and out', wrong === 0, `${wrong} wrong`);

  let edgesWrong = 0;
  for (const axis of [0, 1, 2]) {
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      const inside = [0, 0, 0];
      const outside = [0, 0, 0];
      const others = [0, 1, 2].filter((k) => k !== axis);
      inside[others[0]] = s1 * (half - e); inside[others[1]] = s2 * (half - e);
      outside[others[0]] = s1 * (half + e); outside[others[1]] = s2 * (half + e);
      if (built.distance(...inside) >= 0) edgesWrong++;
      if (built.distance(...outside) <= 0) edgesWrong++;
    }
  }
  ok('all twelve edges agree, in and out', edgesWrong === 0, `${edgesWrong} wrong`);
}

console.log('\nA mesh whose corners are split per face still knows itself:');
{
  // Most meshes arrive like this, so that hard edges can be shaded. Without
  // gathering the faces that MEET at a point, every face believes it stands
  // alone at that corner and the sign goes wrong at all of them.
  const welded = cubeMesh(0.5);
  const loose = { positions: [], indices: [] };
  for (let i = 0; i < welded.indices.length; i++) {
    const v = welded.indices[i];
    loose.positions.push(welded.positions[v * 3], welded.positions[v * 3 + 1], welded.positions[v * 3 + 2]);
    loose.indices.push(i);
  }
  const built = F.build(loose);
  ok('the loose copy has three times the corners', loose.positions.length / 3 === 36);
  ok('and is still recognised as closed', built.closed === true);
  const e = 1e-4;
  ok('and its corners still read as inside', built.distance(0.5 - e, 0.5 - e, 0.5 - e) < 0);
  ok('and its edges too', built.distance(0.5 - e, 0.5 - e, 0) < 0);

  const random = rng(31415);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 3);
    worst = Math.max(worst, Math.abs(built.distance(...p) - boxDistance(0.5, ...p)));
  }
  ok('and it measures the same as the welded one', worst < 1e-9, `worst ${worst}`);
}

console.log('\nA mesh wound the wrong way is put right rather than answered backwards:');
{
  // Nothing about the topology says which way round a mesh is — a closed mesh
  // wound inwards is still perfectly closed. Only the enclosed volume does,
  // and a mesh answered backwards would have a fuse cut where it should add.
  const outward = cubeMesh(0.5);
  const inward = { positions: outward.positions.slice(), indices: [] };
  for (let i = 0; i < outward.indices.length; i += 3) {
    inward.indices.push(outward.indices[i], outward.indices[i + 2], outward.indices[i + 1]);
  }
  const a = F.build(outward);
  const b = F.build(inward);
  ok('the ordinary one is not called inside out', a.inverted === false);
  ok('the reversed one is', b.inverted === true);
  ok('both are closed, because winding is not what closed means', a.closed && b.closed);
  ok('and both enclose the same volume', Math.abs(a.volume - b.volume) < 1e-9 && Math.abs(a.volume - 1) < 1e-9);

  const random = rng(2718);
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 3);
    worst = Math.max(worst, Math.abs(b.distance(...p) - boxDistance(0.5, ...p)));
  }
  ok('so the reversed one measures exactly like the ordinary one', worst < 1e-9, `worst ${worst}`);
  ok('and its inside still reads as inside', b.distance(0, 0, 0) < 0);
}

console.log('\nA cell that cannot hold anything nearer is skipped whole:');
{
  // This is the difference between a mesh fusing in three seconds and in
  // seven. Without it a sample tested every triangle in every cell the search
  // reached — eight hundred of them on a mesh of thirty thousand — when a
  // handful of cells could hold anything nearer. The saving is only worth
  // having if the answer is unchanged, so that is what is checked.
  const built = F.build(sphereMesh(0.5, 24, 36));
  const random = rng(1234567);
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const p = [0, 1, 2].map(() => (random() - 0.5) * 4);
    const truth = Math.hypot(...p) - 0.5;
    worst = Math.max(worst, Math.abs(built.distance(...p) - truth));
  }
  ok('a skipped cell never changes an answer', worst < 0.004, `worst ${worst.toFixed(5)}`);
  // Points far outside are where a search can most easily stop too early.
  ok('and a point well outside is still measured exactly',
    Math.abs(built.distance(0, 9, 0) - 8.5) < 0.004);
  ok('as is one well inside', Math.abs(built.distance(0, 0, 0) + 0.5) < 0.004);
}

console.log('\nA mesh it cannot measure says which of the reasons it was:');
{
  ok('nothing there is said as nothing there', /holds no triangles/.test(F.whyNot({ positions: [] })));
  ok('too many is said with the numbers',
    /past the 60,000 this can measure/.test(F.whyNot({ positions: new Array((F.MAX_TRIANGLES + 1) * 9).fill(0) })));
  ok('and a mesh it can measure gives no reason at all',
    F.whyNot(cubeMesh(0.5)) === null);
}

console.log('\nThe grid finds the nearest triangle, not merely a near one:');
{
  // A long thin mesh makes the buckets very uneven, which is where a search
  // that stops at the first non-empty ring gives a plausible wrong answer.
  const built = F.build(cubeMesh(0.5));
  const stretched = F.build({
    positions: cubeMesh(0.5).positions.map((v, i) => (i % 3 === 0 ? v * 20 : v)),
    indices: cubeMesh(0.5).indices,
  });
  ok('a long thin box still measures like a box',
    Math.abs(stretched.distance(0, 0, 3) - 2.5) < 1e-9, `${stretched.distance(0, 0, 3)}`);
  ok('and from far along its length',
    Math.abs(stretched.distance(30, 0, 0) - 20) < 1e-9, `${stretched.distance(30, 0, 0)}`);
  ok('a point far outside is still measured, not lost',
    Math.abs(built.distance(0, 50, 0) - 49.5) < 1e-9);
}

// ── The whole point: what the fuse now makes of a mesh part ──────────────
console.log('\nA mesh part fuses to its own shape rather than to a crate:');
{
  const radius = 0.5;
  const mesh = sphereMesh(radius, 32, 48);
  const part = {
    id: 'imported', name: 'imported', type: 'mesh', role: 'structure',
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    params: { positions: mesh.positions, indices: mesh.indices },
  };
  const { parts } = sandbox.window.HCModelPlan.normaliseParts([part]);
  const field = Field.buildField(parts);
  ok('the field was built without calling it an approximation',
    !field.issues.some((i) => i.code === 'mesh-approximated'),
    JSON.stringify(field.issues));
  // The fixture is wound inwards, which the field notices and corrects — and
  // says so, because a person should know their import was inside out.
  ok('and it says the import was inside out and has been turned round',
    field.issues.some((i) => i.code === 'mesh-inverted'));

  // The distance itself, before anything is walked: half a radius in at the
  // centre, and exactly a tenth of a unit out at six tenths from it.
  ok('the field answers a sphere at the centre', Math.abs(field.evaluate(0, 0, 0) + radius) < 0.005);
  ok('and outside it', Math.abs(field.evaluate(0.6, 0, 0) - 0.1) < 0.005);

  const built = Surface.extract(field, {});
  // Measured from the surface that came out, by the tetrahedron sum.
  let volume = 0;
  for (let i = 0; i < built.indices.length; i += 3) {
    const p = (k) => {
      const at3 = built.indices[i + k] * 3;
      return [built.positions[at3], built.positions[at3 + 1], built.positions[at3 + 2]];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    volume += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  volume = Math.abs(volume);
  const sphere = (4 / 3) * Math.PI * radius ** 3;
  const crate = (2 * radius) ** 3;
  // A sphere holds a little over half of the crate it fits inside. That gap is
  // the entire difference between answering a mesh and shrugging at it, and it
  // is far too large for any tolerance to hide.
  ok("what came out holds a sphere's volume, not a box's",
    Math.abs(volume - sphere) / sphere < 0.05,
    `${volume.toFixed(4)} against a sphere at ${sphere.toFixed(4)} and a crate at ${crate.toFixed(4)}`);
  ok('and is nowhere near the box it used to be',
    Math.abs(volume - crate) / crate > 0.3);
  ok('it is one closed body', built.stats.openEdges === 0 && built.stats.foldedEdges === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/meshfield.js)\n`);
process.exit(fail === 0 ? 0 : 1);
