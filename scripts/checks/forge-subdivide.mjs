// ==============================================================
// Forge subdivision checks
//
// Loads the REAL src/js/forge/subdivide.js into a Node VM and measures the
// meshes it produces, rather than asserting on the shape of the source.
//
// The measurements are chosen so that the failures this replaces would each
// have been caught by one of them:
//
//   • A split that gives every triangle its own corners raises the vertex
//     count to three per triangle, and the count here would not match V + E.
//   • A split that gives an edge two midpoints instead of one opens a crack
//     down every original edge. Nothing about the triangle list complains;
//     the Euler characteristic does, immediately.
//   • A split that drops texture coordinates leaves a part's lettering with
//     nowhere to sit, and the attribute count here would come back zero.
//   • A centre triangle wound the other way is invisible in shading and shows
//     up only as a wrong volume, so the volume is measured too.
//
// The fixture is built here, by hand, with per-face normals — the same shape a
// box arrives in — so nothing is derived from the code being checked.
//
// Run with: npm run check:forge-subdivide
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'subdivide.js'), 'utf8'), sandbox, { filename: 'subdivide.js' });
const S = sandbox.window.HCForgeSubdivide;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ── The fixture: a unit cube as loose triangles, per-face normals ────────
//
// Written out as six quads so the winding is plainly counter-clockwise seen
// from outside, which is what makes the signed volume come out positive.
function unitCube() {
  const h = 0.5;
  const faces = [
    { n: [0, 0, 1],  v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
    { n: [1, 0, 0],  v: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
    { n: [0, 1, 0],  v: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const corner = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      for (const c of [i, j, k]) {
        positions.push(...f.v[c]);
        normals.push(...f.n);
        uvs.push(...corner[c]);
      }
    }
  }
  return { positions, normals, uvs };
}

// ── Measurements, all taken from the mesh itself ─────────────────────────
const triangleCount = (m) => m.indices.length / 3;
const vertexCount = (m) => m.positions.length / 3;

// Topology is measured from POSITIONS, not from index numbers.
//
// A cube carries per-face normals, so its eight geometric corners are
// twenty-four vertices and no two faces share one. Counted by index the cube is
// six loose sheets and its Euler characteristic is six — a true statement about
// the buffer and a useless one about the object. Counted by where the corners
// actually are, it is the closed box a person would describe, and that is the
// thing a crack would show up in.
const at = (m, i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
const site = (m, i) => at(m, i).map((v) => Math.round(v / 1e-6)).join(',');

const corners = (m) => {
  const seen = new Set();
  for (let i = 0; i < vertexCount(m); i++) seen.add(site(m, i));
  return seen.size;
};

/** Every undirected edge of the SURFACE, and how many triangles use it. */
function edgeUse(m) {
  const use = new Map();
  for (let i = 0; i < m.indices.length; i += 3) {
    const t = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((v) => site(m, v));
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      use.set(key, (use.get(key) || 0) + 1);
    }
  }
  return use;
}

/** Every undirected edge of the BUFFER, by index — where a midpoint is made. */
function indexEdges(m) {
  const seen = new Set();
  for (let i = 0; i < m.indices.length; i += 3) {
    const t = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
      seen.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }
  return seen.size;
}

const euler = (m) => corners(m) - edgeUse(m).size + triangleCount(m);

/** Signed volume by the tetrahedron sum. Negative means wound inside out. */
function volume(m) {
  let sum = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const p = (k) => {
      const at = m.indices[i + k] * 3;
      return [m.positions[at], m.positions[at + 1], m.positions[at + 2]];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    sum += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return sum;
}

function bounds(m) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], m.positions[i + k]);
      hi[k] = Math.max(hi[k], m.positions[i + k]);
    }
  }
  return [lo, hi];
}

const cube = unitCube();

console.log('\nA triangle soup becomes a mesh without changing how it looks:');
{
  const w = S.weld(cube);
  ok('the loose corners are indexed', Array.isArray(w.indices) && w.indices.length === 36);
  // 24 and not 8: a cube corner belongs to three faces pointing three ways, and
  // merging them would round off an edge that is meant to be sharp.
  ok('a corner shared by faces that point differently stays separate', vertexCount(w) === 24);
  ok('no triangle was lost', triangleCount(w) === 12);
  ok('the normals came through', w.normals && w.normals.length === 24 * 3);
  ok('the texture coordinates came through', w.uvs && w.uvs.length === 24 * 2);
  ok('the box still measures one unit', near(bounds(w)[1][0] - bounds(w)[0][0], 1));
  ok('it is a closed box, counted where the corners are',
    corners(w) === 8 && euler(w) === 2);
  ok('and still holds one unit of volume', near(volume(w), 1, 1e-12));
}

console.log('\nOne level: four triangles for one, and one corner per edge:');
{
  const before = S.weld(cube);
  const beforeEdges = indexEdges(before);
  const after = S.splitOnce(before);
  ok('each triangle became four', triangleCount(after) === triangleCount(before) * 4);
  // The identity that fails the moment an edge is given two midpoints.
  ok('each edge yielded exactly one new corner',
    vertexCount(after) === vertexCount(before) + beforeEdges,
    `${vertexCount(after)} vertices, expected ${vertexCount(before) + beforeEdges}`);
  ok('every edge is still shared by exactly two triangles',
    [...edgeUse(after).values()].every((n) => n === 2));
  ok('the surface is still closed', euler(after) === 2 && euler(before) === 2);
  ok('nothing moved', near(bounds(after)[1][0] - bounds(after)[0][0], 1));
  // A linear split adds no volume. It also cannot lose any unless a triangle
  // came out wound the wrong way, which is the only way this number moves.
  ok('and the volume is unchanged', near(volume(after), volume(before), 1e-12));
  ok('the texture coordinates were carried, not dropped',
    after.uvs && after.uvs.length === vertexCount(after) * 2);
  ok('a midpoint sits halfway along its edge in texture space too',
    after.uvs.every((v) => v >= -1e-12 && v <= 1 + 1e-12));
  ok('the normals stay unit length', (() => {
    for (let i = 0; i < after.normals.length; i += 3) {
      const len = Math.hypot(after.normals[i], after.normals[i + 1], after.normals[i + 2]);
      if (!near(len, 1, 1e-9)) return false;
    }
    return true;
  })());
}

console.log('\nTwo levels compound, and the surface survives both:');
{
  const one = S.subdivide(cube, 1);
  const two = S.subdivide(cube, 2);
  ok('one level applies once', one.applied === 1);
  ok('two levels apply twice', two.applied === 2);
  ok('sixteen triangles for each original', triangleCount(two) === 12 * 16);
  ok('still closed', euler(two) === 2);
  ok('still the same box', near(volume(two), 1, 1e-12));
}

console.log('\nWhat it refuses, it refuses out loud:');
{
  ok('nothing asked for is nothing done', S.subdivide(cube, 0).applied === 0);
  ok('and it says so', S.subdivide(cube, 0).reason === 'none asked for');
  ok('a negative count is not a count', S.subdivide(cube, -3).applied === 0);
  ok('the ceiling holds at two levels', S.subdivide(cube, 9).applied === S.MAX_LEVELS);
  ok('an empty mesh comes back empty rather than thrown',
    S.subdivide({}, 1).applied === 0 && S.subdivide({}, 1).reason === 'no triangles');
}

console.log('\nThe ceiling is tested before every level, not only the first:');
{
  // Grown until one more level would carry it over the ceiling, so the first
  // level is allowed and the second is the one that must be refused.
  let near_limit = S.weld(cube);
  while (triangleCount(near_limit) * 4 <= S.MAX_TRIANGLES_IN) near_limit = S.splitOnce(near_limit);
  const out = S.subdivide(near_limit, 2);
  ok('the level it can afford is taken', out.applied === 1);
  ok('the one it cannot is not', triangleCount(out) === triangleCount(near_limit) * 4);
  ok('and it says where it stopped', /^stopped at \d+ triangles$/.test(out.reason));
  ok('what came out is still a closed box', euler(out) === 2 && near(volume(out), 1, 1e-12));
}

console.log('\nA mesh already too large is left whole, not half-split:');
{
  // Grown by splitting until it is over the ceiling, so the fixture is a real
  // mesh of that size rather than a fabricated array.
  let big = S.weld(cube);
  while (triangleCount(big) <= S.MAX_TRIANGLES_IN) big = S.splitOnce(big);
  const out = S.subdivide(big, 1);
  ok('it is not split', out.applied === 0);
  ok('it says the size it stopped at', /^stopped at \d+ triangles$/.test(out.reason));
  ok('and it comes back intact', triangleCount(out) === triangleCount(big) && euler(out) === 2);
}

console.log('\nA partial attribute is dropped rather than interpolated into nonsense:');
{
  const short = { positions: cube.positions, normals: cube.normals.slice(0, 9), uvs: cube.uvs };
  const out = S.subdivide(short, 1);
  ok('a normal array that does not cover every vertex is not used', out.normals === null);
  ok('the texture coordinates that do cover it still are',
    out.uvs && out.uvs.length === vertexCount(out) * 2);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/subdivide.js)\n`);
process.exit(fail === 0 ? 0 : 1);
