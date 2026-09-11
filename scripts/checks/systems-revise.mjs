// ==============================================================
// Systems revise checks
//
// Changing a generated system by asking: what the model is shown, what of the
// design is kept, and how the change is told back.
//
// Run with: npm run check:systems-revise
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'revise.js'), sandbox, { filename: 'revise.js' });
const R = sandbox.window.HCSystemsRevise;
const mode = src('modes', 'systems', 'mode.js');
const panel = src('modes', 'systems', 'panel.html');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const before = {
  id: 'sys1', name: 'Saffron Table',
  theme: { mode: 'light', primary: '#92400e', accent: '#f59e0b', radius: 12, font: 'serif', density: 'spacious', surface: 'elevated' },
  layout: { shell: 'top', nav: 'top', dashboardStyle: 'focus' },
  modules: [{ id: 'overview', name: 'Overview', entity: 'orders', screen: 'dashboard' }, { id: 'orders', name: 'Orders', entity: 'orders', screen: 'kanban' }],
  entities: { orders: { id: 'orders', name: 'Orders', fields: [{ id: 'order_number', label: 'Order #' }, { id: 'total', label: 'Total' }] } },
  mockData: { orders: [{ id: 'o1' }] }, revisionHistory: [{ at: 1 }], financialModel: { currency: 'USD' },
};

console.log('What the model is shown:');
{
  const data = { orders: [{ id: 'o1', order_number: 'ORD-1', total: 5 }, { id: 'o2', order_number: 'ORD-2', total: 6 }, { id: 'o3', order_number: 'ORD-3', total: 7 }] };
  const c = R.compactSpec(before, data);
  ok('the design and the schema', c.theme.font === 'serif' && c.entities.orders.fields.length === 2 && c.modules.length === 2);
  ok('not every record, its history or its books', !('mockData' in c) && !('revisionHistory' in c) && !('financialModel' in c));
  ok('two records of each entity, to follow their shape', c.sampleRecords.orders.length === 2 && c.sampleRecords.orders[0].order_number === 'ORD-1');
  ok('without their internal ids', !('id' in c.sampleRecords.orders[0]));
}

console.log('\nThe design a request did not touch is kept:');
{
  const after = R.keepDesign(before, { theme: { mode: 'dark' }, layout: {} });
  ok('the change it asked for stays', after.theme.mode === 'dark');
  ok('the rest is as it was', after.theme.font === 'serif' && after.theme.surface === 'elevated' && after.theme.primary === '#92400e');
  ok('and so is the layout', after.layout.shell === 'top' && after.layout.dashboardStyle === 'focus');
  ok('an answer with no theme at all keeps the whole theme', R.keepDesign(before, {}).theme.density === 'spacious');
}

console.log('\nWhat a change did, in words:');
{
  const after = JSON.parse(JSON.stringify(before));
  after.modules.push({ id: 'loyalty', name: 'Loyalty', entity: 'members', screen: 'cards' });
  after.modules[1].screen = 'list';
  after.entities.members = { id: 'members', name: 'Members', fields: [] };
  after.entities.orders.fields = [{ id: 'order_number', label: 'Order #' }, { id: 'points', label: 'Points' }];
  after.theme.mode = 'dark';
  after.layout.shell = 'dock';
  const c = R.specChanges(before, after);
  ok('a module added', c.includes('Added module "Loyalty"'));
  ok('a screen changed', c.includes('"Orders" is now shown as list'));
  ok('an entity added', c.includes('Added Members'));
  ok('fields added and removed', c.includes('Orders: added "Points"') && c.includes('Orders: removed "Total"'));
  ok('the design changed', c.includes('Theme: light → dark') && c.includes('Layout: top → dock'));
  const gone = JSON.parse(JSON.stringify(before));
  gone.modules = gone.modules.slice(0, 1);
  ok('a module removed', R.specChanges(before, gone).includes('Removed module "Orders"'));
  ok('nothing changed says nothing', R.specChanges(before, JSON.parse(JSON.stringify(before))).length === 0);
}

console.log('\nThe Systems mode changes the open system:');
ok('there is a Change button, off until a system is open', /id="sysChangeBtn"[^>]*disabled/.test(panel) && /change\.disabled = running \|\| !getActive\(\)/.test(mode));
ok('it is shown the system and told to keep what the request does not mention', /You are CHANGING an existing system/.test(mode) && /R\.compactSpec\(spec, data\)/.test(mode));
ok('the answer is built on the system as it was, so records of entities that remain are kept', /finalizeOrRepairGeneratedSpec\(model, kept, raw, [^)]*, signal, tried, spec\)/.test(mode) && /return finalizeGeneratedSpec\(parsed, desc, previousSpec\);/.test(mode));
ok('new entities get records written for them', /next = await writeMissingRecords\(await finalizeOrRepairGeneratedSpec\(model, kept/.test(mode));
ok('the books the person has are kept', /if \(data\[id\] && next\.entities\[id\]\) next\.mockData\[id\] = data\[id\]/.test(mode));
ok('the system as it was is kept as a version, records and all', /next\.revisionHistory = \[snapshot\(spec, request\)/.test(mode) && /mockData: getRuntimeData\(spec\), revisionHistory: \[\]/.test(mode));
ok('restoring a version saves its records', /saveRuntimeData\(restored, restored\.mockData\);/.test(mode));
ok('a change that fails leaves the system as it was, and says so', /the system is as it was/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/revise.js)`);
process.exit(fail ? 1 : 0);
