// ==============================================================
// What a system is for, asked before it is built
//
// The defect: one line typed into a box was all a system was built from.
// "Book store called hashbooks in cairo" came back named "Book store called
// hashbooks in", with the six parts every shop gets, and a currency one of
// three copies of the same guess had settled on.
//
// Held here: the line is read into a form correctly, and nothing is read that
// is not there; the form cannot be built into something unusable; every
// answer reaches what is built; the owner's word stands over a model's; and
// what the owner left blank is marked, never invented.
//
// Run with: npm run check:systems-setup
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['spec.js', 'money.js', 'samples.js', 'domain.js', 'view.js', 'setup.js', 'scaffold.js']) {
  vm.runInContext(read('src', 'js', 'systems', f), sandbox, { filename: f });
}
const S = sandbox.window.HCSystemsSetup;
const D = sandbox.window.HCSystemsDomain;
const Sc = sandbox.window.HCSystemsScaffold;
const Spec = sandbox.window.HCSystemsSpec;
const M = sandbox.window.HCSystemsMoney;
const V = sandbox.window.HCSystemsView;
const TODAY = '2026-09-21';

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('What was typed is read into the form:');
{
  const cases = [
    ['book store called hashbooks in cairo', 'Hashbooks', 'Cairo', 'EGP'],
    ['a restaurant named Nile Grill in Alexandria, Egypt', 'Nile Grill', 'Alexandria', 'EGP'],
    ['a bakery called "Sweet Crumbs" based in London', 'Sweet Crumbs', 'London', 'GBP'],
    ['ERP for my dental clinic in Dubai', '', 'Dubai', 'AED'],
    ['a gym in Riyadh', '', 'Riyadh', 'SAR'],
    ['a law firm in Paris', '', 'Paris', 'EUR'],
  ];
  for (const [typed, name, place, currency] of cases) {
    const s = S.suggest(typed, D);
    ok(`"${typed}" → name "${name}", in ${place}, ${currency}`, s.name === name && s.place === place && s.currency === currency, JSON.stringify({ name: s.name, place: s.place, currency: s.currency }));
  }
  ok('what it does is kept word for word', S.suggest('book store called hashbooks in cairo', D).does === 'book store called hashbooks in cairo');
  ok('the kind of business is the app\'s own reading of it', S.suggest('book store called hashbooks in cairo', D).trade === 'retail');
}

console.log('\nNothing is read that is not there:');
{
  // "in stock" and "in the shop" follow "in" without being places.
  ok('"in stock" is not a place', S.placeIn('track items in stock for a store') === '');
  ok('"in the shop" is not a place', S.placeIn('orders placed in the shop') === '');
  ok('no name is made up where none is given', S.suggest('bike shop', D).name === '');
  ok('no place is made up either', S.suggest('bike shop', D).place === '');
  ok('with no place, the currency is the plain default', S.suggest('bike shop', D).currency === 'USD');
  ok('a place the app does not know gives no currency, rather than a guess', S.currencyForPlace('Springfield') === '');
}

console.log('\nWhat to keep track of is a real choice:');
{
  const s = S.suggest('book store called hashbooks in cairo', D);
  const own = s.parts.filter((p) => p.own);
  ok('the trade\'s own parts are offered, and ticked', own.length === 6 && own.every((p) => p.on));
  ok('parts beyond the trade are offered too, and not ticked', s.parts.some((p) => !p.own) && s.parts.filter((p) => !p.own).every((p) => !p.on));
  // Two parts over one table is allowed — orders as a board and as a report —
  // but two parts with one name is not.
  ok('no part is offered twice by name', new Set(s.parts.map((p) => p.name.toLowerCase())).size === s.parts.length);
  ok('an extra the trade keeps under another name is not offered again', !S.partsFor('hr', D).some((p) => !p.own && p.entity === 'staff'));
  ok('whichever trade it is', Object.keys(D.DOMAIN_CONFIG).every((t) => {
    const parts = S.partsFor(t, D);
    return new Set(parts.map((p) => p.name.toLowerCase())).size === parts.length;
  }));
  ok('bills are not a second table called Expenses beside the books\' own', S.EXTRAS.every((x) => x.name !== 'Expenses' && x.entity !== 'expenses'));
  // The app's fallback for a table it does not know is a name, an owner, an
  // amount and a status — not what a supplier list holds.
  const sup = S.fieldsFor('suppliers').map((f) => f.id);
  ok('an extra part brings fields of its own', sup.includes('contact') && sup.includes('phone') && !sup.includes('owner'));
  ok('and a task list is a board with stages', S.EXTRAS.find((x) => x.entity === 'tasks').screen === 'kanban');
}

console.log('\nThe form cannot be built into something unusable:');
{
  const s = S.suggest('book store called hashbooks in cairo', D);
  ok('as read, nothing stops it', S.problemsOf(s).length === 0);
  s.parts.slice(0, 3).forEach((p) => { p.on = false; });
  ok(`fewer than ${S.MIN_PARTS} parts is refused, and says why`, S.problemsOf(s).some((m) => /at least 5/.test(m) && /3 chosen/.test(m)));
  ok('and that number is the one the gate itself asks for', /modules\.length < 5/.test(read('src', 'js', 'systems', 'spec.js')) && S.MIN_PARTS === 5);
  ok('an empty description is refused', S.problemsOf({ does: '  ', parts: S.partsFor('retail', D) }).length > 0);
  ok('a currency that is not a code is refused', S.problemsOf({ does: 'x', currency: 'dollars', parts: S.partsFor('retail', D) }).some((m) => /three-letter/.test(m)));
}

console.log('\nEvery answer reaches what is built:');
{
  const s = S.suggest('book store called hashbooks in cairo', D);
  s.name = 'HashBooks';
  s.parts.find((p) => p.name === 'Promotions').on = false;
  s.parts.find((p) => p.name === 'Suppliers').on = true;
  s.parts.find((p) => p.name === 'Bills').on = true;
  const built = Sc.build(S.describe(s, []), TODAY, { setup: S.buildOptions(s) });
  ok('it is named what the owner called it', built.name === 'HashBooks');
  ok('it counts in what they chose', built.currency === 'EGP');
  ok('it knows where it is', built.place === 'Cairo');
  const names = built.modules.map((m) => m.name);
  ok('a part they took out is not there', !names.includes('Promotions'));
  ok('the parts they added are', names.includes('Suppliers') && names.includes('Bills'));
  ok('in the order they were listed', names.indexOf('Products') < names.indexOf('Suppliers'));
  const sup = built.entities.find((e) => e.id === 'suppliers');
  ok('an added part has its own fields, not the fallback', sup && sup.fields.some((f) => f.id === 'contact'));
  ok('and the result passes the app\'s own gate', Spec.validate(built).length === 0, Spec.validate(built).join('; '));
  const other = S.suggest('a gym in Riyadh', D);
  other.trade = 'restaurant';
  other.parts = S.partsFor('restaurant', D);
  ok('changing the kind of business changes the parts', Sc.build(S.describe(other, []), TODAY, { setup: S.buildOptions(other) }).modules.some((m) => m.name === 'Menu'));
  ok('with no setup, the builder reads the request as before', Sc.build('a restaurant', TODAY).name && Sc.build('a restaurant', TODAY).modules.length >= 5);
}

console.log('\nThe currency is decided in one place, and the owner\'s choice comes first:');
{
  ok('a system that names its currency keeps it', M.currencyFor({ currency: 'AED' }, 'a shop in cairo') === 'AED');
  ok('the setup\'s own line in the request is read where only the request is to hand', M.currencyFor(null, 'Money is counted in: SAR\nWhat it does: shop') === 'SAR');
  ok('the old guess is what is left', M.currencyFor(null, 'a shop in cairo') === 'EGP' && M.currencyFor(null, 'a shop') === 'USD');
  const all = ['src/js/systems/ledger.js', 'src/modes/systems/mode.js'].map((p) => read(...p.split('/'))).join('\n');
  ok('no copy of the guess is left anywhere else', !/egp\|egypt\|cairo/.test(all));
  ok('each place that decided it now asks the one that does', (all.match(/HCSystemsMoney\.currencyFor\(/g) || []).length >= 3);
}

console.log('\nA column is headed with the currency the system counts in:');
{
  const spec = { entities: { a: { fields: [
    { id: 'price', label: 'Price ($)', type: 'number' },
    { id: 'hourly_rate', label: 'Hourly Rate ($)', type: 'number' },
    { id: 'total', label: 'Total (USD)', type: 'number' },
    { id: 'qty', label: 'Qty (all)', type: 'number' },
  ] } } };
  S.applyTo(spec, { currency: 'EGP', parts: [] });
  const f = spec.entities.a.fields;
  ok('"Price ($)" over pounds becomes "Price (EGP)"', f[0].label === 'Price (EGP)');
  ok('and a code that is not this one is corrected too', f[2].label === 'Total (EGP)');
  ok('and each is still money to the app', V.isMoneyField(f[0]) && V.isMoneyField(f[1]) && V.isMoneyField(f[2]));
  ok('a bracket that is not a currency is left alone', f[3].label === 'Qty (all)' && !V.isMoneyField(f[3]));
}

console.log('\nThe owner\'s word stands over a model\'s:');
{
  const s = S.suggest('book store called hashbooks in cairo', D);
  s.name = 'HashBooks';
  const fromModel = { name: 'Cairo Book Hub', currency: 'USD', financialModel: { currency: 'USD' }, entities: {} };
  S.applyTo(fromModel, s);
  ok('the name', fromModel.name === 'HashBooks');
  ok('the currency, and the books\' currency with it', fromModel.currency === 'EGP' && fromModel.financialModel.currency === 'EGP');
  ok('the place', fromModel.place === 'Cairo');
}

console.log('\nWhat was left blank is marked, never invented:');
{
  const s = S.suggest('book store called hashbooks in cairo', D);
  const text = S.describe(s, [
    { question: 'What do you mainly sell?', answer: 'Arabic and English novels' },
    { question: 'What are your opening hours?', answer: '  ' },
  ]);
  ok('the form comes first', text.startsWith('Business name: Hashbooks'));
  ok('the currency is written where every step can read it', /Money is counted in: EGP/.test(text));
  ok('an answer is given as fact, not to be added to', /Arabic and English novels/.test(text) && /do not add to them/.test(text));
  ok('a blank one becomes a placeholder, and inventing it is ruled out', /Not given: What are your opening hours\?/.test(text) && /Never invent it/.test(text));
  ok('with no questions asked, there is no such section', !/Not given|Details from the owner/.test(S.describe(s, [])));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/setup.js)`);
process.exit(fail ? 1 : 0);
