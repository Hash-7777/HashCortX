// ==============================================================
// Systems books checks
//
// Where a generated system's books come from: its own sales, and nothing
// else. A system with no sales gets no books; a menu, a supplier list and a
// purchase order are not sales; a cancelled or future sale is not billed.
//
// Run with: npm run check:systems-books
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Intl };
vm.createContext(sandbox);
for (const f of ['view.js', 'figures.js', 'stages.js', 'books.js']) vm.runInContext(src('js', 'systems', f), sandbox, { filename: f });
const B = sandbox.window.HCSystemsBooks;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const f = (id, type = 'text', extra = {}) => ({ id, label: id, type, ...extra });
const spec = { entities: {
  orders: { id: 'orders', name: 'Orders', fields: [f('order_number'), f('customer', 'link', { entity: 'guests' }), f('items'), f('total', 'number'), f('status', 'select', { options: ['New', 'Cooking', 'Served', 'Paid', 'Cancelled'] }), f('order_date', 'date')] },
  menu_items: { id: 'menu_items', name: 'Menu Items', fields: [f('dish'), f('price', 'number'), f('added', 'date')] },
  suppliers: { id: 'suppliers', name: 'Suppliers', fields: [f('supplier'), f('balance', 'number'), f('last_order', 'date')] },
  purchase_orders: { id: 'purchase_orders', name: 'Purchase Orders', fields: [f('po_number'), f('amount', 'number'), f('ordered', 'date')] },
  invoices: { id: 'invoices', name: 'Invoices', fields: [f('invoice_number'), f('total', 'number'), f('issue_date', 'date')] },
} };
const data = {
  orders: [
    { id: 'o1', order_number: 'ORD-1', customer: 'Rania Khoury', items: 'Hummus', total: 42.5, status: 'Paid', order_date: '2026-09-02' },
    { id: 'o2', order_number: 'ORD-2', customer: '', items: '', total: 14, status: 'Cooking', order_date: '2026-09-01' },
    { id: 'o3', order_number: 'ORD-3', customer: 'Karim', items: 'Grill', total: 60, status: 'Cancelled', order_date: '2026-09-03' },
    { id: 'o4', order_number: 'ORD-4', customer: 'Lina', items: 'Mezze', total: 30, status: 'New', order_date: '2026-09-20' },
    { id: 'o5', order_number: 'ORD-5', customer: 'Omar', items: 'x', total: '', status: 'Paid', order_date: '2026-09-04' },
  ],
  menu_items: [{ dish: 'Hummus', price: 7, added: '2026-01-01' }],
  suppliers: [{ supplier: 'Bekaa', balance: 900, last_order: '2026-08-01' }],
  purchase_orders: [{ po_number: 'PO-1', amount: 400, ordered: '2026-08-01' }, { po_number: 'PO-2', amount: 20, ordered: '2026-08-03' }],
  invoices: [{ invoice_number: 'INV-9', total: 5, issue_date: '2026-01-01' }],
};

console.log('What counts as the business\'s sales:');
const src0 = B.salesSource(spec, data, ['invoices']);
ok('orders, which are named as sales and carry an amount and a date', src0?.entityId === 'orders');
ok('read by their total, their date, their customer link, what was ordered and their status',
  src0.amountField.id === 'total' && src0.dateField.id === 'order_date' && src0.customerField.id === 'customer' && src0.itemsField.id === 'items' && src0.stageField.id === 'status');
ok('a menu with prices is not a sale', B.salesSource({ entities: { menu_items: spec.entities.menu_items } }, data) === null);
ok('nor a supplier list with balances', B.salesSource({ entities: { suppliers: spec.entities.suppliers } }, data) === null);
ok('nor purchase orders, which are what the business buys', B.salesSource({ entities: { purchase_orders: spec.entities.purchase_orders } }, data) === null);
ok('the books\' own invoices are never their own source', B.salesSource({ entities: { invoices: spec.entities.invoices } }, data, ['invoices']) === null);
ok('a sale entity with no records of an amount and a date gives no books', B.salesSource({ entities: { orders: spec.entities.orders } }, { orders: [{ total: '', order_date: '' }] }) === null);
ok('of two sale entities, the one with more sales', B.salesSource({ entities: {
  bookings: { id: 'bookings', name: 'Bookings', fields: [f('fee', 'number'), f('day', 'date')] },
  orders: spec.entities.orders } }, { bookings: [{ fee: 5, day: '2026-01-01' }], orders: data.orders })?.entityId === 'orders');

console.log('\nWhich sales are billed:');
const ev = B.salesEvents(src0, spec, data, '2026-09-11');
ok('a cancelled sale is not', !ev.some((e) => e.ref === 'ORD-3'));
ok('nor one still to come', !ev.some((e) => e.ref === 'ORD-4'));
ok('nor one with no amount', !ev.some((e) => e.ref === 'ORD-5'));
ok('the rest are, oldest first', ev.map((e) => e.ref).join() === 'ORD-2,ORD-1');
ok('a paid one is settled and one being cooked is not', ev.find((e) => e.ref === 'ORD-1').settled === true && ev.find((e) => e.ref === 'ORD-2').settled === false);
ok('each for its amount, its customer and what it was for', ev.find((e) => e.ref === 'ORD-1').total === 42.5 && ev.find((e) => e.ref === 'ORD-1').customer === 'Rania Khoury' && ev.find((e) => e.ref === 'ORD-1').description === 'Hummus');
ok('a sale that says nothing of what it was is described by what it is', ev.find((e) => e.ref === 'ORD-2').description === 'order ORD-2');
const noStage = B.salesEvents({ ...src0, stageField: null }, spec, data, '2026-09-11');
ok('a sale with no stage to say otherwise is taken as paid', noStage.every((e) => e.settled));

console.log('\nThe Systems mode bills them:');
ok('its books come from the system\'s own sales', /HCSystemsBooks\.salesSource\(/.test(mode) && /HCSystemsBooks\.salesEvents\(/.test(mode));
ok('and a system with none gets no books forced on it', /if \(!src\)/.test(mode));

ok('the books are rebuilt from the sales whenever records are saved', /function saveRuntimeData[\s\S]*?booksFor\(spec, data, spec\.description\)/.test(mode));
ok('and cannot be edited, added to, imported into or moved: they are changed through the sales', (mode.match(/refuseDerived\(/g) || []).length >= 6 && /Worked out from \$\{esc\(/.test(mode));
// FINANCE_ENTITY_IDS in the mode answers one name at a time and has no keys, so
// Object.values() of it is empty: the books were never found among the entities.
ok('the books\' ids are listed from the real table, never from the one-name-at-a-time stand-in', !/Object\.(values|keys|entries)\(FINANCE_ENTITY_IDS\)/.test(mode));

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/books.js)`);
process.exit(fail ? 1 : 0);
