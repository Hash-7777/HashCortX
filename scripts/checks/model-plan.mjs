// ==============================================================
// Model plan checks
//
// Loads the REAL src/js/model-plan.js into a Node VM and holds it to the rules
// that used to be asked of a language model and then hoped for.
//
// This stage fails quietly by nature. Nothing throws when a model comes out
// asymmetric, sunk through the floor, or forty units long — it renders, it just
// looks wrong, and the run reports success. So each rule below is stated as
// something measurable before the code sees the input:
//
//   · Mirroring produces an exact opposite, not an approximate one.
//   · The lowest point ends on the floor, whatever mirroring did to it.
//   · A plan in the wrong units comes out about a metre across.
//   · A part that renders to nothing is dropped, with a reason.
//   · A part floating beside the model is reported, not silently deleted.
//
// Run with: npm run check:model-plan
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'model-plan.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'model-plan.js' });
const P = sandbox.window.HCModelPlan;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const box = (id, extra = {}) => ({
  id, name: id, type: 'box',
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  params: { width: 1, height: 1, depth: 1 },
  ...extra,
});

console.log('\nThe module is there:');
ok('HCModelPlan is published', !!P);
ok('assemble is callable', typeof P.assemble === 'function');

// ── Cleaning up what a model sent ────────────────────────────────────────────
console.log('\nA plan is made safe before anything is drawn:');
{
  const { parts, issues } = P.normaliseParts([
    box('a'),
    { id: 'b' },                                   // nothing but an id
    'not an object',
    null,
    box('a'),                                      // the same id twice
    box('nan', { position: ['x', 2, 3] }),
    box('far', { position: [999, 0, 0] }),
    box('flat', { params: { width: 0, height: 0, depth: 0 } }),
  ]);
  const ids = parts.map((p) => p.id);
  ok('a part with only an id still gets defaults', parts.some((p) => p.id === 'b' && p.type === 'box'));
  ok('entries that are not objects are refused', issues.filter((i) => i.code === 'not-a-part').length === 2);
  ok('a repeated id is renamed, not dropped', ids.includes('a') && ids.includes('a_2'));
  ok('a non-numeric coordinate becomes zero', parts.find((p) => p.id === 'nan').position[0] === 0);
  ok('a runaway coordinate is clamped', parts.find((p) => p.id === 'far').position[0] === P.COORD_LIMIT);
  ok('the clamp is reported, not silent', issues.some((i) => i.code === 'coordinate-clamped'));
  ok('a part with no size is dropped', !ids.includes('flat'));
  ok('the drop says why', issues.some((i) => i.code === 'degenerate' && i.partId === 'flat'));
  ok('a zero scale is treated as one', P.normaliseParts([box('z', { scale: [0, 1, 1] })]).parts[0].scale[0] === 1);
}

// ── Symmetry, made not asked for ─────────────────────────────────────────────
console.log('\nMirroring produces an exact opposite:');
{
  const { parts } = P.expandMirrors(P.normaliseParts([
    box('fin', { position: [0.4, 0.2, 0], rotation: [0, 0.3, 0.1], mirror: true }),
  ]).parts);
  ok('one part becomes two', parts.length === 2);
  const [left, right] = parts;
  ok('x position is negated exactly', near(right.position[0], -left.position[0]));
  ok('y and z are untouched', right.position[1] === left.position[1] && right.position[2] === left.position[2]);
  ok('x scale is negated, so it faces the other way', near(right.scale[0], -left.scale[0]));
  ok('the y and z rotations flip', near(right.rotation[1], -left.rotation[1]) && near(right.rotation[2], -left.rotation[2]));
  ok('the copy records what it came from', right.mirroredFrom === 'fin');
  ok('the original is no longer marked to mirror', parts.every((p) => p.mirror !== true));
}
{
  const { parts, issues } = P.expandMirrors(P.normaliseParts([
    box('spine', { position: [0, 0.5, 0], mirror: true }),
  ]).parts);
  ok('a part on the axis is not duplicated onto itself', parts.length === 1);
  ok('and that is reported', issues.some((i) => i.code === 'mirror-on-axis'));
}

// ── Floor and scale ──────────────────────────────────────────────────────────
console.log('\nThe model sits on the floor at a usable size:');
{
  const sunk = P.normaliseParts([box('body', { position: [0, -3, 0] })]).parts;
  const { parts, offset } = P.snapToFloor(sunk);
  ok('the lowest point lands on zero', near(P.boundsOf(parts)[1], 0, 1e-9));
  ok('the lift is reported', near(offset, 3.5));
  ok('an already-grounded model is left alone', P.snapToFloor(parts).offset === 0);
}
{
  const huge = P.normaliseParts([box('slab', { scale: [40, 8, 8] })]).parts;
  const { parts, factor } = P.normaliseScale(huge, 1);
  ok('a plan in the wrong units is brought to size', near(Math.max(...P.sizeOf(P.boundsOf(parts))), 1, 1e-6));
  ok('the factor is reported', factor > 0 && factor < 1);
  const tiny = P.normaliseParts([box('speck', { scale: [0.01, 0.01, 0.01] })]).parts;
  ok('a speck is grown, not only shrunk', P.normaliseScale(tiny, 1).factor > 1);
  ok('a model already the right size is not rescaled', P.normaliseScale(parts, 1).factor === 1);
}

// ── What is wrong that a person would notice ────────────────────────────────
console.log('\nProblems are named rather than hidden:');
{
  const parts = P.normaliseParts([
    box('body', { scale: [2, 1, 1] }),
    box('bolt', { position: [1.2, 0, 0], scale: [0.3, 0.3, 0.3] }),
    box('stray', { position: [8, 0, 0], scale: [0.3, 0.3, 0.3] }),
  ]).parts;
  const issues = P.findIssues(parts);
  ok('a floating part is reported', issues.some((i) => i.code === 'detached' && i.partId === 'stray'));
  ok('a touching part is not', !issues.some((i) => i.code === 'detached' && i.partId === 'bolt'));
  ok('the main body is never called detached', !issues.some((i) => i.code === 'detached' && i.partId === 'body'));
  ok('an empty plan says so', P.findIssues([])[0].code === 'empty');
}

// ── The stage as a whole ─────────────────────────────────────────────────────
console.log('\nThe order of the steps holds:');
{
  const out = P.assemble({
    name: 'fish',
    nodes: [
      { id: 'body', type: 'extrude', position: [0, 2, 0], scale: [3, 3, 3], params: { points: [[-1, -0.3], [1, -0.3], [1, 0.3], [-1, 0.3]], depth: 0.4 } },
      { id: 'fin', type: 'box', position: [0.6, 2.4, 0.3], scale: [0.6, 0.6, 0.2], params: { width: 1, height: 1, depth: 1 }, mirror: true },
    ],
  }, { targetSize: 1 });
  ok('the plan keeps its name', out.name === 'fish');
  ok('the mirrored part exists', out.parts.length === 3);
  ok('scaling happened before the floor was found', near(P.boundsOf(out.parts)[1], 0, 1e-9));
  ok('the result is about a metre across', near(Math.max(...out.stats.size), 1, 1e-6));
  ok('the counts are reported', out.stats.received === 2 && out.stats.kept === 2 && out.stats.mirrored === 1);
  ok('mirroring is exact after every later step',
    near(out.parts[1].position[0], -out.parts[2].position[0]));
  ok('nothing is left floating in this plan', !out.issues.some((i) => i.code === 'detached'));
}
{
  // Resizing is opt-in: without a target, a plan keeps the size it arrived at.
  const asis = P.assemble({ nodes: [box('slab', { scale: [40, 8, 8] })] });
  ok('no target size means no rescaling', asis.stats.scaleFactor === 1);
  ok('but the floor is still found', near(P.boundsOf(asis.parts)[1], 0, 1e-9));
}
{
  const out = P.assemble(null);
  ok('a missing plan is not fatal', Array.isArray(out.parts) && out.parts.length === 0);
  ok('and it says the plan was empty', out.issues.some((i) => i.code === 'empty'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-plan.js)\n`);
process.exit(fail ? 1 : 0);
