// ==============================================================
// Forge printability checks
//
// Loads the REAL modules and walks real solids.
//
// This is the file that decides whether a person is told their model will print
// or not, so every rule here builds a shape whose answer is known by hand: a
// slab of a stated thickness must report that thickness, a cube resting on the
// bed has nothing to support, a wedge leaning past forty-five degrees does.
//
// It also runs the whole corpus and prints the pass rate, which is the number
// worth publishing. That is at the bottom, after the rules.
//
// Run with: npm run check:forge-print
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [
  ['src', 'js', 'forge', 'expr.js'],
  ['src', 'js', 'model-plan.js'],
  ['src', 'js', 'forge', 'units.js'],
  ['src', 'js', 'forge', 'field.js'],
  ['src', 'js', 'forge', 'surface.js'],
  ['src', 'js', 'forge', 'printable.js'],
]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel[rel.length - 1] });
}
const MP = sandbox.window.HCModelPlan;
const U = sandbox.window.HCForgeUnits;
const F = sandbox.window.HCForgeField;
const S = sandbox.window.HCForgeSurface;
const P = sandbox.window.HCForgePrintable;

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
const report = (parts, opts = {}) => {
  const field = F.buildField(parts);
  const mesh = S.extract(field, { resolution: opts.resolution || 48 });
  return { mesh, field, report: P.assess(mesh, field, { mmPerUnit: opts.mmPerUnit ?? 10, ...opts }) };
};

console.log('\nA wall is as thick as it is:');
{
  // A slab half a unit thick, at ten millimetres a unit, is five millimetres.
  const slab = report([part('box', { width: 4, height: 0.5, depth: 4 })], { resolution: 48 });
  ok('a slab reports its own thickness', within(slab.report.facts.minWallMm, 5, 0.12),
    `${slab.report.facts.minWallMm?.toFixed(2)} against 5`);
  ok('and that is not mistaken for its width', slab.report.facts.minWallMm < 10);

  const thinner = report([part('box', { width: 4, height: 0.09, depth: 4 })], { resolution: 64 });
  ok('a thinner slab reports thinner', thinner.report.facts.minWallMm < slab.report.facts.minWallMm);
  ok('and a wall under the nozzle is called out',
    thinner.report.findings.some((f) => f.code === 'thin-wall'));
  ok('the finding says what it was judged against',
    /1\.2 mm/.test(thinner.report.findings.find((f) => f.code === 'thin-wall')?.detail || ''));
  // The plain minimum is dominated by sharp edges, where marching inward
  // crosses almost nothing. An edge is not a wall.
  ok('a sharp corner is not mistaken for a thin wall',
    report([part('box', { width: 2, height: 2, depth: 2 })]).report.facts.minWallMm > 15,
    'a solid cube has no thin wall anywhere, whatever its corners measure');
  ok('a thick enough wall is not called out',
    !slab.report.findings.some((f) => f.code === 'thin-wall'));

  // The limits belong to the printer, not to us.
  const strict = P.assess(slab.mesh, slab.field, { mmPerUnit: 10, limits: { minWallMm: 20 } });
  ok('the limit a caller states is the limit used',
    strict.findings.some((f) => f.code === 'thin-wall'));
  ok('and it is carried in the report', strict.limits.minWallMm === 20);
}

console.log('\nWhat hangs over nothing:');
{
  const cube = report([part('box', { width: 2, height: 2, depth: 2 })]);
  // A little, at the edges, where the extracted normals round off. What matters
  // is that it stays under the share worth telling anyone about.
  ok('a cube on the bed needs no support', cube.report.facts.overhangShare < 0.02,
    `${(cube.report.facts.overhangShare * 100).toFixed(1)}% overhanging`);
  ok('and nothing is reported', !cube.report.findings.some((f) => f.code === 'overhangs'));

  // A ball has a whole lower hemisphere, most of which leans past 45 degrees.
  const ball = report([part('sphere', { radius: 1 })]);
  ok('a ball has a great deal hanging over nothing', ball.report.facts.overhangShare > 0.2,
    `${(ball.report.facts.overhangShare * 100).toFixed(1)}%`);
  ok('and it is reported', ball.report.findings.some((f) => f.code === 'overhangs'));
  ok('a cone standing on its base needs no support',
    report([part('cone', { radius: 1, height: 2 })]).report.facts.overhangShare < 0.35);
}

console.log('\nOne object, or several pretending to be one:');
{
  const one = report([part('box', { width: 2, height: 2, depth: 2 })]);
  ok('a single body is one body', one.report.facts.shells === 1);
  ok('and nothing is reported', !one.report.findings.some((f) => f.code === 'loose-pieces'));

  // The failure nobody sees: it slices, it prints, and it comes off the bed in
  // pieces.
  const apart = report([
    part('box', { width: 1, height: 1, depth: 1 }, { id: 'a', position: [-2, 0, 0] }),
    part('box', { width: 1, height: 1, depth: 1 }, { id: 'b', position: [2, 0, 0] }),
  ]);
  ok('two objects are counted as two', apart.report.facts.shells === 2);
  ok('and said plainly', /2 separate objects/.test(
    apart.report.findings.find((f) => f.code === 'loose-pieces')?.detail || ''));

  const touching = report([
    part('box', { width: 2, height: 1, depth: 1 }, { id: 'a' }),
    part('box', { width: 2, height: 1, depth: 1 }, { id: 'b', position: [1.5, 0, 0] }),
  ]);
  ok('two that overlap are one', touching.report.facts.shells === 1);
}

console.log('\nNothing is refused, and nothing is guessed:');
{
  const cube = report([part('box', { width: 2, height: 2, depth: 2 })]);
  ok('a model that would print says so', cube.report.ok === true);
  ok('a warning does not stop it',
    report([part('sphere', { radius: 1 })]).report.ok === true,
    'supports are a thing to know about, not a refusal');

  const nothing = P.assess({ positions: new Float32Array(0), indices: new Uint32Array(0) }, null, {});
  ok('an empty mesh is stopped rather than passed', nothing.ok === false);
  ok('and says why', nothing.findings.some((f) => f.code === 'no-model'));

  // Without a scale, a measurement in millimetres would be a made-up number.
  const unitless = P.assess(cube.mesh, cube.field, {});
  ok('with no scale it does not pretend to millimetres', unitless.facts.hasUnits === false);
  ok('and does not judge a wall it cannot measure',
    !unitless.findings.some((f) => f.code === 'thin-wall'));

  ok('the same model reports the same twice',
    JSON.stringify(P.assess(cube.mesh, cube.field, { mmPerUnit: 10 }).findings)
      === JSON.stringify(P.assess(cube.mesh, cube.field, { mmPerUnit: 10 }).findings));
}

console.log('\nThe one line a person reads before pressing export:');
{
  const cube = report([part('box', { width: 2, height: 2, depth: 2 })]);
  const line = P.summarise(cube.report);
  ok('it says the size', /mm/.test(line));
  ok('it says it is one solid', /one solid/.test(line));
  ok('and whether supports are needed', /support/.test(line), line);
  ok('it is one line', !line.includes('\n') && line.length < 120, line);
  console.log(`        “${line}”`);

  const two = report([
    part('box', { width: 1, height: 1, depth: 1 }, { id: 'a', position: [-2, 0, 0] }),
    part('box', { width: 1, height: 1, depth: 1 }, { id: 'b', position: [2, 0, 0] }),
  ]);
  ok('and it says when it is not one solid', /2 separate pieces/.test(P.summarise(two.report)));
  console.log(`        “${P.summarise(two.report)}”`);
}

// ── the number worth publishing ───────────────────────────────────────
//
// Every plan in the corpus, assembled and fused exactly as the app does it,
// then asked whether it would print. Raise the floor when it rises and say what
// earned it. This is slower than the other checks because it walks a field for
// every model, which is why it is worth having and why it is its own command.
const PASS_FLOOR = 15;

console.log('\nEvery corpus model, fused and asked whether it would print:\n');
let printable = 0;
let watertight = 0;
const rows = [];
for (const file of readdirSync(join(root, 'scripts', 'corpus')).filter((f) => f.endsWith('.json'))) {
  const entry = JSON.parse(readFileSync(join(root, 'scripts', 'corpus', file), 'utf8'));
  const out = MP.assemble(entry.plan, { ground: false, targetSize: U.WORKING_SPAN });
  const field = F.buildField(out.parts);
  const mesh = S.extract(field, {});
  const size = Math.max(...MP.sizeOf(MP.boundsOf(out.parts)));
  const mmPerUnit = U.mmPerUnit(U.sizeMmOf({ sizeMm: out.sizeMm }).mm, size);
  const r = P.assess(mesh, field, { mmPerUnit });
  const clean = mesh.stats.openEdges === 0 && mesh.stats.foldedEdges === 0;
  if (clean) watertight++;
  if (r.ok && clean) printable++;
  rows.push({ id: entry.id, clean, ok: r.ok, line: P.summarise(r), findings: r.findings });
}
for (const row of rows.sort((a, b) => Number(a.clean) - Number(b.clean) || a.id.localeCompare(b.id))) {
  console.log(`  ${(row.clean && row.ok ? 'ok  ' : 'warn').padEnd(5)} ${row.id.padEnd(11)} ${row.line}`);
  for (const f of row.findings) if (f.level !== 'note') console.log(`                    · ${f.code}: ${f.detail}`);
}

console.log(`\n  ${watertight} of ${rows.length} fuse into one watertight body`);
console.log(`  ${printable} of ${rows.length} would print as they stand`);
if (printable < PASS_FLOOR) {
  console.log(`\n  FAIL  ${printable} is below the floor of ${PASS_FLOOR} — this change made models less printable`);
  fail++;
} else if (printable > PASS_FLOOR) {
  console.log(`\n  ok    ${printable} is above the floor of ${PASS_FLOOR} — raise it and say what earned it`);
} else {
  console.log('\n  ok    the corpus holds its pass rate');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/printable.js)\n`);
process.exit(fail ? 1 : 0);
