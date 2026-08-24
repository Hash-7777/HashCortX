// ==============================================================
// Forge surface checks
//
// Loads the REAL model-plan.js, field.js and surface.js into a Node VM and
// walks actual fields.
//
// The claim being made downstream of this file is that a Forge model is one
// watertight solid. That claim is worth exactly as much as it is measured, so
// nothing here trusts the method: every mesh produced is counted edge by edge,
// and its volume is compared against the volume the shape is known to have.
//
// A surface extracted from a field is also the kind of thing that can be
// plausible and wrong — smooth where it should be sharp, inside out, or a
// perfectly closed shape of the wrong size. Each of those has a rule here.
//
// Run with: npm run check:forge-surface
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'model-plan.js'], ['src', 'js', 'forge', 'field.js'], ['src', 'js', 'forge', 'surface.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel[rel.length - 1] });
}
const F = sandbox.window.HCForgeField;
const S = sandbox.window.HCForgeSurface;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const within = (a, b, fraction) => Math.abs(a - b) <= Math.abs(b) * fraction;

const part = (type, params, extra = {}) => ({
  id: extra.id || type, name: type, type, role: 'structure', op: 'union',
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params, ...extra,
});
const solidOf = (parts, opts) => {
  const mesh = S.extract(F.buildField(parts), opts);
  return { mesh, info: S.inspect(mesh) };
};

console.log('\nWhatever comes out is closed, and counted rather than claimed:');
{
  const { mesh, info } = solidOf([part('sphere', { radius: 1 })], { resolution: 40 });
  ok('a ball produces a surface', info.triangles > 500, `${info.triangles} triangles`);
  ok('every edge is shared by exactly two triangles', info.closed,
    `${info.boundaryEdges} open, ${info.nonManifoldEdges} folded`);
  ok('no edge is left open', info.boundaryEdges === 0);
  ok('and none is shared by three', info.nonManifoldEdges === 0);
  // Wound inside out, a mesh is the right shape with the wrong sign, and only
  // a slicer ever notices.
  ok('it faces outwards', info.volume > 0, `volume ${info.volume.toFixed(3)}`);
  ok('and it is the size the shape is', within(info.volume, (4 / 3) * Math.PI, 0.05),
    `${info.volume.toFixed(3)} against ${((4 / 3) * Math.PI).toFixed(3)}`);
  ok('the vertices are real numbers', mesh.positions.every(Number.isFinite));
  ok('every index points at a vertex',
    mesh.indices.every((i) => i >= 0 && i < mesh.positions.length / 3));
  ok('and nothing at the grid boundary was left hanging',
    !mesh.issues.some((i) => i.code === 'open-edge'));
}

console.log('\nA corner is a corner:');
{
  // A box is the case that separates this from the simple version of the same
  // method, which averages the crossings and rounds every corner off.
  const { mesh, info } = solidOf([part('box', { width: 2, height: 2, depth: 2 })], { resolution: 32 });
  ok('a box is closed', info.closed);
  ok('and holds its volume', within(info.volume, 8, 0.05), `${info.volume.toFixed(3)} against 8`);

  let sharpest = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const d = Math.min(
      Math.hypot(mesh.positions[i] - 1, mesh.positions[i + 1] - 1, mesh.positions[i + 2] - 1),
      Math.hypot(mesh.positions[i] + 1, mesh.positions[i + 1] + 1, mesh.positions[i + 2] + 1),
    );
    if (i === 0 || d < sharpest) sharpest = d;
  }
  // Averaging the crossings leaves the nearest vertex about half a cell from
  // the true corner. Pulling it onto the planes puts it on the corner.
  ok('a vertex lands on the corner rather than near it', sharpest < 0.02,
    `nearest vertex was ${sharpest.toFixed(4)} from it`);

  let flat = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.abs(mesh.positions[i] - 1) < 1e-3) flat++;
  }
  ok('and a flat face stays flat', flat > 30, `${flat} vertices exactly on the face`);
}

console.log('\nThe hole is a hole:');
{
  const body = part('cylinder', { radius: 1, height: 2 }, { id: 'body' });
  const bore = part('cylinder', { radius: 0.5, height: 3 }, { id: 'bore', op: 'subtract' });

  const solid = solidOf([body], { resolution: 40 });
  ok('a plain cylinder holds its volume', within(solid.info.volume, Math.PI * 1 * 2, 0.05),
    `${solid.info.volume.toFixed(3)} against ${(Math.PI * 2).toFixed(3)}`);

  const drilled = solidOf([body, bore], { resolution: 40 });
  ok('drilling it still produces a closed surface', drilled.info.closed,
    `${drilled.info.boundaryEdges} open, ${drilled.info.nonManifoldEdges} folded`);
  // The whole point: pi r squared h, less the bore.
  const expected = Math.PI * 2 * (1 * 1 - 0.5 * 0.5);
  ok('and the bore is actually missing from it', within(drilled.info.volume, expected, 0.06),
    `${drilled.info.volume.toFixed(3)} against ${expected.toFixed(3)}`);
  ok('which is less material than before', drilled.info.volume < solid.info.volume);
  ok('it still faces outwards', drilled.info.volume > 0);

  // A ring has a hole through it, so it is not a ball with dents — the surface
  // genuinely has to close around the bore, and Euler says so.
  const V = drilled.mesh.positions.length / 3;
  const E = drilled.info.triangles * 3 / 2;
  const Ch = V - E + drilled.info.triangles;
  ok('and the surface really does have a hole through it', Ch === 0,
    `V-E+F came to ${Ch}, which is ${Ch === 2 ? 'a shape with no hole' : 'not a single ring'}`);
}

console.log('\nTaking away can also take away nothing at all:');
{
  const body = part('box', { width: 2, height: 2, depth: 2 }, { id: 'body' });
  const away = part('sphere', { radius: 0.5 }, { id: 'far', op: 'subtract', position: [9, 0, 0] });
  const { info } = solidOf([body, away], { resolution: 24 });
  ok('a cut that misses leaves the object alone', within(info.volume, 8, 0.06),
    `${info.volume.toFixed(3)} against 8`);
  ok('and the result is still closed', info.closed);

  const inter = solidOf([body, part('sphere', { radius: 1.2 }, { id: 'ball', op: 'intersect' })], { resolution: 40 });
  ok('an intersection keeps only the shared material', inter.info.volume < 8 && inter.info.volume > 4,
    `${inter.info.volume.toFixed(3)}`);
  ok('and is closed too', inter.info.closed);
}

console.log('\nTwo parts become one skin, not two:');
{
  // Overlapping shells are what a Forge model has always been. One field over
  // both of them has one surface, and its volume is the union rather than the
  // sum — which is the measurable difference between one object and two.
  const a = part('sphere', { radius: 1 }, { id: 'a', position: [-0.5, 0, 0] });
  const b = part('sphere', { radius: 1 }, { id: 'b', position: [0.5, 0, 0] });
  const { info } = solidOf([a, b], { resolution: 48 });
  const oneBall = (4 / 3) * Math.PI;
  ok('two overlapping balls make one closed skin', info.closed);
  ok('and the overlap is counted once, not twice',
    info.volume < oneBall * 2 * 0.92 && info.volume > oneBall,
    `${info.volume.toFixed(3)} against ${(oneBall * 2).toFixed(3)} if they were added up`);
}

console.log('\nIt behaves the same way every time, and says when it cannot:');
{
  const twice = () => JSON.stringify(Array.from(solidOf([part('sphere', { radius: 1 })], { resolution: 20 }).mesh.positions));
  ok('the same field gives the same mesh', twice() === twice());

  const coarse = solidOf([part('sphere', { radius: 1 })], { resolution: 12 });
  const fine = solidOf([part('sphere', { radius: 1 })], { resolution: 48 });
  ok('a finer grid is closer to the true volume',
    Math.abs(fine.info.volume - (4 / 3) * Math.PI) < Math.abs(coarse.info.volume - (4 / 3) * Math.PI));
  ok('and both are still closed', coarse.info.closed && fine.info.closed);

  ok('a silly resolution is brought back into range',
    solidOf([part('sphere', { radius: 1 })], { resolution: 100000 }).mesh.stats.resolution === S.MAX_RESOLUTION);
  ok('and so is a useless one',
    solidOf([part('sphere', { radius: 1 })], { resolution: 1 }).mesh.stats.resolution === S.MIN_RESOLUTION);

  const nothing = S.extract(null);
  ok('no field is not a crash', nothing.stats.triangles === 0);
  ok('and it says why', nothing.issues.some((i) => i.code === 'no-field'));
  const emptyPlan = S.extract(F.buildField([]));
  ok('an empty plan produces no surface and says so',
    emptyPlan.stats.triangles === 0 && emptyPlan.issues.length > 0);
}

console.log('\nWhat it does not guarantee, said out loud:');
{
  const source = readFileSync(join(root, 'src', 'js', 'forge', 'surface.js'), 'utf8');

  // A model thinner than a cell has no corner inside it, so the walk finds
  // nothing at all and the object simply is not there. Reported, because
  // silently handing back an empty file is the worst of the options.
  const wafer = S.extract(F.buildField([part('box', { width: 2, height: 2, depth: 0.02 })]), { resolution: 24 });
  ok('a model thinner than a cell disappears rather than half-appearing',
    wafer.stats.triangles === 0);
  ok('and it says so', wafer.issues.some((i) => i.code === 'no-surface'));
  ok('even then the counts are numbers a caller can read',
    typeof wafer.stats.foldedEdges === 'number' && typeof wafer.stats.openEdges === 'number');

  // One vertex per cell means a feature thinner than a cell can have both of
  // its sides pass through the same cell, and the single vertex there joins two
  // sheets that should never have met. The mesh stays closed — no edge is left
  // with one triangle — but an edge can end up with more than two.
  const solid = S.extract(F.buildField([part('sphere', { radius: 1 })]), { resolution: 32 });
  const info = S.inspect(solid);
  ok('a mesh always reports what its edges came to',
    typeof solid.stats.foldedEdges === 'number' && typeof solid.stats.openEdges === 'number');
  ok('and the report agrees with counting it independently',
    solid.stats.foldedEdges === info.nonManifoldEdges && solid.stats.openEdges === info.boundaryEdges);
  ok('nothing is ever left open, whatever else happens', solid.stats.openEdges === 0);
  ok('a mesh with nothing folded reports nothing', !solid.issues.some((i) => i.code === 'folded'));

  // Looking closer is not a fix, and this is the measurement that says so. If
  // it ever becomes monotonic the refining idea is worth revisiting; until then
  // a loop that walks the grid three times buys nothing but the wait.
  const parts = [
    part('lathe', { points: [[0.05, -1.1], [0.32, -0.6], [0.44, 0], [0.34, 0.5], [0.08, 1.05]] }, { id: 'body', rotation: [1.5708, 0, 0], scale: [0.55, 1, 1] }),
    part('extrude', { points: [[0, 0], [-0.45, 0.4], [-0.36, 0], [-0.45, -0.4]], depth: 0.07 }, { id: 'tail', position: [0, 0, -0.92], rotation: [0, 1.5708, 0] }),
  ];
  const f = F.buildField(parts);
  const folds = [48, 96, 160].map((r) => S.inspect(S.extractOnce(f, { resolution: r })).nonManifoldEdges);
  ok('the extraction takes one walk and not three', !source.includes('REFINE_TRIES'),
    `folds by resolution came to ${folds.join(', ')} — not something more of the same fixes`);
  ok('and the resolution is not driven by the thinnest part either',
    !source.includes('CELLS_PER_FEATURE'), 'it made every model slower and fixed none of them');

  ok('the module says plainly that it is not yet guaranteed manifold',
    /nothing may claim[\s\S]{0,20}this output is watertight without reading that count/.test(source));
  ok('and names what would actually fix it',
    /one vertex per surface COMPONENT/.test(source));
}

console.log('\nThe module reaches nothing outside itself:');
{
  const code = readFileSync(join(root, 'src', 'js', 'forge', 'surface.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok('it touches no page and no renderer', !/document|THREE|fetch/.test(code));
  ok('and reaches nothing but its own export', (code.match(/window\./g) || []).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/surface.js)\n`);
process.exit(fail ? 1 : 0);
