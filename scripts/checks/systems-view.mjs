// ==============================================================
// Systems view checks
//
// How a generated system names a record, shows a figure and divides a board.
// Every screen reads these from src/js/systems/view.js, so one wrong answer
// here is wrong everywhere — and one right answer is right everywhere.
//
// Run with: npm run check:systems-view
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Intl };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'view.js'), sandbox, { filename: 'view.js' });
const V = sandbox.window.HCSystemsView;
const mode = src('modes', 'systems', 'mode.js');
const css = src('modes', 'systems', 'mode.css');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const f = (id, type = 'text', extra = {}) => ({ id, label: id, type, ...extra });

console.log('What a record is called:');
{
  const orders = { name: 'Orders', fields: [f('order_number'), f('table_number'), f('items'), f('total', 'number'), f('status', 'select')] };
  ok('an order is called by its order number, not by what was ordered', V.titleField(orders).id === 'order_number');
  const guests = { name: 'Reservations', fields: [f('party_size', 'number'), f('guest_name'), f('reservation_date', 'date')] };
  ok('with nothing else to go on, the guest\'s name', V.titleField(guests).id === 'guest_name');
  const invoices = { id: 'invoices', name: 'Invoices', fields: [f('customer_name'), f('invoice_number'), f('total', 'number')] };
  ok('an invoice by its number, not by the customer it is for', V.titleField(invoices).id === 'invoice_number');
  const products = { id: 'products', name: 'Products', fields: [f('sku'), f('product_name')] };
  ok('a product by its own name, not its code', V.titleField(products).id === 'product_name');
  const people = { id: 'employees', name: 'Employees', fields: [f('badge_no'), f('name')] };
  ok('a field called just "name" is the record\'s own', V.titleField(people).id === 'name');
  ok('categories, boxes and branches are made singular properly',
    V.titleField({ id: 'categories', fields: [f('code'), f('category_name')] }).id === 'category_name'
    && V.titleField({ id: 'boxes', fields: [f('code'), f('box_name')] }).id === 'box_name'
    && V.titleField({ id: 'branches', fields: [f('code'), f('branch_name')] }).id === 'branch_name');
  const menu = { name: 'Menu Items', fields: [f('price', 'number'), f('dish'), f('category', 'select')] };
  ok('failing that, the first text field', V.titleField(menu).id === 'dish');
  ok('a record is labelled with it', V.recordLabel({ id: 'orders_1', order_number: 'ORD-1001' }, orders) === 'ORD-1001');
  ok('never with its internal id', V.recordLabel({ id: 'orders_1', order_number: '' }, orders) === 'Untitled order');
  ok('an entity with no fields still gives a label', V.recordLabel({ id: 'x' }, { name: 'Things', fields: [] }) === 'Untitled thing');
}

console.log('\nMoney:');
{
  ok('a price is money', V.isMoneyField(f('price', 'number')));
  ok('so is a balance, a total and a salary', ['balance', 'total', 'salary'].every((id) => V.isMoneyField(f(id, 'number'))));
  ok('a label with a currency is money', V.isMoneyField({ id: 'subtotal_x', label: 'Subtotal (USD)', type: 'number' }));
  ok('a party size is not', !V.isMoneyField(f('party_size', 'number')));
  ok('a quantity, a rate and a count are not', ['quantity', 'tax_rate', 'order_count'].every((id) => !V.isMoneyField(f(id, 'number'))));
  ok('a text field is never money', !V.isMoneyField(f('price', 'text')));
  ok('money is shown with its currency and cents', V.formatMoney(56.5, 'USD') === '$56.50');
  ok('in the system\'s own currency', V.formatMoney(1200, 'EUR') === '€1,200.00');
  ok('a figure that is not a number is a dash, not NaN', V.formatMoney('abc') === '—' && V.formatNumber(undefined) === '—');
  ok('a plain figure is grouped', V.formatNumber(12345.678) === '12,345.68');
  ok('the currency comes from the system', V.currencyOf({ financialModel: { currency: 'egp' } }) === 'EGP' && V.currencyOf({}) === 'USD');
  ok('a malformed currency falls back rather than breaking the formatter', V.currencyOf({ currency: 'dollars' }) === 'USD');
}

console.log('\nA board has a place for every record:');
{
  const status = f('status', 'select', { options: ['New', 'Cooking', 'Served'] });
  const records = [{ status: 'Cooking' }, { status: 'Waiting' }, { status: '' }, { status: 'New' }];
  const cols = V.boardColumns(records, status);
  ok('the field\'s own options come first, in order', cols.slice(0, 3).join() === 'New,Cooking,Served');
  ok('a status that is not an option gets a column', cols.includes('Waiting'));
  ok('records with no status get one too', cols.includes(V.NO_STATUS));
  ok('so no record is left off the board', records.every((r) => cols.includes(V.boardColumnOf(r, status))));
  ok('an empty board keeps its columns', V.boardColumns([], status).join() === 'New,Cooking,Served');
}

console.log('\nFigures that cannot go wrong:');
ok('the largest of nothing is 0, not -Infinity', V.safeMax([]) === 0);
ok('words among the figures are ignored', V.safeMax([3, 'x', 7]) === 7);

console.log('\nEvery screen asks the same questions:');
ok('no screen escapes a cell that is already escaped', !/esc\(formatCell\(/.test(mode));
ok('no screen guesses a record\'s name for itself', !/r\.name \|\| r\.ingredient_name|selected\.name \|\| selected\.id|r\[nameField\?\.id\] \|\| r\.name/.test(mode));
ok('the board takes its columns from the shared rule', /VIEW\(\)\.boardColumns\(records, statusField\)/.test(mode));
ok('the open module in the sidebar is not painted the sidebar\'s own colour',
  !/\.sys-shell-sidebar \.sys-module-btn\.active \{ background: var\(--sys-primary\)/.test(css));
ok('card rows grow to their content instead of being squeezed', /\.sys-cards-grid \{[^}]*grid-auto-rows: max-content/.test(css));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/view.js)`);
process.exit(fail ? 1 : 0);
