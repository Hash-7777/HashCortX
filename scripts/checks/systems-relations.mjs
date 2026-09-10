// ==============================================================
// Systems relations checks
//
// How a generated system's records point at each other, and how a number is
// worked out from the others on its record.
//
// Run with: npm run check:systems-relations
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Intl };
vm.createContext(sandbox);
for (const f of [['js', 'forge', 'expr.js'], ['js', 'systems', 'view.js'], ['js', 'systems', 'relations.js']]) vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
const R = sandbox.window.HCSystemsRelations;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const customers = { id: 'customers', name: 'Customers', fields: [{ id: 'name', type: 'text' }, { id: 'phone', type: 'text' }] };
const people = [{ id: 'c1', name: 'Rania Khoury' }, { id: 'c2', name: 'Karim Nassar' }, { id: 'c3', name: 'rania khoury' }];

console.log('A link points at a record that exists:');
ok('a link to an entity the system has is kept', R.usableField({ id: 'customer', type: 'link', entity: 'customers' }, ['customers', 'orders']).type === 'link');
const orphan = R.usableField({ id: 'room', type: 'link', entity: 'rooms' }, ['customers']);
ok('a link to one it does not have becomes plain text', orphan.type === 'text' && !('entity' in orphan));
ok('other fields are left alone', R.usableField({ id: 'x', type: 'number' }, []).type === 'number');

console.log('\nA link is followed to its record:');
const idx = R.indexOf(people, customers);
ok('by the record\'s name, without regard to case', R.resolve('RANIA KHOURY', idx)?.id === 'c1');
ok('by its id', R.resolve('c2', idx)?.id === 'c2');
ok('a name that matches nothing is nothing', R.resolve('Nobody', idx) === null && R.resolve('', idx) === null);
ok('two records with one name: the first is the one', R.resolve('rania khoury', idx)?.id === 'c1');

console.log('\nA link is set from the records it can point at:');
ok('each name once, in order', R.choices(people, customers).join('|') === 'Rania Khoury|Karim Nassar');

console.log('\nRenaming a record renames the links to it:');
{
  const entities = { customers, orders: { id: 'orders', fields: [{ id: 'customer', type: 'link', entity: 'customers' }, { id: 'note', type: 'text' }] } };
  const data = { orders: [{ customer: 'Rania Khoury', note: 'Rania Khoury' }, { customer: 'Karim Nassar' }, { customer: 'RANIA KHOURY' }] };
  const n = R.renameLinks(data, entities, 'customers', 'Rania Khoury', 'Rania Haddad');
  ok('the link is renamed', data.orders[0].customer === 'Rania Haddad');
  ok('including one written in other case, since links are followed without regard to it', data.orders[2].customer === 'Rania Haddad' && n === 2);
  ok('a text field that happens to hold the name is not', data.orders[0].note === 'Rania Khoury');
  ok('other links are left alone', data.orders[1].customer === 'Karim Nassar');
  ok('an unchanged name changes nothing', R.renameLinks(data, entities, 'customers', 'Karim Nassar', 'karim nassar') === 0);
}

console.log('\nA number is worked out from the others on its record:');
{
  const lines = { id: 'lines', fields: [
    { id: 'quantity', label: 'Qty', type: 'number' },
    { id: 'unit_price', label: 'Unit price', type: 'number' },
    { id: 'line_total', label: 'Line total', type: 'number', formula: 'quantity * unit_price' },
    { id: 'with_tax', label: 'With tax', type: 'number', formula: 'line_total * 1.14' },
  ] };
  const { record, errors } = R.computeRecord({ quantity: 3, unit_price: 7.5 }, lines);
  ok('quantity × unit price', record.line_total === 22.5);
  ok('and a formula can use another formula\'s result', record.with_tax === 25.65);
  ok('with nothing to report', errors.length === 0);
  const bad = R.computeRecord({ quantity: 3, unit_price: '' }, lines);
  ok('a missing number leaves the field as it was and says why', bad.record.line_total === undefined && bad.errors.some((e) => /Line total/.test(e)));
  const evil = R.computeRecord({ a: 1 }, { fields: [{ id: 'a', type: 'number' }, { id: 'x', label: 'X', type: 'number', formula: 'constructor.constructor("return 1")()' }] });
  ok('a formula can reach nothing but the numbers it is given', evil.record.x === undefined && evil.errors.length === 1);
  const self = R.computeRecord({ total: 5 }, { fields: [{ id: 'total', label: 'T', type: 'number', formula: 'total + 1' }] });
  ok('a formula cannot feed on itself', self.record.total === 5 && self.errors.length === 1);
  ok('a record with no formulas is returned as it came', R.computeRecord({ a: 1 }, customers).record.a === 1);
}

console.log('\nThe Systems mode uses them:');
ok('a link to an entity that does not exist is made plain text when a system is built', /REL\(\)\.usableField\(f, Object\.keys\(spec\.entities\)\)/.test(mode));
ok('a link is shown as something to follow', /data-action="open-link"/.test(mode) && /action === "open-link"/.test(mode));
ok('a form sets a link from the target\'s records', /linkNames: \(f\) => spec\?\.entities\?\.\[f\.entity\] \? REL\(\)\.choices\(/.test(mode));
ok('a formula field is shown worked out, not typed', /readonly title="Worked out:/.test(src('js', 'systems', 'forms.js')));
ok('formulas are worked out when records are generated, saved and imported', (mode.match(/REL\(\)\.computeRecord\(/g) || []).length >= 4);
ok('renaming a record renames the links to it', /REL\(\)\.renameLinks\(data, spec\.entities, activeEntityId/.test(mode));
ok('a blank number is saved blank, not 0', !/Number\(inp\.value \|\| 0\)/.test(mode) && !/\(Number\(val\) \|\| 0\)/.test(mode));
ok('the model is told what a link and a formula are', (mode.match(/"type":"link","entity"/g) || []).length === 2 && (mode.match(/"formula":"quantity \* unit_price"/g) || []).length === 2);

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/relations.js)`);
process.exit(fail ? 1 : 0);
