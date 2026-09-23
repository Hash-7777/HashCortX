// ==============================================================
// Preparing a design — checks
//
// Loads the REAL src/js/forge/prepare.js with the gate, the arithmetic and the
// assembler it runs, into a Node VM.
//
// The rule held here: the same object comes out the same whatever unit it was
// written in. A design may arrive in millimetres, in metres or in units of
// nothing at all, and every fixed number the pipeline once judged a design by
// before bringing it to size made one of those units wrong. The one that was
// found cost a chair its shape: a limit of 12 on positions, meant as scene
// units, pulled every part of a millimetre design to within 12 mm of the centre.
// So every plan in the corpus is written again a thousand times larger and a
// thousand times smaller, and must build the same model.
//
// Run with: npm run check:forge-prepare
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of ['forge/expr.js', 'model-plan.js', 'forge/units.js', 'forge/plan-normalize.js', 'forge/prepare.js']) {
  vm.runInContext(readFileSync(join(root, 'src', 'js', ...rel.split('/')), 'utf8'), sandbox, { filename: rel });
}
const { HCForgePrepare: PREP, HCModelPlan: MP, HCForgeUnits: U } = sandbox.window;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const prepare = (plan, prompt = '') => PREP.preparePlan(plan, { prompt, targetSize: U.WORKING_SPAN });

/**
 * The same design at k times the size. Scaling a part's scale rather than its
 * parameters grows every kind of shape — profiles and meshes included — without
 * this file having to know which parameters are lengths.
 */
function writtenAt(written, k, { asSums = false } = {}) {
  // A plan written in named values is worked out first, so its lengths are
  // numbers this can multiply.
  const plan = sandbox.window.HCForgeExpr.resolvePlan(written).plan;
  const len = (v) => (asSums ? `${v * k * 4} / 4` : v * k);
  return {
    ...plan,
    vars: undefined,
    nodes: plan.nodes.map((n) => ({
      ...n,
      position: (n.position || [0, 0, 0]).map(len),
      scale: (n.scale || [1, 1, 1]).map((v) => v * k),
      ...(n.blend !== undefined ? { blend: n.blend * k } : {}),
      ...(n.repeat && Array.isArray(n.repeat.along) ? { repeat: { ...n.repeat, along: n.repeat.along.map((v) => v * k) } } : {}),
    })),
  };
}

/** Largest difference between two prepared models, as a share of the scene. */
function difference(a, b) {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  a.forEach((p, i) => {
    const q = b[i];
    if (p.id !== q.id) worst = Infinity;
    for (const key of ['position', 'scale']) {
      for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(p[key][j] - q[key][j]));
    }
    // A scale of 1e-3 against one of 1 is as different as a position, so the
    // box each part occupies is compared too.
    const pb = MP.partBox(p);
    const qb = MP.partBox(q);
    for (let j = 0; j < 6; j++) worst = Math.max(worst, Math.abs(pb[j] - qb[j]));
    worst = Math.max(worst, Math.abs((p.blend || 0) - (q.blend || 0)));
  });
  return worst / U.WORKING_SPAN;
}

console.log('The same object comes out the same in any unit:');
const corpus = readdirSync(join(root, 'scripts', 'corpus')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(root, 'scripts', 'corpus', f), 'utf8')));
for (const entry of corpus) {
  const base = prepare(entry.plan, entry.prompt);
  const codes = (r) => r.report.issues.map((i) => `${i.code}:${i.partId || ''}`).sort().join(',');
  for (const [label, k, asSums] of [['a thousand times larger', 1000, false], ['a thousand times smaller', 0.001, false], ['larger, with every position a sum', 1000, true]]) {
    const other = prepare(writtenAt(entry.plan, k, { asSums }), entry.prompt);
    const d = difference(base.plan.nodes, other.plan.nodes);
    ok(`${entry.id}, written ${label}, builds the same model`, d < 1e-6, `differs by ${d}`);
    ok(`${entry.id}, written ${label}, is corrected the same way`,
      codes(base) === codes(other) && JSON.stringify(base.report.removed) === JSON.stringify(other.report.removed),
      `${codes(base)} / ${codes(other)}`);
  }
}

console.log('\nA chair written in millimetres keeps its legs at the corners:');
{
  const chair = {
    name: 'chair', sizeMm: 900,
    vars: { seat: 450, top: 30, leg: 20, height: 450, back: 420 },
    nodes: [
      { id: 'seat', type: 'box', position: [0, 'height + top / 2', 0], params: { width: 'seat', depth: 'seat', height: 'top' } },
      { id: 'back', type: 'box', position: [0, 'height + top + back / 2', '-(seat / 2 - 10)'], params: { width: 'seat', depth: 20, height: 'back' } },
      { id: 'leg', type: 'cylinder', position: ['seat / 2 - leg', 'height / 2', 'seat / 2 - leg'], params: { radius: 'leg', height: 'height' }, repeat: { count: 4, about: 'y' } },
    ],
  };
  const out = prepare(chair, 'a chair');
  const byId = Object.fromEntries(out.plan.nodes.map((n) => [n.id, n]));
  const seatHalf = MP.halfExtents(byId.seat)[0];
  const corners = ['leg', 'leg_r1', 'leg_r2', 'leg_r3'].map((id) => byId[id].position);
  ok('all four legs are there', corners.every(Boolean));
  ok('every leg stands under the edge of the seat, not its middle',
    corners.every((p) => Math.abs(Math.abs(p[0]) - seatHalf) < seatHalf * 0.15 && Math.abs(Math.abs(p[2]) - seatHalf) < seatHalf * 0.15));
  ok('the four legs are at four different corners', new Set(corners.map((p) => `${Math.sign(p[0])}${Math.sign(p[2])}`)).size === 4);
  ok('the back sits behind the seat', byId.back.position[2] < -seatHalf * 0.8);
  ok('no position was pulled in', !out.report.issues.some((i) => i.code === 'coordinate-clamped'));

  // Control: the same design under the old fixed limit of 12 is the cross the
  // chair used to arrive as. If this ever passes, the control is no longer
  // reproducing the defect and the checks above need looking at.
  const gate = sandbox.window.HCForgePlanNormalize.normalizePlan(chair);
  const old = MP.normaliseParts(gate.nodes, { coordLimit: 12 });
  ok('control: a fixed limit of 12 pulls the legs to the middle',
    old.parts.find((p) => p.id === 'leg').position[0] === 12 && old.issues.some((i) => i.code === 'coordinate-clamped'));
}

console.log('\nA runaway position is still pulled in, measured against the design:');
{
  const parts = (far) => [
    { id: 'body', type: 'box', position: [0, 0, 0], params: { width: 400, height: 400, depth: 400 } },
    { id: 'stray', type: 'box', position: [far, 0, 0], params: { width: 50, height: 50, depth: 50 } },
  ];
  const out = MP.normaliseParts(parts(1e7));
  ok('a part a hundred kilometres out on a 400 mm design is pulled in', out.parts[1].position[0] === MP.COORD_REACH * 200);
  ok('and it is reported', out.issues.some((i) => i.code === 'coordinate-clamped' && i.partId === 'stray'));
  ok('a part 2 m out on the same design is left where it is', MP.normaliseParts(parts(2000)).parts[1].position[0] === 2000);
}

console.log('\nA rounding resizes with the model:');
{
  const plan = (blend, k) => ({ nodes: [
    { id: 'a', type: 'box', position: [0, 0, 0], params: { width: k, height: k, depth: k } },
    { id: 'b', type: 'box', position: [0, k, 0], params: { width: k / 2, height: k, depth: k / 2 }, blend },
  ] });
  const unit = prepare(plan(0.1, 1)).plan.nodes.find((n) => n.id === 'b').blend;
  const mm = prepare(plan(100, 1000)).plan.nodes.find((n) => n.id === 'b').blend;
  ok('the same rounding written in millimetres reaches the same share of the model', Math.abs(unit - mm) < 1e-12, `${unit} / ${mm}`);
  ok('and it is a share of the model, not the number that was written', unit < 0.2 && Math.abs(unit - 0.1 * (U.WORKING_SPAN / 2)) < 1e-9);
}

console.log('\nOne subject, and centred without breaking a mirror:');
{
  const cube = (id, x, extra = {}) => ({ id, type: 'box', position: [x, 0, 0], params: { width: 1, height: 1, depth: 1 }, ...extra });
  const pile = { nodes: [cube('a', 0), cube('b', 1), cube('c', 2), cube('d', 3), cube('far', 40)] };
  const one = prepare(pile, 'a bench');
  ok('a part far from the main body is removed', one.report.removed.includes('far') && !one.plan.nodes.some((n) => n.id === 'far'));
  ok('and nothing else is', one.plan.nodes.length === 4);
  ok('a removed part is not also reported as left where it was', !one.report.issues.some((i) => i.code === 'detached' && i.partId === 'far'));
  ok('a prompt asking for several things keeps it', prepare(pile, 'two benches').plan.nodes.some((n) => n.id === 'far'));
  const box = MP.boundsOf(one.plan.nodes);
  ok('the model is centred on X and Z', Math.abs(box[0] + box[3]) < 1e-9 && Math.abs(box[2] + box[5]) < 1e-9);

  // One wing wider than the other: the box is off-centre, but the pair must stay
  // opposite about the plane it was mirrored across.
  const bird = prepare({ nodes: [
    cube('body', 0, { params: { width: 1, height: 1, depth: 3 } }),
    cube('wing', 2, { params: { width: 3, height: 0.2, depth: 1 }, mirror: 'x' }),
    cube('tail', 0.5, { position: [0.5, 0, -2], params: { width: 2, height: 0.2, depth: 1 } }),
  ] }, 'a bird');
  const wing = bird.plan.nodes.find((n) => n.id === 'wing');
  const twin = bird.plan.nodes.find((n) => n.id === 'wing_mirrored');
  ok('a mirrored pair stays exactly opposite after centring', Math.abs(wing.position[0] + twin.position[0]) < 1e-12);
}

console.log('\nThe path gives back the plan it was handed, not a stripped copy:');
{
  const out = prepare({ name: 'Mug', sizeMm: '45 * 2', vars: { r: 1 }, nodes: [{ id: 'body', type: 'cylinder', position: [0, 0, 0], params: { radius: 'r', height: 2 } }] });
  ok('the worked-out size comes back', out.plan.sizeMm === 90);
  ok('the vars come back', out.plan.vars?.r === 1);
  ok('nothing is reported empty', out.empty === false);
  const empty = prepare({ nodes: [{ id: 'flat', type: 'box', params: { width: 0, height: 0, depth: 0 } }] });
  ok('a design with nothing measurable says so rather than handing back no parts', empty.empty === true && empty.plan.nodes.length === 1);
}

console.log('\nEverything the assembler finds reaches the trace:');
{
  // Read the codes out of the assembler itself, so a new kind of finding added
  // there without a line here fails rather than vanishing from the run.
  const assembler = readFileSync(join(root, 'src', 'js', 'model-plan.js'), 'utf8');
  const codes = [...new Set([...assembler.matchAll(/code: "([a-z-]+)"/g)].map((m) => m[1]))];
  ok('the assembler raises findings this can read', codes.length >= 10, codes.join(', '));
  for (const code of codes) {
    ok(`"${code}" is said in words or deliberately left to the viewport`, !!PREP.FINDINGS[code] || PREP.UNREPORTED.has(code));
  }
  const lines = PREP.describeIssues([
    { code: 'coordinate-clamped', partId: 'leg', detail: '1e7 → 4800' },
    { code: 'coordinate-clamped', partId: 'arm', detail: '-9e6 → -4800' },
    { code: 'repeat-on-axis', partId: 'tooth', detail: 'sits on the axis' },
    { code: 'off-floor', detail: 'lowest point' },
    { code: 'something-new', partId: 'x' },
  ]);
  ok('one line per kind of finding', lines.length === 3);
  ok('it counts them', /^2 position\(s\)/.test(lines[0].text));
  ok('and names every part in the detail', lines[0].detail.includes('leg') && lines[0].detail.includes('arm'));
  ok('the floor is left to the viewport', !lines.some((l) => l.code === 'off-floor'));
  ok('a kind with no words still reaches the trace, under its code', lines.some((l) => l.code === 'something-new' && /something-new/.test(l.text)));
}

console.log('\nA design that does not hold together is not called finished:');
{
  const issue = (code, partId = 'p') => ({ code, partId });
  const nodes = (n) => ({ nodes: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) });
  ok('an outline part with no outline is a fault', PREP.faultsOf([], { ...nodes(2), shapeSubstitutions: ['body: extrude with no outline → box'] }).length === 1);
  ok('copies stacked on their own axis are a fault', PREP.faultsOf([issue('repeat-on-axis')], nodes(2)).length === 1);
  ok('most parts floating free is a fault, a few is not', PREP.faultsOf([issue('detached'), issue('detached'), issue('detached')], nodes(4)).length === 1 && PREP.faultsOf([issue('detached')], nodes(4)).length === 0);
  ok('flat alone is not a fault — a coaster is meant to be flat', PREP.faultsOf([issue('flat')], nodes(3)).length === 0);
  ok('... but is named when something else is wrong too', PREP.faultsOf([issue('flat'), issue('repeat-on-axis')], nodes(3)).length === 2);
  ok('a sound design has none', PREP.faultsOf([], nodes(5)).length === 0 && PREP.faultsOf(undefined, undefined).length === 0);
  const mode = readFileSync(new URL('../../src/modes/forge/mode.js', import.meta.url), 'utf8');
  ok('the run asks once more with the reasons, and never says "complete" over one that still fails',
    /for \(let pass = 1; pass <= \(useSample \? 1 : 2\); pass\+\+\)/.test(mode) && /The last design for this did not hold together: \$\{faults\.join/.test(mode)
    && /if \(faults\.length\) log\("Orchestrator", `Finished, but the design does not hold together/.test(mode));
  ok('... and of the two designs, the one with fewer faults is kept', /if \(!best \|\| faults\.length < best\.faults\.length\) best = \{ plan, faults \};/.test(mode));
  ok('the design is asked for as JSON, which a local model is held to', /\], onToken, signal, \{ json: true \}\);/.test(mode) && /ollamaChat\(model, messages, null, s, \{ json: true \}\)/.test(mode));
  ok('the design call says what each shape needs', /What each shape needs in "params"/.test(mode) && /lathe: "points" \[\[r, y\]/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/prepare.js)`);
process.exit(fail ? 1 : 0);
