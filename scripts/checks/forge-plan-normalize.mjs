// ==============================================================
// Plan-normalising checks
//
// Loads the REAL src/js/forge/plan-normalize.js, and the real assembler beside
// it, into a Node VM.
//
// This is the gate every Forge design passes through, and it rebuilds each
// node from a fixed list of fields. A field missing from that list is dropped
// in silence: nothing throws, the feature just stops happening. Mirroring,
// repeats and cut-out holes have each been lost that way. The field guard
// below is the point of this file — it fails when the list loses a field,
// rather than waiting for someone to notice their model is not symmetrical.
//
// Run with: npm run check:forge-plan-normalize
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

function load({ withAssembler = true } = {}) {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  if (withAssembler) vm.runInContext(src('js', 'model-plan.js'), sandbox, { filename: 'model-plan.js' });
  // Sizes come from units.js. Leaving it out skips every size field, so a
  // green run here proved nothing about them — which is exactly how the
  // defaulted-size bug below survived one.
  vm.runInContext(src('js', 'forge', 'units.js'), sandbox, { filename: 'units.js' });
  vm.runInContext(src('js', 'forge', 'plan-normalize.js'), sandbox, { filename: 'plan-normalize.js' });
  return sandbox.window.HCForgePlanNormalize;
}

const N = load();

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// A node with every field the plan format carries, each set to something that
// is not the default, so a dropped field shows up as a changed value.
const FULL_NODE = {
  id: 'wing_l',
  name: 'Left wing',
  type: 'cylinder',
  role: 'detail',
  position: [1, 2, 3],
  rotation: [0.1, 0.2, 0.3],
  scale: [2, 3, 4],
  params: { radius: 5, height: 9 },
  color: '#ff0000',
  opacity: 0.5,
  mirror: 'y',
  mirroredFrom: 'wing_r',
  mirroredOn: 'z',
  hasMirror: true,
  repeat: { count: 4, spacing: 2 },
  repeatedFrom: 'rib_1',
  op: 'subtract',
  blend: 0.25,
};

const FULL_PLAN = {
  name: 'Glider',
  _introLogo: true,
  glbUrl: 'model.glb',
  vars: { span: 120 },
  hollowMm: 3,
  madeBy: { model: 'some-model', at: 'a time' },
  constraints: [{ kind: 'touching', a: 'wing_l', b: 'body' }],
  edges: [['wing_l', 'body']],
  nodes: [FULL_NODE],
};

console.log('Every field a design carries survives the gate:');
{
  const out = N.normalizePlan(FULL_PLAN);
  const node = out.nodes[0];
  for (const [key, want] of Object.entries(FULL_NODE)) {
    ok(`node keeps ${key}`, JSON.stringify(node[key]) === JSON.stringify(want));
  }
  for (const key of ['name', '_introLogo', 'glbUrl', 'vars', 'hollowMm', 'madeBy', 'constraints', 'edges']) {
    ok(`plan keeps ${key}`, JSON.stringify(out[key]) === JSON.stringify(FULL_PLAN[key]));
  }
}

console.log('\nA plan is unchanged by being read a second time:');
{
  // Saved projects are normalised again every time they are opened. A field
  // that survives the first pass but not the second is a model that changes
  // shape on reopening.
  for (const label of ['with the assembler loaded', 'with the assembler missing']) {
    const M = load({ withAssembler: label.includes('loaded') });
    const once = M.normalizePlan(FULL_PLAN);
    const twice = M.normalizePlan(once);
    const thrice = M.normalizePlan(twice);
    ok(`${label}: reading twice gives the same plan`, JSON.stringify(once) === JSON.stringify(twice));
    ok(`${label}: and a third time`, JSON.stringify(twice) === JSON.stringify(thrice));
    ok(`${label}: the mirror plane survives every pass`,
      once.nodes[0].mirror === 'y' && twice.nodes[0].mirror === 'y' && thrice.nodes[0].mirror === 'y');
  }

  // Control: the standby reader used to honour `true` and nothing else, so it
  // read its own output — a plane name — as "not mirrored". If this control
  // ever passes, that mistake is back.
  const oldStandby = (value) => (value === true ? 'x' : null);
  ok('control: honouring only `true` loses the plane on the second read',
    oldStandby(oldStandby(true)) === null);
}

console.log('\nMirroring is read the way the assembler reads it:');
{
  ok('`true` still means the x plane', N.normalizePlan({ nodes: [{ mirror: true }] }).nodes[0].mirror === 'x');
  for (const axis of ['x', 'y', 'z']) {
    ok(`a node may name the ${axis} plane`, N.normalizePlan({ nodes: [{ mirror: axis }] }).nodes[0].mirror === axis);
  }
  ok('an upper-case plane name is read', N.normalizePlan({ nodes: [{ mirror: 'Y' }] }).nodes[0].mirror === 'y');
  ok('a plane that does not exist is not mirrored', N.normalizePlan({ nodes: [{ mirror: 'w' }] }).nodes[0].mirror === false);
  ok('no mirror field means not mirrored', N.normalizePlan({ nodes: [{}] }).nodes[0].mirror === false);
}

console.log('\nWhat a model writes is not trusted:');
{
  ok('a plan that is not an object becomes an empty one', N.normalizePlan('nonsense').nodes.length === 0);
  ok('null becomes an empty plan', N.normalizePlan(null).nodes.length === 0);
  ok('an array is not treated as a plan', N.normalizePlan([1, 2, 3]).nodes.length === 0);
  ok('nodes that are not a list are ignored', N.normalizePlan({ nodes: 'lots' }).nodes.length === 0);
  ok('a node that is not an object still becomes a node', N.normalizePlan({ nodes: [null] }).nodes.length === 1);
  ok('a nameless node is given a name', N.normalizePlan({ nodes: [{}] }).nodes[0].name === 'Node 1');
  ok('a nameless node is given an id', N.normalizePlan({ nodes: [{}] }).nodes[0].id === 'node_1');
  ok('a role that does not exist becomes structure', N.normalizePlan({ nodes: [{ role: 'wizard' }] }).nodes[0].role === 'structure');
  ok('an operation that does not exist is dropped', N.normalizePlan({ nodes: [{ op: 'explode' }] }).nodes[0].op === undefined);
  ok('a short position list falls back rather than half-reading',
    JSON.stringify(N.normalizePlan({ nodes: [{ position: [1, 2] }] }).nodes[0].position) === '[0,0,0]');
  ok('text in a position becomes zero, not not-a-number',
    JSON.stringify(N.normalizePlan({ nodes: [{ position: ['a', 'b', 'c'] }] }).nodes[0].position) === '[0,0,0]');
  ok('vars given as a list are refused', N.normalizePlan({ vars: [1] }).vars === undefined);
  ok('a hollow wall of zero is not a hollow wall', N.normalizePlan({ hollowMm: 0 }).hollowMm === undefined);
  ok('a negative hollow wall is refused', N.normalizePlan({ hollowMm: -4 }).hollowMm === undefined);
  ok('an enormous hollow wall is capped', N.normalizePlan({ hollowMm: 5000 }).hollowMm === 50);
}

console.log('\nA design cannot ask for more parts than the app will build:');
{
  const many = Array.from({ length: 500 }, (_, i) => ({ id: 'n' + i, type: 'box' }));
  const out = N.normalizePlan({ nodes: many });
  ok(`no more than ${N.MAX_FORGE_NODES} parts are kept`, out.nodes.length === N.MAX_FORGE_NODES);
  ok('the parts kept are the first ones', out.nodes[0].id === 'n0');
}

console.log('\nA shape the app cannot build is reported, not silently cubed:');
{
  const out = N.normalizePlan({ nodes: [{ name: 'Egg', type: 'ovoid' }] });
  ok('the substitution is carried on the plan', out.shapeSubstitutions.length === 1);
  ok('it names the part and what was asked for',
    /Egg/.test(out.shapeSubstitutions[0]) && /ovoid/.test(out.shapeSubstitutions[0]));
  ok('a shape the app can build is not reported',
    N.normalizePlan({ nodes: [{ type: 'torus' }] }).shapeSubstitutions.length === 0);
  ok('every buildable shape passes through unchanged',
    N.SHAPE_NAMES.every((t) => N.normalizePlan({ nodes: [{ type: t }] }).nodes[0].type === t));
}

console.log('\nA size nobody asked for never becomes a size someone chose:');
{
  // The panel says "this size is a default until you set it" while the size is
  // only a default. Normalising fills sizeMm with that default, so on a second
  // pass a plain reading of the field says a size was stated, the note goes,
  // and a part is presented at a size no one picked. Projects are normalised
  // again every time they are opened.
  const noSize = N.normalizePlan({ name: 'Bracket', nodes: [] });
  ok('a design that states no size is marked not stated', noSize.sizeStated === false);
  ok('it is still filled in with a default to build from', noSize.sizeMm > 0);
  const reopened = N.normalizePlan(noSize);
  ok('reopening it does not claim a size was chosen', reopened.sizeStated === false);
  ok('and reopening it again does not either', N.normalizePlan(reopened).sizeStated === false);
  ok('the default size itself does not drift', reopened.sizeMm === noSize.sizeMm);

  const sized = N.normalizePlan({ name: 'Bracket', sizeMm: 50, nodes: [] });
  ok('a design that states a size is marked stated', sized.sizeStated === true);
  ok('and keeps the size it asked for', sized.sizeMm === 50);
  ok('reopening a stated size keeps it stated', N.normalizePlan(sized).sizeStated === true);
  ok('a plan with a size is unchanged by being read again',
    JSON.stringify(sized) === JSON.stringify(N.normalizePlan(sized)));
  ok('a plan without one is too',
    JSON.stringify(noSize) === JSON.stringify(N.normalizePlan(noSize)));

  // Control: working the flag out purely from the filled-in field is what went
  // wrong. If this control ever fails, the field alone has become enough.
  const fromFieldAlone = (plan) => window_stub_stated(plan);
  function window_stub_stated(plan) { return Number(plan.sizeMm) > 0; }
  ok('control: reading the filled-in field alone calls a default a chosen size',
    fromFieldAlone(noSize) === true && noSize.sizeStated === false);
}

console.log('\nA swapped shape is still reported after the plan is read again:');
{
  // A plan is normalised more than once before anything reports on it: the
  // centring pass normalises what it is handed and building normalises again.
  // The second pass sees types already resolved and finds nothing to swap, so
  // starting the list afresh threw away the only record that a shape had been
  // changed — and the app went back to looking incapable of a curve nobody
  // asked it for.
  const first = N.normalizePlan({ name: 'Bits', nodes: [{ name: 'Egg', type: 'ovoid' }, { name: 'Pipe', type: 'tube' }] });
  ok('both swaps are reported the first time', first.shapeSubstitutions.length === 2);
  const second = N.normalizePlan(first);
  ok('reading the plan again keeps both', second.shapeSubstitutions.length === 2);
  ok('and a third reading keeps them', N.normalizePlan(second).shapeSubstitutions.length === 2);
  ok('they are not counted twice', JSON.stringify(second.shapeSubstitutions) === JSON.stringify(first.shapeSubstitutions));
  ok('a plan with swaps is unchanged by being read again',
    JSON.stringify(second) === JSON.stringify(first));
  ok('a plan with nothing swapped still reports nothing',
    N.normalizePlan(N.normalizePlan({ nodes: [{ type: 'box' }] })).shapeSubstitutions.length === 0);
  ok('a substitution list that is not a list is ignored',
    N.normalizePlan({ shapeSubstitutions: 'lots', nodes: [] }).shapeSubstitutions.length === 0);

  // Control: starting the list afresh each time is what lost the warning.
  const freshEachTime = (plan) => ({ ...plan, shapeSubstitutions: [] });
  ok('control: starting the list afresh loses the warning on the second read',
    freshEachTime(first).shapeSubstitutions.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/plan-normalize.js)`);
process.exit(fail ? 1 : 0);
