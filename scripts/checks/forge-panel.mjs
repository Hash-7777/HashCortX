// ==============================================================
// Forge selection panel — checks
//
// Loads the REAL src/js/forge/panel-html.js, with the units and shape tables
// beside it, and builds panels. Everything asserted here is read out of the
// markup the app actually produces.
//
// This replaces matching patterns against the mode's source, which could only
// ever test that a line had been written — not that the panel says the right
// thing for a part that cuts, or a part with no dimensions of its own, or a
// model that has no real size yet.
//
// Run with: npm run check:forge-panel
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const rel of [
  ['src', 'js', 'forge', 'units.js'],
  ['src', 'js', 'forge', 'params.js'],
  ['src', 'js', 'forge', 'panel-html.js'],
]) {
  vm.runInContext(readFileSync(join(root, ...rel), 'utf8'), sandbox, { filename: rel.at(-1) });
}
const H = sandbox.window.HCForgePanelHtml;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The value of one input, by the attribute that names it. */
const valueOf = (html, attr) => {
  const m = new RegExp(`<input [^>]*${attr}[^>]*value="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};
const has = (html, needle) => html.includes(needle);

// A part 20 mm across in a model whose longest side is 100 mm: one scene unit
// is 50 mm, which makes every conversion below arithmetic done in the head.
const MM_PER_UNIT = 50;
const box = { id: 'body', name: 'Body', type: 'box', role: 'structure', params: { width: 0.4, height: 0.4, depth: 0.4 } };
const state = (over = {}) => ({
  plan: { name: 'A model', sizeMm: 100, sizeStated: true },
  measured: { text: '100 × 40 × 40 mm' },
  node: box,
  position: [0.2, 0, 0],
  scale: [1, 1, 1],
  rotationDeg: [0, 45, 0],
  transformMode: 'translate',
  snapEnabled: false,
  mmPerUnit: MM_PER_UNIT,
  ...over,
});

console.log('\nWith nothing selected, the panel holds the size of the whole model:');
{
  const html = H.card(state({ node: null }));
  ok('the longest side is offered', has(html, 'data-frg-model-size'));
  ok('at the size the plan states', valueOf(html, 'data-frg-model-size') === '100');
  ok('and what the model measures is shown', has(html, '100 × 40 × 40 mm'));
  // A model whose size is a silent default is a model that prints wrong.
  ok('a size nobody set says so',
    has(H.card(state({ node: null, plan: { sizeMm: 100, sizeStated: false } })), 'this size is a default'));
  ok('a stated size does not',
    !has(H.card(state({ node: null })), 'this size is a default'));
  ok('with no model at all it says what to do',
    H.card({ node: null }).includes('Click any part in the void'));
}

console.log('\nA selected part shows where it is, in millimetres:');
{
  const html = H.card(state());
  ok('the part is named', has(html, '>Body<'));
  // 0.2 scene units at 50 mm a unit is 10 mm. Shown as the number a person
  // would measure with a ruler, not as a fraction of nothing.
  ok('its position is converted', valueOf(html, 'data-frg-pos="x"') === '10');
  ok('a millimetre is the step, not a twentieth of a scene unit', has(html, 'data-frg-pos="x" type="number" step="1"'));
  ok('the label says so too', has(html, '<label>mm X</label>'));
  ok('rotation is in degrees', valueOf(html, 'data-frg-rot="y"') === '45');
  ok('scale is a plain factor', valueOf(html, 'data-frg-scale="x"') === '1.00');
  ok('it can be renamed', valueOf(html, 'data-frg-name') === 'Body');

  // Without a real size there is nothing to convert to, and a made-up
  // millimetre would be worse than a scene unit honestly labelled.
  const raw = H.card(state({ mmPerUnit: 0 }));
  ok('with no real size, positions stay in scene units', valueOf(raw, 'data-frg-pos="x"') === '0.20');
  ok('and the label does not claim millimetres', has(raw, '<label>Pos X</label>'));
}

console.log("\nAnd the numbers the shape itself is made of:");
{
  const html = H.card(state());
  // 0.4 units at 50 mm a unit is 20 mm.
  ok('a box offers width, height and depth', has(html, 'data-frg-param="width"') && has(html, 'data-frg-param="depth"'));
  ok('in millimetres', valueOf(html, 'data-frg-param="width"') === '20');
  ok('and says so in the label', has(html, '<label>Width (mm)</label>'));

  const cylinder = H.card(state({ node: { id: 'c', name: 'Post', type: 'cylinder', params: { radius: 0.3 } } }));
  // The plan wrote one radius for the whole cylinder. Showing a default beside
  // a part built to something else is the drift this table exists to prevent.
  ok('a cylinder reads the older single radius on both ends',
    valueOf(cylinder, 'data-frg-param="radiusTop"') === '15'
    && valueOf(cylinder, 'data-frg-param="radiusBottom"') === '15');
  ok('and a count is a plain whole number, not a length in millimetres',
    valueOf(cylinder, 'data-frg-param="segments"') === '48' && !has(cylinder, '<label>Sides (mm)</label>'));

  // An empty space reads as a panel that failed.
  const mesh = H.card(state({ node: { id: 'm', name: 'Scan', type: 'mesh', params: {} } }));
  ok('a shape with no dimensions of its own says so rather than showing nothing',
    has(mesh, 'has no dimensions of its own'));
  ok('and does not offer a field that would change nothing', !has(mesh, 'data-frg-param'));
}

console.log('\nWhat a part does to the material, and what follows from it:');
{
  const adding = H.card(state());
  ok('every part offers the three choices',
    has(adding, 'value="union"') && has(adding, 'value="subtract"') && has(adding, 'value="intersect"'));
  ok('a part that says nothing is shown as adding', has(adding, 'value="union" selected'));

  const cutting = H.card(state({ node: { ...box, op: 'subtract' } }));
  ok('a part that cuts is shown as cutting', has(cutting, 'value="subtract" selected'));
  // A number that does nothing is worse than no number.
  ok('the rounded join is offered where a part adds', has(adding, 'data-frg-blend'));
  ok('and not beside a cut, where it would mean nothing', !has(cutting, 'data-frg-blend'));
  ok('a stated join is shown in millimetres',
    valueOf(H.card(state({ node: { ...box, blend: 0.1 } })), 'data-frg-blend') === '5');

  const whole = H.card(state({ wholeObject: true }));
  ok('the whole object is not asked what it does to the material', !has(whole, 'data-frg-op'));
  ok('nor given one part\'s dimensions', !has(whole, 'data-frg-param'));
  ok('nor a single name', !has(whole, 'data-frg-name'));
  ok('but can still be moved and turned', has(whole, 'data-frg-pos="x"') && has(whole, 'data-frg-rot="x"'));
}

console.log('\nA part that is half of a mirrored pair says so:');
{
  const alone = H.card(state());
  const paired = H.card(state({ hasTwin: true }));
  ok('an ordinary part says nothing about pairs', !has(alone, 'mirrored pair'));
  // The rule is not obvious, and a rule discovered by surprise is a bug report.
  ok('a paired part says what follows to the other one', has(paired, 'mirrored pair'));
  ok('and that it follows everything, not only some of it', has(paired, 'follows everything you do here'));
  ok('and offers a way out of the arrangement', has(paired, 'data-frg-edit="unmirror"'));
  ok('the whole object is never described as one of a pair',
    !has(H.card(state({ hasTwin: true, wholeObject: true })), 'mirrored pair'));
}

console.log('\nAnything a person or a model wrote is escaped:');
{
  // A part's name comes from a prompt by way of a language model, and a model
  // asked for a bracket will happily call it one.
  const nasty = '"><img src=x onerror=alert(1)>';
  const html = H.card(state({ node: { id: 'x', name: nasty, type: 'box', params: {} } }));
  ok('a name cannot end the attribute it sits in', !has(html, '"><img'));
  ok('and is still readable once escaped', has(html, '&quot;&gt;&lt;img'));
  ok('a type nobody knows is escaped too',
    !has(H.card(state({ node: { id: 'x', name: 'n', type: '<b>x</b>', params: {} } })), '<b>x</b>'));
  ok('the measured line is escaped', !has(H.card(state({ node: null, measured: { text: '<script>' } })), '<script>'));
}

console.log('\nThe buttons say which mode is on:');
{
  ok('the current one is marked', has(H.card(state({ transformMode: 'rotate' })), 'active" data-frg-edit="rotate"'));
  ok('and the others are not', !has(H.card(state({ transformMode: 'rotate' })), 'active" data-frg-edit="translate"'));
  ok('snap shows when it is on', has(H.card(state({ snapEnabled: true })), 'active" data-frg-edit="snap"'));
  ok('and when it is off', !has(H.card(state({ snapEnabled: false })), 'active" data-frg-edit="snap"'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/panel-html.js)\n`);
process.exit(fail === 0 ? 0 : 1);
