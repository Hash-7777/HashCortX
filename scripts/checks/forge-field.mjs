// ==============================================================
// Forge field checks
//
// Loads the REAL src/js/model-plan.js and src/js/forge/field.js into a Node VM.
//
// A distance field is the kind of code that looks right and is wrong by a sign
// or a half. Nothing catches that by inspection, and nothing downstream catches
// it either — a surface extracted from a wrong field is a plausible-looking
// object that is the wrong shape. So every rule here is a distance to a place
// whose answer is known by hand: the centre of a sphere is minus its radius
// from the surface, a point two units outside a unit box is one unit away.
//
// Run with: npm run check:forge-field
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'model-plan.js'], ['src', 'js', 'forge', 'field.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel[rel.length - 1] });
}
const F = sandbox.window.HCForgeField;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const part = (type, params, extra = {}) => ({
  id: type, name: type, type, role: 'structure', op: 'union',
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params, ...extra,
});
const at = (p, x, y, z) => F.localDistance(p, x, y, z);
const field = (parts, opts) => F.buildField(parts, opts);

console.log('\nThe distance to a shape is the distance to that shape:');
{
  const sphere = part('sphere', { radius: 1 });
  ok('the centre of a ball is a radius inside it', near(at(sphere, 0, 0, 0), -1));
  ok('its surface is on the surface', near(at(sphere, 1, 0, 0), 0));
  ok('a point outside is as far out as it is', near(at(sphere, 3, 0, 0), 2));
  ok('and distance does not care which way', near(at(sphere, 0, 0, -3), 2));

  const box = part('box', { width: 2, height: 2, depth: 2 });
  ok('the centre of a box is half a side inside', near(at(box, 0, 0, 0), -1));
  ok('a face is on the surface', near(at(box, 1, 0, 0), 0));
  ok('straight out from a face', near(at(box, 2, 0, 0), 1));
  // The corner is what a naive box formula gets wrong: it reports the largest
  // single axis instead of the diagonal.
  ok('and out from a corner is the diagonal', near(at(box, 2, 2, 2), Math.sqrt(3)));
  ok('a flat box is still measured on its thin axis',
    near(at(part('box', { width: 4, height: 0.2, depth: 4 }), 0, 0.6, 0), 0.5));

  const cyl = part('cylinder', { radius: 1, height: 2 });
  ok('the axis of a cylinder is a radius inside', near(at(cyl, 0, 0, 0), -1));
  ok('its side is on the surface', near(at(cyl, 1, 0, 0), 0));
  ok('its end is too', near(at(cyl, 0, 1, 0), 0));
  ok('past the end is past the end', near(at(cyl, 0, 2, 0), 1));
  ok('and past the rim is the diagonal', near(at(cyl, 2, 2, 0), Math.sqrt(2)));

  const cone = part('cone', { radius: 1, height: 2 });
  ok('a cone is widest at its base', near(at(cone, 1, -1, 0), 0));
  ok('and comes to a point', near(at(cone, 0, 1, 0), 0));
  ok('with nothing above the point', at(cone, 0, 1.5, 0) > 0.4);
  ok('its base is flat', near(at(cone, 0, -1, 0), 0));

  const cap = part('capsule', { radius: 0.5, length: 2 });
  ok('a capsule is a radius from its axis', near(at(cap, 0.5, 0, 0), 0));
  ok('and rounded past the straight part', near(at(cap, 0, 1.5, 0), 0), 'half the length plus a cap');
  ok('its middle is a radius deep', near(at(cap, 0, 0, 0), -0.5));

  const torus = part('torus', { radius: 2, tube: 0.5 });
  ok('a ring is a tube around its radius', near(at(torus, 2.5, 0, 0), 0));
  ok('the hole in the middle is outside it', near(at(torus, 0, 0, 0), 1.5));
  // The ring stands in the XY plane, so it is thin through z. Getting this
  // round the wrong way is exactly the bug the bounding box had.
  ok('and it is thin through Z, not through Y', near(at(torus, 2, 0, 0.5), 0));
  ok('so a point above its centre is not inside it', at(torus, 0, 2, 0) < 0.001 && at(torus, 0, 2, 0) > -0.51);
}

console.log('\nA turned profile is the outline it was drawn from:');
{
  // A straight-sided profile from radius 1: the same solid as a cylinder, so
  // the answers must match a shape whose formula is known.
  const lathe = part('lathe', { points: [[1, -1], [1, 1]] });
  ok('a straight profile turns into a cylinder', near(at(lathe, 1, 0, 0), 0));
  ok('its axis is a radius inside', near(at(lathe, 0, 0, 0), -1));
  ok('its end is closed', near(at(lathe, 0, 1, 0), 0));
  ok('it reaches the same distance all the way round',
    near(at(lathe, 0, 0, 1.5), at(lathe, 1.5, 0, 0)));

  // A waisted profile is not convex, which is the case a nearest-edge answer
  // has to handle and a half-plane test does not.
  const waisted = part('lathe', { points: [[1, -1], [0.4, 0], [1, 1]] });
  ok('a waisted profile is narrow in the middle', at(waisted, 0.7, 0, 0) > 0);
  ok('and wide near the ends', at(waisted, 0.7, 0.9, 0) < 0, 'the profile reaches 0.94 at that height');
}

console.log('\nAn extrusion runs from its profile plane forwards:');
{
  const ex = part('extrude', { points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], depth: 2 });
  ok('the profile plane is a face', near(at(ex, 0, 0, 0), 0));
  ok('and the depth is the other one', near(at(ex, 0, 0, 2), 0));
  ok('the middle is inside', near(at(ex, 0, 0, 1), -1));
  ok('behind the profile plane is outside', near(at(ex, 0, 0, -1), 1));
  ok('and the outline still applies', near(at(ex, 2, 0, 1), 1));
}

console.log('\nA part is asked about where it actually is:');
{
  const moved = field([part('sphere', { radius: 1 }, { position: [5, 0, 0] })]);
  ok('a part that was moved answers about where it was moved to',
    near(moved.evaluate(5, 0, 0), -1) && near(moved.evaluate(0, 0, 0), 4));

  // A tall thin box turned on its side: if the rotation were not undone, or
  // undone the wrong way, this reads as the shape it started as.
  const turned = field([part('box', { width: 4, height: 0.5, depth: 0.5 }, { rotation: [0, 0, Math.PI / 2] })]);
  ok('a part that was turned answers about which way it faces',
    near(turned.evaluate(0, 2, 0), 0) && near(turned.evaluate(2, 0, 0), 1.75),
    `up ${turned.evaluate(0, 2, 0).toFixed(3)}, along ${turned.evaluate(2, 0, 0).toFixed(3)}`);

  const scaled = field([part('sphere', { radius: 1 }, { scale: [2, 2, 2] })]);
  ok('a part that was scaled is that much bigger', near(scaled.evaluate(2, 0, 0), 0));
  ok('and the distance outside it scales too', near(scaled.evaluate(3, 0, 0), 1));

  // A non-uniform scale is no longer a true distance. It must stay an
  // UNDERestimate, or a surface walk steps straight through the skin.
  const squashed = field([part('sphere', { radius: 1 }, { scale: [3, 1, 1] })]);
  const reported = squashed.evaluate(6, 0, 0);
  ok('a squashed part never over-reports how far away it is', reported <= 3 + 1e-9,
    `reported ${reported.toFixed(3)}, true distance 3`);
  ok('and is still negative inside', squashed.evaluate(0, 0, 0) < 0);
}

console.log('\nThe operations that were missing:');
{
  const solid = { ...part('cylinder', { radius: 1, height: 2 }), id: 'body' };
  const bore = { ...part('cylinder', { radius: 0.6, height: 3 }), id: 'bore', op: 'subtract' };

  const plain = field([solid]);
  ok('a solid cylinder is solid at its axis', plain.evaluate(0, 0, 0) < 0);

  const drilled = field([solid, bore]);
  ok('drilling it makes the axis empty', drilled.evaluate(0, 0, 0) > 0,
    `still ${drilled.evaluate(0, 0, 0).toFixed(3)}`);
  ok('and the wall is still there', drilled.evaluate(0.8, 0, 0) < 0);
  ok('the bore surface is a surface', near(drilled.evaluate(0.6, 0, 0), 0));
  ok('the outside is untouched', near(drilled.evaluate(1, 0, 0), 0));

  const both = field([solid, { ...part('box', { width: 4, height: 4, depth: 4 }, { position: [1.5, 0, 0] }), id: 'half', op: 'intersect' }]);
  ok('intersecting keeps only what is in both', both.evaluate(-0.9, 0, 0) > 0 && both.evaluate(0.9, 0, 0) < 0);

  // Taking material out of nothing is not an object with a hole; it is a hole.
  const backwards = field([bore, solid]);
  ok('a plan that opens by cutting is reported',
    backwards.issues.some((i) => i.code === 'nothing-to-cut'));
  ok('and is treated as adding, so a model still appears',
    backwards.evaluate(0, 0, 0) < 0);

  // Only what adds material may set the region worth looking at, or a bore
  // placed far away would make the whole model coarser.
  const far = field([solid, { ...bore, position: [50, 0, 0] }]);
  ok('a cut placed far away does not widen the model', far.bounds[3] <= 1.001,
    `bounds reached ${far.bounds[3]}`);
}

console.log('\nA rounded join, which is a fillet by another name:');
{
  ok('a blend of nothing is a plain minimum', near(F.softMin(3, 5, 0), 3));
  ok('a blend pulls the join in', F.softMin(0, 0, 1) < 0);
  ok('and leaves distant surfaces alone', near(F.softMin(0, 9, 0.2), 0, 1e-3));
  const sharp = field([part('box', { width: 2, height: 2, depth: 2 }), { ...part('box', { width: 2, height: 2, depth: 2 }, { position: [2, 0, 0] }), id: 'b' }]);
  const round = field([part('box', { width: 2, height: 2, depth: 2 }), { ...part('box', { width: 2, height: 2, depth: 2 }, { position: [2, 0, 0] }), id: 'b', blend: 0.5 }]);
  ok('a blended join has more material at the corner than a sharp one',
    round.evaluate(1, 1.1, 0) < sharp.evaluate(1, 1.1, 0));
}

console.log('\nA model can be hollowed, and the wall goes inwards:');
{
  const box = () => field([part('box', { width: 1, height: 0.6, depth: 0.4 })]);
  const solid = box();
  const walled = field([part('box', { width: 1, height: 0.6, depth: 0.4 })], { hollow: 0.06 });
  ok('a model with no wall asked for is unchanged', solid.hollow === 0);
  ok('and one with a wall says so', walled.hollow === 0.06);

  // Deep inside a solid is material; deep inside a hollow one is air.
  ok('the middle of a solid is inside it', solid.evaluate(0, 0, 0) < 0);
  ok('and the middle of a hollow one is not', walled.evaluate(0, 0, 0) > 0);
  // Just inside the surface is wall in both.
  ok('just under the skin is material either way',
    solid.evaluate(0, 0, 0.17) < 0 && walled.evaluate(0, 0, 0.17) < 0);

  // THE ONE THAT MATTERS. The other obvious spelling of this centres the wall
  // ON the surface, which grows the object by half a wall in every direction —
  // the sort of thing nobody notices until the part does not fit.
  ok('hollowing does not make the object any bigger',
    Math.abs(walled.evaluate(0, 0, 0.21) - solid.evaluate(0, 0, 0.21)) < 1e-9,
    'a point outside must measure the same either way');
  ok('and the outside surface is in the same place',
    Math.abs(walled.evaluate(0, 0, 0.2)) < 1e-9 && Math.abs(solid.evaluate(0, 0, 0.2)) < 1e-9);

  ok('a wall of nothing leaves the model solid', field([part('box', { width: 1 })], { hollow: 0 }).evaluate(0, 0, 0) < 0);
  ok('and a wall thicker than the part leaves it solid rather than inside out',
    field([part('box', { width: 1, height: 0.6, depth: 0.4 })], { hollow: 5 }).evaluate(0, 0, 0) < 0);
}

console.log('\nWhat it will not pretend to know:');
{
  // This file deliberately does NOT load src/js/forge/meshfield.js, so what is
  // tested here is the fallback: with no mesh field available a supplied mesh
  // is answered by the box it occupies, and says so. What happens when the
  // mesh field IS there — the mesh answered from its own triangles — is
  // checked in forge-meshfield.mjs, which loads both.
  ok('the mesh field really is absent here', !sandbox.window.HCForgeMeshField);
  const meshy = field([part('mesh', { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })]);
  ok('a supplied mesh is then answered with its box', meshy.parts === 1);
  ok('and says so rather than implying it was measured',
    meshy.issues.some((i) => i.code === 'mesh-approximated'));
  ok('a flat mark is not part of a solid at all',
    field([part('logo_img', { width: 2, height: 2 })]).parts === 0);
  ok('an empty plan is an empty field', field([]).parts === 0);
  ok('and does not throw when asked', Number.isFinite(field([]).evaluate(0, 0, 0)) === false);
}

console.log('\nWhich way the surface faces:');
{
  const f = field([part('sphere', { radius: 1 })]);
  const n = f.normalAt(1, 0, 0, 1e-4);
  ok('the normal on a ball points straight out', near(n[0], 1, 1e-3) && near(n[1], 0, 1e-3));
  const top = f.normalAt(0, 1, 0, 1e-4);
  ok('and follows the surface round', near(top[1], 1, 1e-3));
  ok('it is a unit length', near(Math.hypot(...n), 1, 1e-6));
}

console.log('\nThe module reaches nothing outside itself:');
{
  const code = readFileSync(join(root, 'src', 'js', 'forge', 'field.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok('it touches no page and no renderer', !/document|THREE|fetch/.test(code));
  ok('and asks model-plan where a part is rather than deciding again',
    /MP\.rotationMatrix|MP\.localBounds/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/field.js)\n`);
process.exit(fail ? 1 : 0);
