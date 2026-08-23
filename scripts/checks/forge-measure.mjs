// ==============================================================
// Forge measurement checks
//
// Loads the REAL src/js/model-plan.js and src/js/forge/measure.js into a Node
// VM and holds the scorer to the only property that makes it worth having: it
// must say the same thing about the same model every time, and it must go down
// when a model gets worse for a reason a person would recognise.
//
// A scorer nobody trusts is worse than no scorer, because a number invites
// decisions. So each rule below builds a model that is wrong in exactly one
// way, and asks whether the score noticed that and nothing else.
//
// Run with: npm run check:forge-measure
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [['src', 'js', 'model-plan.js'], ['src', 'js', 'forge', 'measure.js']]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel[rel.length - 1] });
}
const M = sandbox.window.HCForgeMeasure;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const measureOf = (result, id) => result.measures.find((m) => m.id === id);
const hasIssue = (result, code) => result.issues.some((i) => i.code === code);

const part = (id, extra = {}) => ({
  id, name: id, type: 'lathe', role: 'structure',
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  params: { points: [[0.3, -0.5], [0.5, 0], [0.3, 0.5]] },
  ...extra,
});
const box = (id, position, size, extra = {}) => part(id, {
  type: 'box', position,
  params: { width: size[0], height: size[1], depth: size[2] },
  ...extra,
});

// A model that is right: six parts, all sharing space, shapes that carry form.
const goodModel = [
  part('body', { position: [0, 0, 0], scale: [2, 1, 1] }),
  part('head', { type: 'capsule', position: [1.1, 0.2, 0], params: { radius: 0.35, length: 0.5 } }),
  part('tail', { type: 'extrude', position: [-1.1, 0, 0], params: { points: [[0, 0], [-0.4, 0.4], [-0.4, -0.4]], depth: 0.2 } }),
  part('finL', { type: 'extrude', position: [0.1, -0.1, 0.28], params: { points: [[0, 0], [-0.3, 0.25], [-0.3, -0.1]], depth: 0.1 } }),
  part('finR', { type: 'extrude', position: [0.1, -0.1, -0.28], params: { points: [[0, 0], [-0.3, 0.25], [-0.3, -0.1]], depth: 0.1 } }),
  part('eye', { type: 'sphere', position: [1.2, 0.35, 0.12], params: { radius: 0.12 } }),
];

console.log('\nThe scorer says the same thing every time:');
{
  const a = M.score(goodModel);
  const b = M.score(goodModel);
  ok('the same model scores the same twice', a.score === b.score, `${a.score} then ${b.score}`);
  ok('and every measurement matches',
    JSON.stringify(a.measures) === JSON.stringify(b.measures));
  ok('the score is a number between 0 and 100',
    Number.isFinite(a.score) && a.score >= 0 && a.score <= 100, `got ${a.score}`);
  ok('one decimal place, so a float cannot move it',
    near(a.score, Math.round(a.score * 10) / 10));
  ok('a model that is right scores well', a.score >= 80, `scored ${a.score}`);
  ok('and it reports no faults', a.issues.length === 0, JSON.stringify(a.issues));
  ok('an empty plan scores zero', M.score([]).score === 0);
  ok('and says why', hasIssue(M.score([]), 'empty'));
}

console.log('\nA model in pieces scores below one that is whole:');
{
  const whole = M.score(goodModel);
  const adrift = M.score([...goodModel, box('spare', [8, 0, 0], [0.4, 0.4, 0.4])]);
  ok('a part standing well clear pulls the score down', adrift.score < whole.score,
    `${adrift.score} vs ${whole.score}`);
  ok('the one-body measurement is what moved', measureOf(adrift, 'oneBody').value < 1);
  ok('it is reported as loose', hasIssue(adrift, 'loose-parts'));
  ok('and the count of separate pieces is right', adrift.facts.components === 2);
  ok('a model in one piece has one component', whole.facts.components === 1);
}

console.log('\nParts that only approach each other are not one object:');
{
  // 0.04 apart: inside the contact tolerance, so it passes as attached — and
  // still shows a line of daylight through the join.
  const seam = [
    box('body', [0, 0, 0], [2, 1, 1]),
    box('fin', [1.24, 0, 0], [0.4, 0.6, 0.1]),
  ];
  const r = M.score(seam);
  ok('the seam is counted', measureOf(r, 'joined').value < 1, `joined ${measureOf(r, 'joined').value}`);
  ok('but the parts still count as one body', measureOf(r, 'oneBody').value === 1);
  ok('and the seam is reported', hasIssue(r, 'seams'));

  const solid = M.score([box('body', [0, 0, 0], [2, 1, 1]), box('fin', [1.0, 0, 0], [0.4, 0.6, 0.1])]);
  ok('parts sharing space score full marks', measureOf(solid, 'joined').value === 1);
  ok('and nothing is reported', !hasIssue(solid, 'seams'));
}

console.log('\nA design answered in blocks is marked down, but a crate is not:');
{
  const blocks = [0, 1, 2, 3, 4, 5].map((i) => box(`b${i}`, [i * 0.5, 0, 0], [0.6, 0.6, 0.6]));
  const r = M.score(blocks);
  ok('all blocks scores low on shape', measureOf(r, 'shaped').value === 0);
  ok('and it is reported', hasIssue(r, 'placeholders'));
  ok('the good model scores full marks on shape', measureOf(M.score(goodModel), 'shaped').value === 1);

  // A third plain is normal — an eye, a knob, a foot — and must not be a fault.
  const mixed = [...goodModel];
  const r2 = M.score(mixed);
  ok('one plain part among six is not a fault', !hasIssue(r2, 'placeholders'));
}

console.log('\nSymmetry is judged only where the plan claims a pair:');
{
  const paired = [
    box('body', [0, 0, 0], [2, 1, 1]),
    box('wingL', [0.6, 0, 0.5], [0.5, 0.1, 0.6]),
    box('wingR', [-0.6, 0, 0.5], [0.5, 0.1, 0.6], { mirroredFrom: 'wingL' }),
  ];
  const exact = M.score(paired);
  ok('an exact pair scores full marks', measureOf(exact, 'symmetry').value === 1);
  ok('and the pair is counted', exact.facts.symmetricPairs === 1);
  ok('the measurement applies', measureOf(exact, 'symmetry').applicable);

  const off = JSON.parse(JSON.stringify(paired));
  off[2].position[0] = -0.9;
  const wrong = M.score(off);
  ok('a pair that does not match is marked down', measureOf(wrong, 'symmetry').value < 1);
  ok('and reported', hasIssue(wrong, 'asymmetric'));
  ok('the whole score falls with it', wrong.score < exact.score);

  const none = M.score([box('a', [0, 0, 0], [1, 1, 1]), box('b', [0.8, 0, 0], [1, 1, 1])]);
  ok('a model with no pair is not judged on symmetry', !measureOf(none, 'symmetry').applicable);
  const symmetryWeight = M.MEASURES.find((m) => m.id === 'symmetry').weight;
  ok('and gets no free marks for it — the weight is shared out',
    none.measures.filter((m) => m.applicable).reduce((s, m) => s + m.weight, 0) === 100 - symmetryWeight);
}

console.log('\nThe part count reads as a model, or it does not:');
{
  ok('six parts is full marks', measureOf(M.score(goodModel), 'partCount').value === 1);
  const two = M.score([box('a', [0, 0, 0], [1, 1, 1]), box('b', [0.8, 0, 0], [1, 1, 1])]);
  ok('two parts is not a model', measureOf(two, 'partCount').value < 1);
  const many = Array.from({ length: 40 }, (_, i) => box(`p${i}`, [i * 0.4, 0, 0], [0.5, 0.5, 0.5]));
  ok('forty parts is a pile', measureOf(M.score(many), 'partCount').value < 1);
  const twenty = Array.from({ length: 20 }, (_, i) => box(`p${i}`, [i * 0.4, 0, 0], [0.5, 0.5, 0.5]));
  ok('twenty is still inside the band', measureOf(M.score(twenty), 'partCount').value === 1);
}

console.log('\nParts that cannot be built, and parts from another object:');
{
  const tiny = [...goodModel, box('nothing', [0, 0, 0], [0, 0, 0])];
  const r = M.score(tiny);
  ok('a part with no size is counted', measureOf(r, 'wellFormed').value < 1);
  ok('and reported', hasIssue(r, 'degenerate'));

  const spread = [
    box('body', [0, 0, 0], [2, 2, 2]),
    box('speck', [1, 0, 0], [0.005, 0.005, 0.005]),
  ];
  const s = M.score(spread);
  ok('a part hundreds of times smaller than the body is a units mistake',
    measureOf(s, 'scaleCoherence').value < 1, `spread ${s.facts.scaleSpread.toFixed(1)}`);
  ok('and it is reported', hasIssue(s, 'scale-spread'));
  ok('the good model is coherent', measureOf(M.score(goodModel), 'scaleCoherence').value === 1);
}

console.log('\nGeometry hidden inside a copy of itself is counted:');
{
  // Nothing else notices this. A ring of teeth whose spacing is divided the
  // wrong way puts the last copy on top of the first: still one body, parts
  // still overlap, shapes still shapes — a gear with a tooth missing, scoring
  // full marks.
  const twin = [
    box('body', [0, 0, 0], [2, 1, 1]),
    box('lug', [1.0, 0, 0], [0.4, 0.4, 0.4]),
    box('lug_copy', [1.0, 0, 0], [0.4, 0.4, 0.4]),
  ];
  const r = M.score(twin);
  ok('a part sitting on top of one just like it is counted', r.facts.duplicates === 1);
  ok('the measurement falls', measureOf(r, 'distinct').value < 1);
  ok('and it is reported', hasIssue(r, 'duplicates'));
  ok('the whole score falls with it', r.score < M.score(twin.slice(0, 2)).score);

  ok('a part merely near another is not a duplicate',
    M.score([box('body', [0, 0, 0], [2, 1, 1]), box('lug', [1.0, 0, 0], [0.4, 0.4, 0.4]),
             box('other', [1.0, 0.5, 0], [0.4, 0.4, 0.4])]).facts.duplicates === 0);
  ok('and neither is a part of a different size in the same place',
    M.score([box('body', [0, 0, 0], [2, 1, 1]), box('lug', [0, 0, 0], [0.2, 0.2, 0.2])]).facts.duplicates === 0);
  ok('a model with nothing duplicated scores full marks',
    measureOf(M.score(goodModel), 'distinct').value === 1);
}

console.log('\nA corpus is scored as a whole, worst first:');
{
  const set = [
    { id: 'good', prompt: 'a fish', plan: goodModel },
    { id: 'blocks', prompt: 'a fish', plan: [0, 1, 2, 3, 4].map((i) => box(`b${i}`, [i * 0.5, 0, 0], [0.6, 0.6, 0.6])) },
    { id: 'adrift', prompt: 'a fish', plan: [...goodModel, box('spare', [9, 0, 0], [0.4, 0.4, 0.4])] },
  ];
  const all = M.scoreAll(set);
  ok('every entry is scored', all.rows.length === 3);
  ok('the worst is first', all.rows[0].score <= all.rows[1].score && all.rows[1].score <= all.rows[2].score);
  ok('each row keeps its name', all.rows.every((r) => r.id && r.prompt));
  const mean = Math.round((all.rows.reduce((s, r) => s + r.score, 0) / 3) * 10) / 10;
  ok('the mean is the mean', near(all.mean, mean, 0.05), `${all.mean} vs ${mean}`);
  ok('scoring the corpus twice gives the same mean', M.scoreAll(set).mean === all.mean);
  ok('an empty corpus is zero, not an error', M.scoreAll([]).mean === 0);
}

console.log('\nThe weights are stated once, and add up:');
{
  ok('the weights total 100', M.MEASURES.reduce((s, m) => s + m.weight, 0) === 100);
  ok('every measurement has a label a person can read',
    M.MEASURES.every((m) => typeof m.label === 'string' && m.label.length > 8));
  ok('every measurement is scored', M.MEASURES.every((m) => measureOf(M.score(goodModel), m.id)));
  ok('the scorer refuses to guess what the prompt wanted',
    !readFileSync(join(root, 'src', 'js', 'forge', 'measure.js'), 'utf8').includes('prompt.'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/measure.js)\n`);
process.exit(fail ? 1 : 0);
