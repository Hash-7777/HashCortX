// ==============================================================
// Improve checks
//
// Loads the REAL src/js/forge/improve.js, with the arithmetic, the gate, the
// assembler and the preparation path it hands its answer back to.
//
// Two rules: a correcting model sees the model in millimetres and its answer
// is read in millimetres, so a replacement part lands at the size it was given;
// and a correction to one side of a mirrored pair is a correction to both.
//
// Run with: npm run check:forge-improve
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of ['forge/expr.js', 'model-plan.js', 'forge/units.js', 'forge/plan-normalize.js', 'forge/prepare.js', 'forge/improve.js']) {
  vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', ...rel.split('/')), 'utf8'), sandbox, { filename: rel });
}
const { HCForgeImprove: I, HCForgePrepare: PREP, HCModelPlan: MP, HCForgeUnits: U } = sandbox.window;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** Build a design the way the app does, and the factor the screen measures with. */
function built(plan) {
  const out = PREP.preparePlan(plan, { targetSize: U.WORKING_SPAN });
  const span = Math.max(...MP.sizeOf(MP.boundsOf(out.plan.nodes)));
  return { nodes: out.plan.nodes, sizeMm: out.plan.sizeMm, mmPerUnit: U.mmPerUnit(out.plan.sizeMm, span) };
}
const mmBox = (node, k) => MP.sizeOf(MP.partBox(node)).map((v) => v * k);

const chair = built({
  name: 'chair', sizeMm: 900,
  nodes: [
    { id: 'seat', type: 'box', position: [0, 465, 0], params: { width: 400, height: 30, depth: 400 } },
    { id: 'back', type: 'box', position: [0, 690, -190], params: { width: 400, height: 420, depth: 20 } },
    { id: 'leg', type: 'cylinder', position: [180, 225, 180], params: { radius: 20, height: 450 }, repeat: { count: 4, about: 'y' } },
  ],
});
const k = chair.mmPerUnit;

console.log('The model is shown in millimetres:');
{
  const leg = I.toMillimetres(chair.nodes.find((n) => n.id === 'leg'), k);
  ok('a leg placed 180 mm out is shown 180 mm out', near(leg.position[0], 180, 1e-9));
  ok('and its size, params times scale, is its real size', near(leg.params.height * leg.scale[1], 450, 1e-9));
  const back = I.fromMillimetres(I.toMillimetres(chair.nodes[1], k), k);
  ok('showing and reading back changes nothing', back.position.every((v, i) => near(v, chair.nodes[1].position[i], 1e-12)) && back.scale.every((v, i) => near(v, chair.nodes[1].scale[i], 1e-12)));
}

console.log('\nAn answer in millimetres lands at the size it gave:');
{
  const patch = {
    replace: [{ id: 'back', position: [0, '465 + 15 + 250', -190], params: { width: 400, height: 500, depth: 20 } }],
    add: [{ id: 'rail', type: 'box', position: [0, 120, 180], params: { width: 360, height: 20, depth: 20 } }],
  };
  const out = I.applyPatch(chair.nodes, patch, k);
  const back = out.nodes.find((n) => n.id === 'back');
  const rail = out.nodes.find((n) => n.id === 'rail');
  ok('a replaced part is where the answer put it, sums worked out', near(back.position[1] * k, 730));
  ok('and as tall as the answer said, at the scale it had', near(mmBox(back, k)[1], 500));
  ok('an added part with no scale is read as millimetres', near(mmBox(rail, k)[0], 360) && near(rail.position[2] * k, 180));
  ok('the counts say what happened', out.counts.changed === 1 && out.counts.added === 1 && out.counts.removed === 0);

  // A part whose sizes are in another unit keeps its scale when only a size
  // changes. Reading that as millimetres would make it hundreds of times
  // smaller, which is what an answer in a different unit used to do to a model.
  const small = built({ sizeMm: 100, nodes: [
    { id: 'body', type: 'cylinder', position: [0, 0, 0], params: { radius: 0.5, height: 1 } },
    { id: 'cap', type: 'sphere', position: [0, 0.5, 0], params: { radius: 0.5 } },
  ] });
  const before = mmBox(small.nodes[0], small.mmPerUnit)[1];
  const grown = I.applyPatch(small.nodes, { replace: [{ id: 'body', params: { radius: 0.5, height: 1.2 } }] }, small.mmPerUnit);
  ok('a size changed without a scale keeps the part in proportion', near(mmBox(grown.nodes[0], small.mmPerUnit)[1], before * 1.2));
}

console.log('\nA mirrored pair is corrected as a pair:');
{
  const glider = built({ name: 'glider', sizeMm: 300, nodes: [
    { id: 'body', type: 'box', position: [0, 0, 0], params: { width: 40, height: 40, depth: 300 } },
    { id: 'wing', type: 'box', position: [80, 0, 0], params: { width: 120, height: 6, depth: 60 }, mirror: 'x' },
  ] });
  const gk = glider.mmPerUnit;
  ok('the design built a pair', glider.nodes.some((n) => n.id === 'wing_mirrored'));

  const viaCopy = I.applyPatch(glider.nodes, { replace: [{ id: 'wing_mirrored', position: [-90, 10, 20] }] }, gk);
  ok('a change to the copy leaves no copy behind to disagree', !viaCopy.nodes.some((n) => n.id === 'wing_mirrored'));
  const wing = viaCopy.nodes.find((n) => n.id === 'wing');
  ok('it becomes a change to the original, seen in the mirror', near(wing.position[0] * gk, 90) && near(wing.position[1] * gk, 10) && near(wing.position[2] * gk, 20));
  ok('and the original is marked to be mirrored again', wing.mirror === 'x');
  const rebuilt = PREP.preparePlan({ name: 'glider', sizeMm: 300, nodes: viaCopy.nodes }, { targetSize: U.WORKING_SPAN }).plan.nodes;
  const a = rebuilt.find((n) => n.id === 'wing');
  const b = rebuilt.find((n) => n.id === 'wing_mirrored');
  ok('built again, the pair is exact', !!a && !!b && near(a.position[0], -b.position[0], 1e-12) && near(a.position[2], b.position[2], 1e-12));

  const viaOriginal = I.applyPatch(glider.nodes, { replace: [{ id: 'wing', params: { width: 150, height: 6, depth: 60 } }] }, gk);
  ok('a change to the original also drops the stale copy', !viaOriginal.nodes.some((n) => n.id === 'wing_mirrored') && viaOriginal.nodes.find((n) => n.id === 'wing').mirror === 'x');
  const both = I.applyPatch(glider.nodes, { replace: [{ id: 'wing_mirrored', position: [-50, 0, 0] }, { id: 'wing', position: [100, 0, 0] }] }, gk);
  ok('when both sides are answered, the original wins', near(both.nodes.find((n) => n.id === 'wing').position[0] * gk, 100));

  const gone = I.applyPatch(glider.nodes, { remove: ['wing_mirrored'] }, gk);
  ok('removing one side removes both', !gone.nodes.some((n) => n.id === 'wing' || n.id === 'wing_mirrored'));
  ok('and counts as one removal', gone.counts.removed === 1);

  // Control: merging each answer into the part it names, which is what the run
  // did, leaves the two sides of a pair different.
  const naive = glider.nodes.map((n) => (n.id === 'wing_mirrored' ? { ...n, position: [-90 / gk, 10 / gk, 20 / gk] } : n));
  const na = naive.find((n) => n.id === 'wing');
  const nb = naive.find((n) => n.id === 'wing_mirrored');
  ok('control: merging into the named part alone breaks the pair', !near(na.position[1], nb.position[1]));
}

console.log('\nWhat the model is not sure of is ignored, not guessed at:');
{
  const out = I.applyPatch(chair.nodes, { remove: ['nope'], replace: [{ id: 'ghost', position: [1, 2, 3] }, null], add: [null, 'text'] }, k);
  ok('ids that do not exist change nothing', out.nodes.length === chair.nodes.length && out.counts.changed === 0 && out.counts.removed === 0 && out.counts.added === 0);
  ok('an answer that is not a patch changes nothing', I.applyPatch(chair.nodes, 'nonsense', k).nodes.length === chair.nodes.length);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/improve.js)`);
process.exit(fail ? 1 : 0);
