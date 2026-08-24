// ==============================================================
// Forge shape parameters — checks
//
// Loads the REAL src/js/forge/params.js into a Node VM, and reads the REAL
// primitiveGeometry out of the mode's source.
//
// The defect this is here to prevent is a quiet one. The panel shows the
// number a part is built with; the geometry falls back to a number when the
// plan did not say. If those two disagree, the field reads as the truth and is
// not — a person types back the number they were just shown and the part
// changes shape for no reason they can see. So the two are checked against
// each other: every field this table describes must be one the geometry
// actually reads, and every fallback the geometry reaches for must be this
// table's.
//
// Run with: npm run check:forge-params
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'params.js'), 'utf8'), sandbox, { filename: 'params.js' });
const P = sandbox.window.HCForgeParams;
const modeSrc = readFileSync(join(root, 'src', 'modes', 'forge', 'mode.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** primitiveGeometry, to its closing brace at the same indent. */
function primitiveGeometrySource() {
  const start = modeSrc.indexOf('  function primitiveGeometry(node) {');
  const end = modeSrc.indexOf('\n  }\n', start);
  return modeSrc.slice(start, end);
}
const geometry = primitiveGeometrySource();

console.log('\nEvery shape says which of its numbers can be changed:');
{
  ok('the table was read', !!P && !!P.FIELDS);
  const types = Object.keys(P.FIELDS);
  ok('it covers every shape the app builds', types.length === 11, `${types.length} types`);
  ok('a mesh offers nothing, because it has nothing of its own',
    P.fieldsFor('mesh').length === 0 && P.isEditable('mesh') === false);
  ok('a shape nobody knows offers nothing rather than throwing',
    P.fieldsFor('nonsense').length === 0 && P.valueOf({ type: 'nonsense' }, 'width') === undefined);
  ok('every field has a label a person can read',
    types.every((t) => P.fieldsFor(t).every((f) => typeof f.label === 'string' && f.label.length > 1 && /^[A-Z]/.test(f.label))));
  ok('every field says whether it is a size or a count',
    types.every((t) => P.fieldsFor(t).every((f) => f.kind === 'length' || f.kind === 'count')));
  ok('every field has limits, and they make sense',
    types.every((t) => P.fieldsFor(t).every((f) => f.min < f.max && f.fallback >= f.min && f.fallback <= f.max)));
  ok('no field is listed twice for one shape',
    types.every((t) => new Set(P.fieldsFor(t).map((f) => f.key)).size === P.fieldsFor(t).length));
}

console.log('\nThe panel and the geometry cannot disagree about a default:');
{
  // Read out of the real primitiveGeometry: every `v("key", …)` it asks for.
  const asked = new Map();
  for (const m of geometry.matchAll(/v\("(\w+)",\s*([^)]*?)\)/g)) {
    asked.set(m[1], (asked.get(m[1]) || []).concat(m[2].trim()));
  }
  ok('the geometry asks the table for its numbers', asked.size >= 15, `${asked.size} asked for`);

  // Every field described here must be one the geometry actually reads,
  // otherwise the panel offers an edit that changes nothing.
  const described = new Set();
  for (const t of Object.keys(P.FIELDS)) for (const f of P.fieldsFor(t)) described.add(f.key);
  const offeredButUnread = [...described].filter((k) => !asked.has(k));
  ok('every number the panel offers is one the shape is built from',
    offeredButUnread.length === 0, offeredButUnread.join(', '));

  // And the fallback written beside each ask must match this table, so the two
  // agree even when the table has not loaded.
  //
  // Compared PER SHAPE, not per name. `width` is 1 on a box and 2.1 on a logo
  // plane, and `segments` is 48 on a cylinder and 64 on a lathe — checking by
  // name alone would demand they be the same and be wrong to.
  const mismatched = [];
  // The last branch runs to the end of the switch, so it would otherwise
  // swallow the default case and be told the box's numbers are its own.
  const branches = geometry.split(/\n      case "/).slice(1)
    .map((b) => (b.includes('\n      default:') ? b.slice(0, b.indexOf('\n      default:')) : b));
  const shapeOfBranch = (branch) => branch.slice(0, branch.indexOf('"'));
  const seen = new Set();
  for (const branch of branches) {
    const type = shapeOfBranch(branch);
    if (!P.fieldsFor(type).length) continue;
    seen.add(type);
    for (const m of branch.matchAll(/v\("(\w+)",\s*([^)]*?)\)/g)) {
      const field = P.fieldOf(type, m[1]);
      if (!field) { mismatched.push(`${type}.${m[1]}: not in the table`); continue; }
      const written = Number(m[2].split('??').pop().trim());
      if (written !== field.fallback) mismatched.push(`${type}.${m[1]}: geometry ${written}, table ${field.fallback}`);
    }
  }
  // The box is the switch's default branch and has no `case` line of its own.
  for (const m of geometry.slice(geometry.indexOf('default:')).matchAll(/v\("(\w+)",\s*([^)]*?)\)/g)) {
    const field = P.fieldOf('box', m[1]);
    if (!field) { mismatched.push(`box.${m[1]}: not in the table`); continue; }
    seen.add('box');
    const written = Number(m[2].split('??').pop().trim());
    if (written !== field.fallback) mismatched.push(`box.${m[1]}: geometry ${written}, table ${field.fallback}`);
  }
  ok('every shape with numbers was found in the geometry',
    [...Object.keys(P.FIELDS)].filter((t) => P.fieldsFor(t).length && !seen.has(t)).length === 0,
    [...Object.keys(P.FIELDS)].filter((t) => P.fieldsFor(t).length && !seen.has(t)).join(', '));
  ok('and the number it falls back to is the number the table holds',
    mismatched.length === 0, mismatched.slice(0, 4).join(' | '));
}

console.log('\nA part is read at the value it was really built with:');
{
  const cylinder = { type: 'cylinder', params: {} };
  ok('a part that said nothing reads as the default', P.valueOf(cylinder, 'radiusTop') === 0.35);
  ok('a part that said something reads as that',
    P.valueOf({ type: 'box', params: { width: 3 } }, 'width') === 3);
  // A design writing `radius` on a cylinder means both ends, and the geometry
  // has always honoured that. The panel has to read it the same way or it
  // shows a default beside a part built to something else.
  ok('an older spelling is read where the geometry reads it',
    P.valueOf({ type: 'cylinder', params: { radius: 0.9 } }, 'radiusTop') === 0.9
    && P.valueOf({ type: 'cylinder', params: { radius: 0.9 } }, 'radiusBottom') === 0.9);
  ok('the newer spelling wins when both are there',
    P.valueOf({ type: 'cylinder', params: { radius: 0.9, radiusTop: 0.2 } }, 'radiusTop') === 0.2);
  ok('a capsule reads height where it has no length',
    P.valueOf({ type: 'capsule', params: { height: 1.4 } }, 'length') === 1.4);
  ok('a count is always a whole number',
    P.valueOf({ type: 'sphere', params: { widthSegments: 20.7 } }, 'widthSegments') === 21);
  ok('something that is not a number reads as the default',
    P.valueOf({ type: 'box', params: { width: 'wide' } }, 'width') === 1);
  ok('valuesOf gives the panel every field with its value',
    P.valuesOf({ type: 'torus', params: { tube: 0.2 } })
      .map((f) => `${f.key}=${f.value}`).join(',') === 'radius=0.5,tube=0.2');
}

console.log('\nA number typed in is brought inside what the shape allows:');
{
  ok('below the floor comes up to it', P.clamp('box', 'width', -5) === 0.001);
  ok('above the ceiling comes down to it', P.clamp('box', 'width', 1e9) === 100);
  ok('a count is rounded', P.clamp('sphere', 'widthSegments', 12.6) === 13);
  ok('a count has its own floor, so a curve keeps some sides', P.clamp('sphere', 'widthSegments', 1) === 3);
  ok('a bevel may genuinely be nothing', P.clamp('extrude', 'bevelSize', 0) === 0);
  ok('nothing typed at all falls back rather than becoming zero', P.clamp('box', 'width', '') === 1);
  ok('a field that does not exist changes nothing', P.clamp('box', 'radius', 5) === null);
}

console.log('\nSetting a number leaves the part describing itself one way:');
{
  // The exact trap: a plan wrote `radius`, the top is edited, and `radius` is
  // left behind — a value that is in the file, is not in the part, and comes
  // back the moment anything rebuilds from it.
  const cylinder = { type: 'cylinder', params: { radius: 0.9, height: 2 } };
  const after = P.withValue(cylinder, 'radiusTop', 0.2);
  ok('the older spelling is removed once it has been replaced', !('radius' in after));
  ok('the edited number is what was asked for', after.radiusTop === 0.2);
  // And what that spelling ALSO meant is kept, or editing the top would
  // silently change the bottom too.
  ok('what it also stood for is kept', after.radiusBottom === 0.9);
  ok('everything else is left alone', after.height === 2);

  const box = P.withValue({ type: 'box', params: { width: 1 } }, 'height', 4);
  ok('a shape with no older spellings is simply set', box.height === 4 && box.width === 1);
  ok('the value is clamped on the way in', P.withValue({ type: 'box', params: {} }, 'width', -3).width === 0.001);
  ok('a field that does not exist writes nothing',
    JSON.stringify(P.withValue({ type: 'box', params: { width: 1 } }, 'tube', 5)) === '{"width":1}');
  ok('the original part is not changed underneath the caller',
    cylinder.params.radius === 0.9 && cylinder.params.radiusTop === undefined);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/params.js)\n`);
process.exit(fail === 0 ? 0 : 1);
