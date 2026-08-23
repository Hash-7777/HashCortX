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
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'forge', 'expr.js'), 'utf8'), sandbox, { filename: 'expr.js' });
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
  // A real run returned leg_fl and leg_fr as separate parts. If a name could
  // turn mirroring on, that chair would come back with six legs.
  ok('a left/right name does not mirror on its own',
    P.expandMirrors(P.normaliseParts([box('leg_fl', { name: 'left front leg', position: [0.4, 0, 0.4] })]).parts).parts.length === 1);
  ok('an explicit flag still mirrors',
    P.expandMirrors(P.normaliseParts([box('leg', { position: [0.4, 0, 0.4], mirror: true })]).parts).parts.length === 2);
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

  // A caller that measures the real geometry grounds it itself.
  const ungrounded = P.assemble({ nodes: [box('body', { position: [0, 5, 0] })] }, { ground: false });
  ok('ground:false leaves the height alone', near(P.boundsOf(ungrounded.parts)[1], 4.5, 1e-9));
  ok('and reports no offset', ungrounded.stats.floorOffset === 0);
  ok('mirroring still happens without grounding',
    P.assemble({ nodes: [box('fin', { position: [1, 2, 0], mirror: true })] }, { ground: false }).stats.mirrored === 1);
}
{
  const out = P.assemble(null);
  ok('a missing plan is not fatal', Array.isArray(out.parts) && out.parts.length === 0);
  ok('and it says the plan was empty', out.issues.some((i) => i.code === 'empty'));
}

// ── Parts that do not reach the body ─────────────────────────────────────────
//
// A real run produced six parts of an aeroplane with five of them adrift. The
// stage measured every one, named it in the trace, and handed the pile over.
// These hold the repair to being a repair: it closes small gaps, it leaves
// alone anything that is either already attached or plainly not part of the
// same object, and it never changes what the model is made of.
// ── Rotation is part of a part's size ────────────────────────────────────────
//
// A fuselage is a cylinder turned on its side. Measured from its parameters
// alone it comes out as a column standing where a long body should lie — so
// every question asked of it afterwards (does this touch, where is the bottom,
// how big is this model) was answered about a shape that is not on screen. In
// a real run that reported five parts adrift, two of them were touching the
// whole time.
console.log('\nA part is measured as it is turned:');
{
  const long = { id: 'body', name: 'body', type: 'cylinder', position: [0, 0, 0],
    rotation: [0, 0, 0], scale: [1, 1, 1], params: { radius: 0.2, height: 2 } };
  const upright = P.partBox(long);
  ok('upright, a tall cylinder is tall', near(upright[4] - upright[1], 2, 1e-9));
  ok('and narrow', near(upright[3] - upright[0], 0.4, 1e-9));

  const onItsSide = P.partBox({ ...long, rotation: [0, 0, Math.PI / 2] });
  ok('turned on its side, it is long', near(onItsSide[3] - onItsSide[0], 2, 1e-9));
  ok('and no longer tall', near(onItsSide[4] - onItsSide[1], 0.4, 1e-9));

  const quarter = P.partBox({ ...long, rotation: [Math.PI / 2, 0, 0] });
  ok('turned about x, its length is in z', near(quarter[5] - quarter[2], 2, 1e-9));

  // A part rotated by a whole turn is where it started.
  const full = P.partBox({ ...long, rotation: [0, 0, Math.PI * 2] });
  ok('a full turn changes nothing', near(full[4] - full[1], 2, 1e-6));

  // Two parts that touch once rotation is accounted for are not reported adrift.
  const built = P.assemble({ nodes: [
    { ...long, rotation: [0, 0, Math.PI / 2] },
    { id: 'wing', name: 'wing', type: 'box', position: [0, 0, 0.4], rotation: [0, 0, 0],
      scale: [1, 1, 1], params: { width: 1.2, height: 0.05, depth: 0.6 } },
  ] }, { ground: false });
  ok('a part touching a turned body is not called adrift',
    !built.issues.some((i) => i.code === 'detached'));
  ok('and it was not moved to get there', built.stats.connected === 0);
}

console.log('\nParts that do not reach the body are brought to it:');
{
  // A body with a panel floating a little way off it on one axis only.
  const near1 = P.connectParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('panel', { position: [1.8, 0, 0], params: { width: 0.4, height: 0.4, depth: 0.4 } }),
  ]);
  ok('a small gap is closed', near1.moves.length === 1);
  ok('the part that moved is the one adrift', near1.moves[0]?.partId === 'panel');
  ok('and it moved along the axis it was adrift on',
    near1.moves[0]?.by[1] === 0 && near1.moves[0]?.by[2] === 0);
  ok('the body did not move',
    near1.parts.find((p) => p.id === 'body').position.every((v) => v === 0));
  ok('nothing is left detached afterwards',
    !P.findIssues(near1.parts).some((i) => i.code === 'detached'));

  // Already touching: nothing to do, and nothing may move.
  const attached = P.connectParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('wing', { position: [1.2, 0, 0], params: { width: 0.6, height: 0.1, depth: 0.6 } }),
  ]);
  ok('a model that already connects is left exactly alone', attached.moves.length === 0);

  // Far away: a second object, or an order of magnitude wrong. Not dragged in.
  const far = P.connectParts([
    box('body', { params: { width: 1, height: 1, depth: 1 } }),
    box('stray', { position: [40, 0, 0] }),
  ]);
  ok('a part far outside the model is left where it is', far.moves.length === 0);
  ok('and it is still reported as detached',
    P.findIssues(far.parts).some((i) => i.code === 'detached' && i.partId === 'stray'));

  // Symmetry survives the repair.
  const pair = P.assemble({
    nodes: [
      box('fuselage', { params: { width: 2, height: 0.5, depth: 0.5 } }),
      box('wing', { position: [1.4, 0, 0], mirror: true, params: { width: 0.5, height: 0.08, depth: 1.2 } }),
    ],
  }, { ground: false });
  const left = pair.parts.find((p) => p.id === 'wing');
  const right = pair.parts.find((p) => p.mirroredFrom === 'wing');
  ok('a mirrored pair is still a pair after connecting', !!left && !!right);
  ok('and it is still exactly opposite',
    near(left.position[0], -right.position[0]) &&
    near(left.position[1], right.position[1]) &&
    near(left.position[2], right.position[2]));

  // The repair never changes what the model is made of.
  const plan = {
    nodes: [
      box('body', { params: { width: 2, height: 0.6, depth: 0.6 } }),
      box('tail', { position: [-1.3, 0.3, 0], params: { width: 0.3, height: 0.3, depth: 0.2 } }),
      box('fin', { position: [-1.25, 0.7, 0], params: { width: 0.2, height: 0.4, depth: 0.1 } }),
    ],
  };
  const built = P.assemble(plan, { ground: false });
  ok('the part count is unchanged', built.parts.length === 3);
  ok('every id survives',
    ['body', 'tail', 'fin'].every((id) => built.parts.some((p) => p.id === id)));
  ok('the moves it made are reported', Array.isArray(built.moves));
  ok('and counted', typeof built.stats.connected === 'number');

  // Determinism: the same plan twice is the same model twice.
  const a = P.assemble(plan, { ground: false });
  const b = P.assemble(plan, { ground: false });
  ok('the same plan assembles the same way twice',
    JSON.stringify(a.parts) === JSON.stringify(b.parts));

  // Opting out shows what the design call actually produced.
  const raw = P.assemble(plan, { ground: false, connect: false });
  ok('connect:false leaves every gap where it was', raw.stats.connected === 0);

  // The pass terminates and does not re-move the same part to no effect.
  const messy = P.connectParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('a', { position: [1.6, 0, 0], params: { width: 0.3, height: 0.3, depth: 0.3 } }),
    box('b', { position: [0, 0.9, 0], params: { width: 0.3, height: 0.3, depth: 0.3 } }),
    box('c', { position: [0, 0, 0.9], params: { width: 0.3, height: 0.3, depth: 0.3 } }),
  ]);
  const movedIds = messy.moves.map((m) => m.partId);
  ok('no part is moved twice in one repair', movedIds.length === new Set(movedIds).size);
  ok('every gap it accepted was actually closed',
    !P.findIssues(messy.parts).some((i) => i.code === 'detached'));

  // A repair closes the gap. It does not leave one tolerance of daylight —
  // the tolerance says how far apart two parts may be and still count as
  // joined, and aiming at it left every repaired part hanging visibly short of
  // the thing it was joined to.
  const seam = P.connectParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('cap', { position: [1.4, 0, 0], params: { width: 0.4, height: 0.4, depth: 0.4 } }),
  ]);
  {
    const bodyBox = P.partBox(seam.parts.find((p) => p.id === 'body'));
    const capBox = P.partBox(seam.parts.find((p) => p.id === 'cap'));
    const daylight = capBox[0] - bodyBox[3];
    ok('the repaired part actually meets the body', daylight <= 1e-9,
      `left ${daylight.toFixed(4)} of daylight`);
    ok('and is not buried in it', daylight > -0.05, `overlaps by ${(-daylight).toFixed(4)}`);
  }

  // A part can attach to something that only just attached itself.
  const chain = P.connectParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('arm', { position: [1.7, 0, 0], params: { width: 0.4, height: 0.2, depth: 0.2 } }),
    box('hand', { position: [2.3, 0, 0], params: { width: 0.3, height: 0.2, depth: 0.2 } }),
  ]);
  ok('a chain of parts is walked outwards from the body',
    !P.findIssues(chain.parts).some((i) => i.code === 'detached'));
}

console.log('\nParts that pass the contact test but still show a seam are seated in:');
{
  // 0.04 apart: inside the 0.06 tolerance, so connectParts calls this model
  // connected and never touches it — and a person sees a line of floor
  // through the join.
  const before = [
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('fin', { position: [1.24, 0, 0], params: { width: 0.4, height: 0.6, depth: 0.1 } }),
  ];
  const gapBefore = P.partBox(before[1])[0] - P.partBox(before[0])[3];
  ok('the case starts inside the contact tolerance', gapBefore > 0 && gapBefore < 0.06,
    `gap was ${gapBefore.toFixed(4)}`);
  ok('and connecting leaves it exactly there',
    near(P.connectParts(before).parts[1].position[0], 1.24));

  const seated = P.seatParts(before);
  const bodyBox = P.partBox(seated.parts.find((p) => p.id === 'body'));
  const finBox = P.partBox(seated.parts.find((p) => p.id === 'fin'));
  ok('seating closes it', finBox[0] < bodyBox[3], `gap left: ${(finBox[0] - bodyBox[3]).toFixed(4)}`);
  ok('into an overlap, not onto the boundary', bodyBox[3] - finBox[0] > 0);
  ok('and not by more than a hair', bodyBox[3] - finBox[0] <= 0.06);
  ok('the small part is the one that moved', !near(finBox[0], P.partBox(before[1])[0]));
  ok('the body stayed where it was', near(seated.parts[0].position[0], 0));
  ok('the move is reported', seated.seams.length === 1 && seated.seams[0].partId === 'fin');

  // Two parts already sharing space have no seam to close.
  const solid = P.seatParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('nose', { position: [1.0, 0, 0], params: { width: 0.4, height: 0.4, depth: 0.4 } }),
  ]);
  ok('a model that already overlaps is left alone', solid.seams.length === 0);

  // A part standing well clear is a separate piece, and connectParts owns that
  // decision. Seating must not quietly drag it in.
  const apart = P.seatParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('spare', { position: [4, 0, 0] }),
  ]);
  ok('a part standing well clear is not dragged in', apart.seams.length === 0);

  // Closing one side of a mirrored pair and not the other is how a symmetric
  // model comes out lopsided.
  const pair = P.seatParts([
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('finL', { position: [1.24, 0, 0], params: { width: 0.4, height: 0.6, depth: 0.1 } }),
    box('finR', { position: [-1.24, 0, 0], params: { width: 0.4, height: 0.6, depth: 0.1 }, mirroredFrom: 'finL' }),
  ]);
  const L = pair.parts.find((p) => p.id === 'finL');
  const R = pair.parts.find((p) => p.id === 'finR');
  ok('a mirrored pair is seated on both sides', near(L.position[0], -R.position[0]));
  ok('and both actually moved', !near(L.position[0], 1.24));

  ok('every id survives seating', P.seatParts(before).parts.map((p) => p.id).join() === 'body,fin');
  ok('seating the same plan twice gives the same answer',
    JSON.stringify(P.seatParts(before).parts) === JSON.stringify(P.seatParts(before).parts));
  ok('a seated model is stable under a second pass',
    P.seatParts(seated.parts).seams.length === 0);

  const full = P.assemble({ name: 'fish', nodes: before }, { ground: false });
  ok('assemble runs the seating pass', full.stats.seated === 1);
  ok('and connect:false switches it off too',
    P.assemble({ name: 'fish', nodes: before }, { ground: false, connect: false }).stats.seated === 0);
}

console.log('\nA shape the app does not have is read, not thrown away:');
{
  // Every one of these used to become a one-unit box, silently. A design that
  // had described an egg, a pipe and a ring arrived as three identical cubes.
  ok('a shape it knows is left alone', P.resolveType({ type: 'lathe' }).type === 'lathe');
  ok('and reported as unchanged', P.resolveType({ type: 'lathe' }).from === null);
  ok('an ellipsoid is a sphere', P.resolveType({ type: 'ellipsoid' }).type === 'sphere');
  ok('a pipe is a cylinder', P.resolveType({ type: 'tube' }).type === 'cylinder');
  ok('a ring is a torus', P.resolveType({ type: 'ring' }).type === 'torus');
  ok('a pyramid is a cone', P.resolveType({ type: 'pyramid' }).type === 'cone');
  ok('a revolve is a lathe', P.resolveType({ type: 'revolve' }).type === 'lathe');
  ok('case and spacing do not matter', P.resolveType({ type: 'Rounded Box' }).type === 'box');
  ok('a substitution says what it was', P.resolveType({ type: 'ellipsoid' }).from === 'ellipsoid');

  // The part that carries its own geometry is the expensive one to lose.
  ok('vertex positions mean a mesh',
    P.resolveType({ type: 'fish_body', params: { positions: [0,0,0, 1,0,0, 0,1,0] } }).type === 'mesh');
  ok('a list of two-number points means a silhouette',
    P.resolveType({ type: 'fin_shape', params: { points: [[0,0],[1,0],[0,1]] } }).type === 'extrude');
  ok('a part that says nothing usable is a box',
    P.resolveType({ type: 'thingummy', params: {} }).type === 'box');
  ok('and a missing type is one too', P.resolveType({}).type === 'box');
  ok('every shape the app builds is accepted',
    [...P.SHAPES].every((t) => P.resolveType({ type: t }).type === t));
}

console.log('\nA pairing the plan already states survives:');
{
  // Mirroring writes this field on the twin it makes, and connecting reads it
  // to move a pair together. A design that arrived already paired lost the
  // link here, so its pair was the one case neither stage could see.
  const paired = [
    box('body', { params: { width: 2, height: 1, depth: 1 } }),
    box('wingL', { position: [0.9, 0, 0.4] }),
    box('wingR', { position: [-0.9, 0, 0.4], mirroredFrom: 'wingL' }),
  ];
  const kept = P.normaliseParts(paired).parts;
  ok('the pairing is carried through normalising',
    kept.find((p) => p.id === 'wingR').mirroredFrom === 'wingL');
  ok('a part that states no pairing gets none',
    kept.find((p) => p.id === 'wingL').mirroredFrom === undefined);
  ok('a pairing that is not a name is ignored',
    P.normaliseParts([box('a', { mirroredFrom: 7 })]).parts[0].mirroredFrom === undefined);
  ok('an already-paired part is not mirrored again',
    P.expandMirrors(kept).parts.length === kept.length);
  ok('and assembling keeps the pairing',
    P.assemble({ nodes: paired }, { ground: false }).parts
      .find((p) => p.id === 'wingR').mirroredFrom === 'wingL');
}

console.log('\nOne part becomes many, placed exactly:');
{
  const hub = box('tooth', { position: [1, 0, 0], params: { width: 0.2, height: 0.2, depth: 0.2 } });

  const around = P.expandRepeats([{ ...hub, repeat: { count: 4, about: 'y' } }]);
  ok('a full turn makes the count asked for', around.parts.length === 4);
  ok('the original does not move', near(around.parts[0].position[0], 1) && near(around.parts[0].position[2], 0));
  // Four around a full turn is a quarter each. Divided by one less it would be
  // a third, and the last copy would land on top of the first.
  ok('a full turn divides by the count', near(around.parts[1].position[2], -1, 1e-9),
    `got z ${around.parts[1].position[2]}`);
  ok('and comes back round to the start', near(around.parts[3].position[2], 1, 1e-9));
  ok('every copy is the same distance from the axis',
    around.parts.every((p) => near(Math.hypot(p.position[0], p.position[2]), 1, 1e-9)));
  ok('each copy is turned as well as moved', near(around.parts[1].rotation[1], Math.PI / 2));
  ok('the copies are named apart', new Set(around.parts.map((p) => p.id)).size === 4);
  ok('and each says what it came from', around.parts[3].repeatedFrom === 'tooth');
  ok('the request does not survive, so a second pass does not repeat it',
    P.expandRepeats(around.parts).parts.length === 4);

  // A fan of blades: the last one should land ON the angle asked for.
  const fan = P.expandRepeats([{ ...hub, repeat: { count: 3, about: 'y', angle: 180 } }]);
  ok('a partial sweep divides by one less', near(fan.parts[2].position[0], -1, 1e-9),
    `the last copy should sit at 180 degrees, got x ${fan.parts[2].position[0]}`);

  const line = P.expandRepeats([{ ...hub, repeat: { count: 4, along: [0.5, 0, 0] } }]);
  ok('a line steps by the step', near(line.parts[2].position[0], 2));
  ok('and does not turn anything', near(line.parts[2].rotation[1], 0));

  ok('turning about x moves the other two axes',
    near(P.expandRepeats([{ ...box('a', { position: [0, 1, 0] }), repeat: { count: 4, about: 'x' } }]).parts[1].position[2], 1, 1e-9));
  ok('turning about z likewise',
    near(P.expandRepeats([{ ...box('a', { position: [1, 0, 0] }), repeat: { count: 4, about: 'z' } }]).parts[1].position[1], 1, 1e-9));

  // Everything that can be asked for and should not be built.
  ok('a count of one is not a repeat',
    P.expandRepeats([{ ...hub, repeat: { count: 1, about: 'y' } }]).issues.some((i) => i.code === 'repeat-count'));
  ok('a repeat with no axis is reported',
    P.expandRepeats([{ ...hub, repeat: { count: 4 } }]).issues.some((i) => i.code === 'repeat-axis'));
  ok('a step of nothing is reported rather than stacking copies',
    P.expandRepeats([{ ...hub, repeat: { count: 4, along: [0, 0, 0] } }]).issues.some((i) => i.code === 'repeat-axis'));
  ok('a part on the axis it turns about is reported',
    P.expandRepeats([{ ...box('c', { position: [0, 0.5, 0] }), repeat: { count: 4, about: 'y' } }])
      .issues.some((i) => i.code === 'repeat-on-axis'));
  ok('a count past the limit is capped, not obeyed',
    P.expandRepeats([{ ...hub, repeat: { count: 5000, about: 'y' } }]).parts.length === P.MAX_REPEAT);
  ok('and the cap is reported',
    P.expandRepeats([{ ...hub, repeat: { count: 5000, about: 'y' } }]).issues.some((i) => i.code === 'repeat-capped'));
  ok('a part with no repeat is untouched',
    P.expandRepeats([hub]).parts.length === 1 && P.expandRepeats([hub]).issues.length === 0);
  ok('repeating is deterministic',
    JSON.stringify(P.expandRepeats([{ ...hub, repeat: { count: 6, about: 'y' } }]).parts)
      === JSON.stringify(P.expandRepeats([{ ...hub, repeat: { count: 6, about: 'y' } }]).parts));
}

console.log('\nThe assembler runs the arithmetic, then the repeats, then the mirrors:');
{
  const plan = {
    vars: { teeth: 6, r: 1 },
    nodes: [
      box('hub', { params: { width: 1, height: 0.4, depth: 1 } }),
      box('tooth', { position: ['r', 0, 0], params: { width: 0.3, height: 0.3, depth: 0.3 }, repeat: { count: 'teeth', about: 'y' } }),
    ],
  };
  const out = P.assemble(plan, { ground: false });
  ok('a count may itself be arithmetic', out.stats.repeated === 5, `made ${out.stats.repeated} extra`);
  // The repair passes move one part at a time. Done to a ring, each member
  // moves a different amount and the ring stops being a ring — the repair
  // destroys the regularity that made it worth writing as a pattern.
  const teeth = out.parts.filter((p) => p.id.startsWith('tooth'));
  ok('a position may be a variable', teeth.length === 6);
  ok('and repairing never deforms a pattern',
    teeth.every((p) => near(Math.hypot(p.position[0], p.position[2]), 1, 1e-9)),
    teeth.map((p) => Math.hypot(p.position[0], p.position[2]).toFixed(3)).join(' '));
  ok('a pattern that does not reach the body is reported instead',
    out.issues.some((i) => i.code === 'detached'),
    'a silently deformed gear is not something anyone can fix');
  ok('the repeated parts are counted separately from the ones received',
    out.stats.received === 2 && out.parts.length === 7);

  // Repeat before mirror: each copy gets a twin, not one twin of one copy.
  const both = P.assemble({
    nodes: [box('fin', { position: [0.8, 0, 0.5], repeat: { count: 2, along: [0, 0, -1] }, mirror: true })],
  }, { ground: false });
  ok('a part that repeats and mirrors gives a pair of each copy', both.parts.length === 4);

  ok('a size written as arithmetic comes back worked out',
    P.assemble({ sizeMm: 'd * 2', vars: { d: 24 }, nodes: [box('a')] }, { ground: false }).sizeMm === 48,
    'the assembler is the only place arithmetic is resolved, so it has to hand this back');
  ok('a size written as a number is untouched',
    P.assemble({ sizeMm: 95, nodes: [box('a')] }, { ground: false }).sizeMm === 95);
  ok('an expression that cannot be worked out is reported by the assembler',
    P.assemble({ nodes: [box('a', { position: ['nope', 0, 0] })] }, { ground: false })
      .issues.some((i) => i.code === 'bad-expression'));
}

console.log('\nA part\'s box is the box its geometry actually occupies:');
{
  // Every expected value below was READ OUT of the real geometry the app
  // builds, in a browser, by constructing each shape the way the viewport
  // constructs it and taking its bounding box. They are not derived from the
  // same arithmetic they are checking — that would only prove it agrees with
  // itself, and two of these were wrong for exactly that reason.
  const boxOf = (type, params, extra = {}) => P.partBox({
    id: 't', name: 't', type, role: 'structure',
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params, ...extra,
  }).map((v) => Math.round(v * 1e4) / 1e4);
  const same = (a, b, tol = 1e-3) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

  ok('a box', same(boxOf('box', { width: 1, height: 2, depth: 3 }), [-0.5, -1, -1.5, 0.5, 1, 1.5]));
  ok('a sphere', same(boxOf('sphere', { radius: 0.7 }), [-0.7, -0.7, -0.7, 0.7, 0.7, 0.7]));
  ok('a cylinder', same(boxOf('cylinder', { radius: 0.5, height: 1.6 }), [-0.5, -0.8, -0.5, 0.5, 0.8, 0.5]));
  ok('a cone', same(boxOf('cone', { radius: 0.6, height: 1.2 }), [-0.6, -0.6, -0.6, 0.6, 0.6, 0.6]));
  ok('a capsule is its length plus a cap at each end',
    same(boxOf('capsule', { radius: 0.2, length: 1.0 }), [-0.2, -0.7, -0.2, 0.2, 0.7, 0.2]));

  // A ring is drawn in the XY plane. This was the other way round, so every
  // ring in the app reported a box at right angles to the shape on screen.
  ok('a ring stands in the XY plane, thin through Z',
    same(boxOf('torus', { radius: 0.8, tube: 0.15 }), [-0.95, -0.95, -0.15, 0.95, 0.95, 0.15]));

  ok('a revolved profile reaches its radius all the way round',
    same(boxOf('lathe', { points: [[0.2, -0.5], [0.5, 0], [0.2, 0.5]] }), [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));
  // A profile can sit anywhere. Taking the largest absolute value described a
  // shape mirrored about the axis rather than the one that exists.
  ok('and a profile that does not straddle the origin is not assumed to',
    same(boxOf('lathe', { points: [[0.2, 0], [0.4, 0.5], [0.2, 1]] }), [-0.4, 0, -0.4, 0.4, 1, 0.4]));

  // Extruding runs from the profile plane FORWARDS.
  ok('an extrusion runs from the profile plane forwards, not half back',
    same(boxOf('extrude', { points: [[-0.4, -0.3], [0.4, -0.3], [0, 0.5]], depth: 0.6 }),
      [-0.4, -0.3, 0, 0.4, 0.5, 0.6]));
  ok('and its profile is not assumed symmetric either',
    same(boxOf('extrude', { points: [[0, 0], [1, 0], [1, 0.4]], depth: 0.2 }), [0, 0, 0, 1, 0.4, 0.2]));

  ok('a supplied mesh is measured where its vertices are',
    same(boxOf('mesh', { positions: [0, 0, 0, 2, 0, 0, 0, 1, 0] }), [0, 0, 0, 2, 1, 0]));

  // The offset has to turn with the part, or a fin rotated onto another axis
  // leaves its box behind facing the way it started.
  const turned = boxOf('extrude', { points: [[-0.4, -0.4], [0.4, -0.4], [0, 0.4]], depth: 1 }, { rotation: [0, Math.PI / 2, 0] });
  ok('an off-centre part turns its box with it', same(turned, [0, -0.4, -0.4, 1, 0.4, 0.4]),
    `got ${turned.join(', ')}`);
  ok('and scales it', same(
    boxOf('extrude', { points: [[-0.4, -0.4], [0.4, -0.4], [0, 0.4]], depth: 1 }, { scale: [1, 1, 2] }),
    [-0.4, -0.4, 0, 0.4, 0.4, 2]));

  ok('a shape the app does not build is still given a size',
    boxOf('mystery', {}).every(Number.isFinite));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/model-plan.js)\n`);
process.exit(fail ? 1 : 0);
