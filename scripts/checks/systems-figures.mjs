// ==============================================================
// Systems figures checks
//
// The numbers a generated system's dashboards show. Every one must come from
// the records: a trend names the two months it compares, and where nothing
// can be compared there is no trend.
//
// Run with: npm run check:systems-figures
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'systems', 'figures.js'), sandbox, { filename: 'figures.js' });
const F = sandbox.window.HCSystemsFigures;
const mode = src('modes', 'systems', 'mode.js');

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const orders = [
  { total: 100, date: '2026-07-03', status: 'Paid' },
  { total: 200, date: '2026-08-10', status: 'Paid' },
  { total: 50, date: '2026-08-21', status: 'Cancelled' },
  { total: 330, date: '2026-09-02', status: 'Cooking' },
  { total: '', date: '2026-09-05', status: '' },
  { total: 'n/a', date: '2026-10-01', status: 'Booked' },
];
const today = '2026-09-11';

console.log('One figure from the records:');
ok('a sum adds the numbers', F.aggregate(orders, 'total', 'sum') === 680);
ok('blanks and words are skipped, not counted as 0', F.aggregate(orders, 'total', 'avg') === 170);
ok('a count is every record', F.aggregate(orders, 'total', 'count') === 6);
ok('the largest and smallest', F.aggregate(orders, 'total', 'max') === 330 && F.aggregate(orders, 'total', 'min') === 50);
ok('the average of nothing is nothing, not 0', F.aggregate([], 'total', 'avg') === null && F.aggregate([{ total: '' }], 'total', 'max') === null);
ok('the sum of nothing is 0', F.aggregate([], 'total', 'sum') === 0);
ok('a negative figure stays negative', F.aggregate([{ v: -5 }, { v: -2 }], 'v', 'max') === -2);

console.log('\nMonths:');
ok('a month is read from a date', F.monthOf('2026-09-11') === '2026-09' && F.monthOf('2026-09') === '2026-09');
ok('a date that is not one is not', F.monthOf('next week') === '' && F.monthOf('2026-13-01') === '');
ok('months carry over a year end', F.shiftMonth('2026-01', -1) === '2025-12' && F.shiftMonth('2025-12', 1) === '2026-01');
ok('the latest month is the last with records, not one still to come', F.latestMonth(orders, 'date', today) === '2026-09');
ok('with no dates there is no latest month', F.latestMonth([{ total: 1 }], 'date', today) === null);

console.log('\nA trend compares two named months:');
const t = F.monthTrend(orders, 'date', 'total', 'sum', today);
ok('September against August', t && t.current === 'Sep' && t.previous === 'Aug');
ok('from the records in each: 330 against 250 is +32%', t && t.pct === 32 && t.text === '+32%' && t.up);
const down = F.monthTrend([{ v: 100, d: '2026-08-01' }, { v: 60, d: '2026-09-01' }], 'd', 'v', 'sum', today);
ok('a fall is a fall', down && down.pct === -40 && !down.up && down.text === '-40%');
ok('no dates, no trend', F.monthTrend(orders, null, 'total', 'sum', today) === null);
ok('nothing in the month before, no trend', F.monthTrend([{ v: 5, d: '2026-09-01' }], 'd', 'v', 'sum', today) === null);
ok('a month before of 0 gives no percentage', F.monthTrend([{ v: 0, d: '2026-08-01' }, { v: 5, d: '2026-09-01' }], 'd', 'v', 'sum', today) === null);
ok('a count can trend too, and no change reads 0%', F.monthTrend(orders, 'date', null, 'count', today)?.text === '0%');

console.log('\nA line through the months:');
const s = F.monthlySeries(orders, 'date', 'total', 'sum', today, 3);
ok('it ends at the latest month', s.map((p) => p.month).join() === '2026-07,2026-08,2026-09');
ok('each point is that month\'s figure', s.map((p) => p.value).join() === '100,250,330');
ok('a month with nothing in it is 0, and still there', F.monthlySeries(orders, 'date', 'total', 'sum', today, 5)[0].value === 0);
ok('with no dates there is no line', F.monthlySeries(orders, null, 'total', 'sum', today).length === 0);

console.log('\nA figure the model asked for:');
{
  const fields = [{ id: 'total', label: 'Total', type: 'number' }, { id: 'status', label: 'Status', type: 'select' }];
  const k = F.kpiFrom({ label: 'Revenue', field: 'total', aggregate: 'sum' }, fields);
  ok('it is read against the entity\'s fields', k && k.field.id === 'total' && k.how === 'sum' && k.label === 'Revenue');
  ok('a field can be named by its label', F.kpiFrom({ label: 'x', field: 'total', aggregate: 'avg' }, [{ id: 't', label: 'Total' }])?.field.id === 't');
  ok('one on a field the entity does not have is dropped, not shown as 0', F.kpiFrom({ label: 'Profit', field: 'net_profit', aggregate: 'sum' }, fields) === null);
  ok('a count needs no field', F.kpiFrom({ label: 'Orders', aggregate: 'count' }, fields)?.how === 'count');
  ok('an aggregate it does not know is taken as a sum', F.kpiFrom({ label: 'x', field: 'total', aggregate: 'median' }, fields)?.how === 'sum');
}

console.log('\nWhat a status means:');
ok('paid, served and done are finished', ['Paid', 'Served', 'done'].every(F.isFinished));
ok('cooking and booked are not', !F.isFinished('Cooking') && !F.isFinished('Booked'));
ok('cancelled and no-show are dropped, not finished', F.isDropped('Cancelled') && F.isDropped('No-show') && !F.isFinished('Cancelled'));

console.log('\nNo screen makes a figure up:');
ok('no trend is written into the screens', !/trend: "[+-]\d+%"|trend \|\| "\+5%"/.test(mode));
ok('no sparkline is drawn from fixed numbers', !/const seeds = \[/.test(mode));
ok('no bar is given a value a record does not have', !/\(idx \+ 1\) \* 10/.test(mode));
ok('nothing static is labelled Live', !/>Live</.test(mode));
ok('open work is not guessed when records have no status', !/records\.length \* \.4/.test(mode));
ok('every figure the model asks for is read through kpiFrom', (mode.match(/F\.kpiFrom\(d, fields\)/g) || []).length === 2);

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/figures.js)`);
process.exit(fail ? 1 : 0);
