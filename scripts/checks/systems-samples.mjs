// ==============================================================
// Systems stand-in values checks
//
// What stands in for a value a generated system's model left out. It must
// never be another business's data, never a date that has gone stale, and
// never a choice the field does not offer.
//
// Run with: npm run check:systems-samples
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of [['js', 'systems', 'money.js'], ['js', 'systems', 'samples.js']]) vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
const S = sandbox.window.HCSystemsSamples;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const today = '2026-09-11';
const f = (id, type = 'text', extra = {}) => ({ id, label: id.replace(/_/g, ' '), type, ...extra });
const many = (field) => Array.from({ length: 40 }, (_, i) => S.sampleValue(field, i, 'menu_items', today));

console.log('A choice is one the field offers:');
{
  const status = f('status', 'select', { options: ['Booked', 'Seated', 'No-show'] });
  ok('always one of its options', many(status).every((v) => status.options.includes(v)));
  ok('and a field with none gets a plain open-to-done set', ['Open', 'In progress', 'Done'].includes(S.sampleValue(f('stage', 'select'), 0, 'x', today)));
}

console.log('\nA date falls in the six months before today:');
{
  const dates = many(f('added', 'date'));
  ok('none is after today', dates.every((d) => d <= today));
  ok('none is more than six months before it', dates.every((d) => d >= '2026-03-15'));
  ok('they are real dates', dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))));
  ok('counting back crosses month and year ends correctly', S.daysBefore('2026-03-01', 1) === '2026-02-28' && S.daysBefore('2026-01-01', 1) === '2025-12-31');
  ok('and moves with today, rather than sitting in a fixed window', S.sampleValue(f('d', 'date'), 3, 's', '2030-01-10') > '2029-07-01');
}

console.log('\nA stand-in is never another business\'s data:');
{
  const businessy = ['dish', 'item_name', 'room_type', 'product', 'class_name', 'menu_item', 'machine', 'material'];
  const words = /pizza|cheesecake|burger|salad|suite|king|yoga|pilates|valve|bracket|cnc|steel|meridian|stellar/i;
  const values = businessy.flatMap((id) => many(f(id)));
  ok('no dish, room, class or product from somebody else\'s list', !values.some((v) => words.test(v)));
  ok('it is named for what it is', S.sampleValue(f('dish'), 2, 'menu_items', today) === 'Dish 3');
}

console.log('\nWhat belongs to any business gets a real-looking stand-in:');
{
  ok('a person has a first and a last name', /^\S+ \S+$/.test(S.sampleValue(f('guest_name'), 0, 'r', today)));
  ok('an email is an address at example.com', /^[a-z]+\.[a-z]+@example\.com$/.test(S.sampleValue(f('email'), 4, 'r', today)));
  ok('a phone number is a phone number', /^\+1 555 \d{3} \d{4}$/.test(S.sampleValue(f('phone'), 1, 'r', today)));
  ok('a supplier is a company', /\S+ \S+/.test(S.sampleValue(f('supplier'), 1, 'r', today)) && !/^Supplier \d/.test(S.sampleValue(f('supplier'), 1, 'r', today)));
  ok('a reference counts up', S.sampleValue(f('order_number'), 0, 'o', today) === 'ORD-1001' && S.sampleValue(f('order_number'), 4, 'o', today) === 'ORD-1005');
  ok('a quantity is a small whole number', many(f('quantity', 'number')).every((n) => Number.isInteger(n) && n >= 1 && n <= 40));
  ok('a price has cents and stays modest', many(f('price', 'number')).every((n) => n >= 5 && n <= 100 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6));
}

console.log('\nThe same record always gets the same stand-ins:');
ok('so a system looks the same each time it opens', S.sampleValue(f('guest_name'), 3, 'r', today) === S.sampleValue(f('guest_name'), 3, 'r', today));
ok('a whole record has an id and every field', (() => {
  const rec = S.sampleRecord({ id: 'menu_items', fields: [f('dish'), f('price', 'number')] }, 0, today);
  return rec.id === 'menu_items_1' && 'dish' in rec && 'price' in rec;
})());

console.log('\nThe Systems mode asks the model before it stands in:');
ok('entities the model left empty are asked for, on both ways a spec is made', (mode.match(/await writeMissingRecords\(await finalizeOrRepairGeneratedSpec\(/g) || []).length === 2);
ok('the books are not, since the ledger builds them', /!finance\.has\(id\)/.test(mode));
ok('a stand-in that stays is said to be one', /are stand-ins made up by the app, not written for this business/.test(mode));
ok('the model is told what today is, so its dates are not a year out', (mode.match(/Today is \$\{todayIso\(\)\}/g) || []).length === 2);
ok('today is the person\'s own date, not UTC\'s', S.localDay(new Date(2026, 8, 11, 0, 30)) === '2026-09-11' && /const todayIso = \(\) => window\.HCSystemsSamples\.localDay\(new Date\(\)\)/.test(mode) && !/toISOString\(\)\.slice\(0, 10\)/.test(mode));
ok('the old lists of other businesses\' data are gone', !/const menuItems|const roomTypes|Margherita Pizza/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/samples.js)`);
process.exit(fail ? 1 : 0);
