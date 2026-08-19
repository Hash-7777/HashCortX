// ==============================================================
// Assembly-mote checks
//
// Loads the REAL src/js/assembly-motes.js into a Node VM and samples the paths
// it produces. An effect cannot be judged by a unit test, but the properties
// that made the old one look wrong can all be measured:
//
//   · a mote belongs to the part it is building, so it starts near it
//   · it actually arrives, exactly, rather than near enough
//   · it closes in rather than wandering
//   · it is invisible at both ends, so it merges instead of winking out
//   · every mote lands inside the part's own reveal
//   · the same seed gives the same gathering, so what is seen can be repeated
//
// Run with: npm run check:assembly-motes
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'assembly-motes.js'), 'utf8');
const sandbox = { window: {}, Math };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'assembly-motes.js' });
const A = sandbox.window.HCAssemblyMotes;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const len = (p) => Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
const radial = (p) => Math.sqrt(p.x * p.x + p.z * p.z);
const samples = (n = 41) => Array.from({ length: n }, (_, i) => i / (n - 1));

console.log('\nThe module is there:');
ok('HCAssemblyMotes is published', !!A);
ok('planMotes is callable', typeof A?.planMotes === 'function');

const PLAN = { count: 18, radius: 1.4, total: 760, seed: 7 };
const motes = A.planMotes(PLAN);

console.log('\nA gathering is laid out around the part:');
{
  ok('it makes the number asked for', motes.length === 18);
  ok('no mote starts on top of the part', motes.every((m) => m.radius > 0));
  ok('and none starts further out than asked, by much',
    motes.every((m) => m.radius <= PLAN.radius * 1.3));
  const angles = motes.map((m) => ((m.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  const half = angles.filter((a) => a < Math.PI).length;
  ok('they surround it rather than bunching on one side', half >= 6 && half <= 12, `${half}/18 on one side`);
  const above = motes.filter((m) => m.y > 0).length;
  ok('and come from above and below alike', above >= 5 && above <= 13, `${above}/18 above`);
  ok('none is asked for before the part starts', motes.every((m) => m.delay >= 0));
  ok('every one lands inside the part’s own reveal',
    motes.every((m) => m.delay + m.life <= PLAN.total + 1e-9));
  ok('and each has time to travel', motes.every((m) => m.life > 0));
}

console.log('\nA mote closes in on the part and arrives:');
{
  const m = motes[0];
  const start = A.moteAt(m, 0);
  const end = A.moteAt(m, 1);
  ok('it starts out at its radius', Math.abs(radial(start) - m.radius) < 1e-9);
  ok('it ends exactly on the part', len(end) < 1e-9, `ended ${len(end).toFixed(6)} away`);

  // Closing in, not wandering: the distance never grows.
  const dists = samples().map((t) => radial(A.moteAt(m, t)));
  const grew = dists.slice(1).filter((d, i) => d > dists[i] + 1e-12).length;
  ok('the gap never widens on the way in', grew === 0, `${grew} steps grew`);

  // It should sweep, or it is just a straight line in.
  const a0 = Math.atan2(A.moteAt(m, 0).z, A.moteAt(m, 0).x);
  const a1 = Math.atan2(A.moteAt(m, 0.5).z, A.moteAt(m, 0.5).x);
  ok('it sweeps round rather than coming straight in', Math.abs(a1 - a0) > 0.2);

  // Height settles before the radius does, so it comes level then in.
  const midY = Math.abs(A.moteAt(m, 0.5).y);
  ok('height is mostly settled by halfway', midY < Math.abs(m.y) * 0.5);
}

console.log('\nIt is invisible at both ends:');
{
  for (const m of motes) {
    const o = samples().map((t) => A.moteAt(m, t).opacity);
    if (o[0] > 1e-9 || o[o.length - 1] > 1e-9) { ok('every mote fades in and out', false, 'one did not'); break; }
  }
  ok('every mote fades in and out',
    motes.every((m) => A.moteAt(m, 0).opacity < 1e-9 && A.moteAt(m, 1).opacity < 1e-9));
  ok('and is fully visible in between',
    motes.every((m) => A.moteAt(m, 0.45).opacity > 0.9));
  ok('opacity never leaves 0..1',
    motes.every((m) => samples().every((t) => { const v = A.moteAt(m, t).opacity; return v >= 0 && v <= 1; })));
  ok('nothing is drawn at a negative size',
    motes.every((m) => samples().every((t) => A.moteAt(m, t).scale >= 0)));
  ok('and nothing is left to draw at the end',
    motes.every((m) => A.moteAt(m, 1).scale < 1e-9));
}

console.log('\nNothing produces a number that is not one:');
{
  const odd = [0, 0.0001, 0.5, 0.9999, 1, -1, 2, NaN, undefined, null, '0.5'];
  ok('every sample is finite, including nonsense times',
    motes.every((m) => odd.every((t) => {
      const p = A.moteAt(m, t);
      return [p.x, p.y, p.z, p.opacity, p.scale].every(Number.isFinite);
    })));
  ok('a plan with no motes is not an error', A.planMotes({ count: 0 }).length === 0);
  ok('nor is a plan with nothing given', Array.isArray(A.planMotes()));
  ok('a nonsense radius falls back rather than producing NaN',
    A.planMotes({ count: 2, radius: -5 }).every((m) => Number.isFinite(m.radius) && m.radius > 0));
}

console.log('\nThe same seed gives the same gathering:');
{
  const a = JSON.stringify(A.planMotes(PLAN));
  const b = JSON.stringify(A.planMotes(PLAN));
  ok('twice with one seed is identical', a === b);
  ok('a different seed is a different gathering',
    a !== JSON.stringify(A.planMotes({ ...PLAN, seed: 8 })));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/assembly-motes.js)\n`);
process.exit(fail ? 1 : 0);
