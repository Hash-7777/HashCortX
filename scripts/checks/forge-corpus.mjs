// ==============================================================
// Forge corpus score
//
// The number this app did not have. Every plan in scripts/corpus/ is run
// through the real assembler and scored by the real scorer, and the mean is
// ratcheted: it may go up, and it may not go down.
//
// Why this exists. Sixteen hundred checks could tell us the code was wired
// correctly and none of them could tell us whether the models were any good, so
// every change to the design prompt or the geometry was settled by looking at a
// screenshot and having an opinion. This turns that into a number that either
// moves or does not.
//
// What the corpus is, honestly. These are written plans, not recordings of a
// model's output — no key is spent to run this, and it works offline and on any
// machine, which is what lets it be a gate. So it measures OUR pipeline: the
// normalising, mirroring, connecting, seating and grounding that every design
// passes through. It does not measure how good a particular language model is
// at geometry. To measure that, save a real run's plan from Forge and drop it
// in beside these as another entry — the format is the same, and the check
// picks it up with no code change.
//
// Two numbers are printed for each entry: the plan as written, and the plan
// after the assembler has had it. The gap between them is what our
// deterministic stage is worth, which is a thing worth watching on its own —
// if a change makes the assembler stop earning its keep, that shows here.
//
// Run with: npm run check:forge-corpus
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'model-plan.js'], ['src', 'js', 'forge', 'units.js'], ['src', 'js', 'forge', 'measure.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel[rel.length - 1] });
}
const MP = sandbox.window.HCModelPlan;
const M = sandbox.window.HCForgeMeasure;
const U = sandbox.window.HCForgeUnits;

// ── The ratchet ───────────────────────────────────────────────────────
//
// Raise this when the mean rises, the way the file-size budgets are lowered
// when a file shrinks, and say in the comment what earned it. Never lower it to
// make a change pass: a change that drops the mean has made the models worse,
// which is the entire thing this file exists to catch.
//
// 90.9 — the first measurement. Fourteen plans: nine that should score well,
// and five that are wrong in one named way each, so the number has somewhere to
// move in both directions.
//
// It is high because the measurements that will pull it down do not exist yet.
// Watertightness, wall thickness and overhangs cannot be measured until a model
// is one solid, so today's score judges a plan's structure and nothing about
// whether the object could be made. Expect this floor to FALL once when those
// arrive, and to be re-set from the first honest reading — that is the one time
// lowering it is right, and the comment must say so.
// 91.7, up from 90.9. Every model is now normalised to one working span before
// the assembler runs, so the contact tolerance is the same proportion of every
// model instead of 1% of a big one and 5% of a small one. The plan that had
// fallen into eighteen pieces came back with nine of them rejoined rather than
// five — the assembler had always been able to do that and had been quietly
// stricter with models that happened to arrive large.
const MEAN_FLOOR = 91.7;

const dir = join(root, 'scripts', 'corpus');
const entries = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!entry.id || !entry.plan) throw new Error(`${f} has no id or no plan`);
    return entry;
  });

if (!entries.length) {
  console.log('\n  FAIL  the corpus is empty\n');
  process.exit(1);
}

/**
 * What the app actually builds: the design, then the deterministic stage.
 *
 * The working span is passed exactly as the mode passes it. A gate that scored
 * a pipeline the app does not run would be measuring a fiction, and the first
 * change to diverge would sail through it.
 */
function assembled(plan) {
  const out = MP.assemble(plan, { ground: false, targetSize: U.WORKING_SPAN });
  return { name: plan.name, nodes: out.parts };
}

let fail = 0;
const rows = entries.map((entry) => {
  const before = M.score(entry.plan);
  const after = M.score(assembled(entry.plan));
  return { id: entry.id, prompt: entry.prompt, note: entry.note, before, after };
});

console.log('\nEvery plan in the corpus, worst first:\n');
console.log('  score  gain   parts  what it is');
console.log('  ─────  ─────  ─────  ──────────────────────────────────────────');
for (const row of [...rows].sort((a, b) => a.after.score - b.after.score)) {
  const gain = row.after.score - row.before.score;
  const gainText = gain > 0.05 ? `+${gain.toFixed(1)}` : gain < -0.05 ? gain.toFixed(1) : '  ·  ';
  console.log(
    `  ${row.after.score.toFixed(1).padStart(5)}  ${gainText.padStart(5)}  ` +
    `${String(row.after.facts.parts).padStart(5)}  ${row.id} — ${row.prompt}`
  );
  for (const issue of row.after.issues) console.log(`                        · ${issue.code}: ${issue.detail}`);
}

const mean = Math.round((rows.reduce((s, r) => s + r.after.score, 0) / rows.length) * 10) / 10;
const meanBefore = Math.round((rows.reduce((s, r) => s + r.before.score, 0) / rows.length) * 10) / 10;

console.log('\nWhat each measurement is worth across the corpus:\n');
for (const m of M.MEASURES) {
  const scored = rows.filter((r) => r.after.measures.find((x) => x.id === m.id)?.applicable);
  const avg = scored.length
    ? scored.reduce((s, r) => s + r.after.measures.find((x) => x.id === m.id).value, 0) / scored.length
    : 0;
  const bar = '█'.repeat(Math.round(avg * 20)).padEnd(20, '·');
  console.log(`  ${bar}  ${(avg * 100).toFixed(0).padStart(3)}%  ${m.label}` +
    (scored.length < rows.length ? `  (${scored.length} of ${rows.length} plans)` : ''));
}

console.log('\nThe number:\n');
console.log(`  as designed          ${meanBefore.toFixed(1)}`);
console.log(`  after the assembler  ${mean.toFixed(1)}   (the deterministic stage is worth ${(mean - meanBefore).toFixed(1)})`);
console.log(`  floor                ${MEAN_FLOOR.toFixed(1)}`);

// A score computed twice must be the same score, or the ratchet is noise.
const again = Math.round((entries.reduce((s, e) => s + M.score(assembled(e.plan)).score, 0) / entries.length) * 10) / 10;
if (again !== mean) {
  console.log(`\n  FAIL  scoring the corpus twice gave ${again} then ${mean} — the scorer is not deterministic`);
  fail++;
}

if (mean < MEAN_FLOOR) {
  console.log(`\n  FAIL  the corpus mean fell to ${mean.toFixed(1)}, floor is ${MEAN_FLOOR.toFixed(1)} — this change made the models worse`);
  fail++;
} else if (mean > MEAN_FLOOR) {
  console.log(`\n  ok    the mean rose to ${mean.toFixed(1)} — good, now raise the floor to ${mean.toFixed(1)} and say what earned it`);
} else {
  console.log('\n  ok    the corpus holds its score');
}

console.log(`\n${entries.length} plans scored, ${fail} failure(s)  (scripts/corpus/)\n`);
process.exit(fail ? 1 : 0);
