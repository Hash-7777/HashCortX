// ==============================================================
// Forge units checks
//
// Loads the REAL src/js/forge/units.js into a Node VM. Everything here is
// arithmetic a person would do in their head, which is exactly why it is worth
// pinning: a scale factor is invisible until a file lands in a slicer at a
// thousand times the size, and by then the model has been blamed for it.
//
// Run with: npm run check:forge-units
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'units.js'), 'utf8'), sandbox, { filename: 'units.js' });
const U = sandbox.window.HCForgeUnits;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('\nThe scene runs at one span, whatever the object is:');
{
  ok('the working span is stated once', U.WORKING_SPAN === 2);
  ok('and it is what the tolerances are proportions of',
    near(0.06 / U.WORKING_SPAN, 0.03), 'the contact gap should read as 3%');
  ok('a default size exists so nothing is ever blank', U.DEFAULT_SIZE_MM === 100);
  ok('the limits are a printable range', U.MIN_SIZE_MM === 1 && U.MAX_SIZE_MM === 2000);
}

console.log('\nThe size a plan asks to be:');
{
  ok('a stated size is taken', U.sizeMmOf({ sizeMm: 150 }).mm === 150);
  ok('and marked as stated', U.sizeMmOf({ sizeMm: 150 }).stated === true);
  ok('the other spellings are read too',
    U.sizeMmOf({ size_mm: 40 }).mm === 40 && U.sizeMmOf({ size: 40 }).mm === 40);
  ok('nothing stated falls back to the default', U.sizeMmOf({}).mm === U.DEFAULT_SIZE_MM);
  ok('and says it was not stated', U.sizeMmOf({}).stated === false);
  ok('a missing plan does not throw', U.sizeMmOf(null).mm === U.DEFAULT_SIZE_MM);
  ok('text that is not a number is not a size', U.sizeMmOf({ sizeMm: 'big' }).stated === false);
  ok('zero is not a size', U.sizeMmOf({ sizeMm: 0 }).stated === false);
  ok('a negative size is not a size', U.sizeMmOf({ sizeMm: -20 }).stated === false);
  // A decimal point in the wrong place is the common one, and clamping keeps a
  // usable file rather than refusing to write one.
  ok('an absurd size is clamped, not refused', U.sizeMmOf({ sizeMm: 90000 }).mm === U.MAX_SIZE_MM);
  ok('and the clamp is reported', U.sizeMmOf({ sizeMm: 90000 }).clamped === true);
  ok('something smaller than a printer resolves is clamped up', U.sizeMmOf({ sizeMm: 0.02 }).mm === U.MIN_SIZE_MM);
  ok('a size inside the range is not marked clamped', U.sizeMmOf({ sizeMm: 150 }).clamped === false);
}

console.log('\nMillimetres per scene unit, from what was measured:');
{
  ok('a 150 mm model measuring 2 units is 75 mm a unit', near(U.mmPerUnit(150, 2), 75));
  ok('a model that measured slightly off is divided by what it measured',
    near(U.mmPerUnit(150, 1.98), 150 / 1.98), 'not by the working span');
  ok('a model with no size has no factor', U.mmPerUnit(150, 0) === 0);
  ok('and neither does a model of no size', U.mmPerUnit(0, 2) === 0);
  ok('nonsense in gives zero out, not NaN', U.mmPerUnit('x', 'y') === 0);

  const p = U.mmPerUnit(150, 2);
  ok('converting to millimetres and back returns the same number',
    near(U.fromMm(U.toMm(0.37, p), p), 0.37, 1e-12));
  ok('a length with no factor is zero rather than infinite', U.fromMm(50, 0) === 0);
}

console.log('\nA measurement reads the way a person writes one:');
{
  ok('a big number needs no decimals', U.formatMm(150) === '150 mm');
  ok('a small one gets one', U.formatMm(4.25) === '4.3 mm');
  ok('a very small one gets two', U.formatMm(0.847) === '0.85 mm');
  ok('a round number does not pretend to precision', U.formatMm(5.0) === '5 mm');
  ok('and neither does a trailing zero', U.formatMm(0.5) === '0.5 mm');
  ok('the unit can be left off when the label already says it', U.formatMm(150, { bare: true }) === '150');
  ok('zero is zero', U.formatMm(0) === '0 mm');
  ok('a negative reads as negative', U.formatMm(-12).startsWith('-'));
  ok('nonsense reads as zero rather than NaN', U.formatMm(undefined) === '0 mm');

  const p = U.mmPerUnit(150, 2);
  ok('a bounding box is one line', U.formatSize([2, 1, 0.4], p) === '150 × 75 × 30 mm');
  ok('a box with no factor does not read as a size', U.formatSize([2, 1, 0.4], 0) === '0 × 0 × 0 mm');
  ok('a box that is not a box does not throw', U.formatSize(null, p) === '0 × 0 × 0 mm');
}

console.log('\nA written file carries the units the format is read in:');
{
  const p = U.mmPerUnit(150, 2);
  ok('a printing format is written in millimetres', near(U.exportScale('stl', p), 75));
  ok('and so is the plain mesh format', near(U.exportScale('obj', p), 75));
  // The scene format is read as metres by everything that opens it. A model
  // written at millimetre numbers arrives a thousand times too big, somewhere
  // else, long after anyone is watching.
  ok('the scene format is written in metres', near(U.exportScale('glb', p), 0.075));
  ok('the case of the name does not matter', near(U.exportScale('GLB', p), 0.075));
  ok('an unknown format is treated as millimetres', near(U.exportScale('xyz', p), 75));
  ok('no factor means no rescaling rather than collapsing the model', U.exportScale('stl', 0) === 1);
}

console.log('\nThe two ideas stay apart:');
{
  // The whole point: changing the real size must not touch the geometry, so a
  // model can be re-sized without anything being rebuilt or distorted.
  const small = U.mmPerUnit(40, 2);
  const large = U.mmPerUnit(400, 2);
  ok('the same geometry can be any real size', near(large / small, 10));
  ok('and the scene span does not change with it', U.WORKING_SPAN === 2);
  // Read with the comments taken out: the header states the module is pure, and
  // a rule that matched its own claim would pass by describing itself.
  const code = readFileSync(join(root, 'src', 'js', 'forge', 'units.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  ok('the module touches no geometry and no page', !/THREE|document|window\.(?!HCForgeUnits)/.test(code));
  ok('and reaches nothing outside itself but its own export',
    (code.match(/window\./g) || []).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/units.js)\n`);
process.exit(fail ? 1 : 0);
