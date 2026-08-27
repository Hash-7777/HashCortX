// ==============================================================
// Finance amounts — checks
//
// Loads the REAL src/js/finance/amounts.js. This mode reads somebody's own
// bank statement or ledger, and everything it shows them afterwards rests on
// two things: whether a figure in a cell was read correctly, and whether it
// was counted as money in or money out.
//
// Both were wrong for whole conventions of writing a number, and neither could
// be handed a figure and asked what it made of it.
//
// Run with: npm run check:finance-amounts
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'finance', 'amounts.js'), 'utf8'), sandbox, { filename: 'amounts.js' });
const F = sandbox.window.HCFinanceAmounts;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const P = F.parseAmount;

console.log('\nAn ordinary figure is read as itself:');
{
  ok('a plain number', P('500') === 500);
  ok('with a thousands separator', P('1,234.56') === 1234.56);
  ok('with a currency symbol', P('$500') === 500);
  ok('with the currency spelled out', P('USD 300') === 300);
  ok('a decimal', P('12.5') === 12.5);
  ok('and a minus sign', P('-500') === -500);
}

console.log('\nAccounting writes a negative in parentheses, and always has:');
{
  // Every ledger, every statement, every export from every accounting package.
  // Read as positive, a debit is counted as income and the totals invert.
  ok('a bracketed figure is negative', P('(500)') === -500);
  ok('with separators too', P('(1,200.00)') === -1200);
  ok('and with a currency symbol outside the brackets', P('$(2,500.75)') === -2500.75);
  ok('while an unbracketed one is still positive', P('500') === 500);
  ok('and a bracketed zero is still zero', P('(0)') === 0);
}

console.log('\nHalf the world puts the dot where the other half puts the comma:');
{
  // Stripping everything but digits and dots turned 1.234,56 into 1.23456 —
  // out by a factor of a thousand, and quietly, because what came back was
  // still a plausible-looking number.
  ok('the English way is read', P('1,234.56') === 1234.56);
  ok('and the other way is read too', P('1.234,56') === 1234.56);
  ok('with more than one thousands mark', P('1.234.567,89') === 1234567.89);
  ok('and the same the English way', P('1,234,567.89') === 1234567.89);
  ok('both conventions agree on a negative', P('(1.234,56)') === -1234.56);
  // A lone comma says nothing about which convention is in use, so it is read
  // the English way rather than guessed at.
  ok('a lone comma is read the English way, consistently', P('1,234') === 1234);
}

console.log('\nAn empty cell is not a transaction of nothing:');
{
  // Null and zero have to stay apart, or every blank row joins the totals.
  ok('a blank cell is nothing', P('') === null && P('   ') === null);
  ok('so is nothing at all', P(null) === null && P(undefined) === null);
  ok('and a dash on its own', P('-') === null);
  ok('and a cell with no digits in it', P('n/a') === null && P('pending') === null);
  ok('but a genuine zero is a zero', P('0') === 0 && P('$0.00') === 0);
}

// ── The whole point: what the totals come to ─────────────────────────────
const ledger = (rows) => ({
  currency: 'USD',
  table: { headers: ['Date', 'Description', 'Amount'], rows },
  kpis: [
    { label: 'Total Income', value: '$0', positive: true },
    { label: 'Total Expenses', value: '$0', positive: true },
    { label: 'Net Cash Flow', value: '$0', positive: true },
  ],
  charts: [],
});
const kpi = (report, label) => report.kpis.find((k) => k.label === label).value;

console.log('\nA statement written the way an accountant writes one adds up:');
{
  // This fixture is chosen so the SIGN is what decides, and nothing else.
  //
  // The classifier falls back to "not income, therefore expense", which
  // quietly rescues most bracketed rows: a row called Rent lands in expenses
  // whether it was read as -1200 or +1200. So a ledger of ordinary rows proves
  // nothing about whether the brackets were understood.
  //
  // A REVERSED refund is where it shows. The description says refund, which is
  // an income word, so a positive figure goes into income — and read as
  // positive is exactly what a bracketed figure used to be.
  const report = ledger([
    ['2026-01-02', 'Salary', '3,000.00'],
    ['2026-01-05', 'Rent', '(1,200.00)'],
    ['2026-01-18', 'Refund reversed', '(400.00)'],
  ]);
  ok('something was recalculated', F.recalcFromTable(report) === true);
  // Read wrongly, the reversal joins the salary and income reads $3.4K.
  ok('a reversed refund is money going out, not coming in',
    kpi(report, 'Total Income') === '$3.0K', kpi(report, 'Total Income'));
  ok('and it lands in what went out',
    kpi(report, 'Total Expenses') === '$1.6K', kpi(report, 'Total Expenses'));
  ok('so the net is what is actually left', kpi(report, 'Net Cash Flow') === '$1.4K',
    kpi(report, 'Net Cash Flow'));
  ok('and it is shown as a good thing', report.kpis[2].positive === true);
}

console.log('\nA table it cannot read is left alone rather than guessed at:');
{
  ok('no table changes nothing', F.recalcFromTable({ table: null, kpis: [] }) === false);
  ok('no rows change nothing', F.recalcFromTable({ table: { headers: ['a'], rows: [] }, kpis: [] }) === false);
  ok('and a table with no figures anywhere changes nothing',
    F.recalcFromTable({ table: { headers: ['Name', 'Note'], rows: [['a', 'b']] }, kpis: [] }) === false);
}

console.log('\nA figure is shown the way the one beside it was shown:');
{
  // A value that never had a currency symbol must not grow one, or an edit
  // introduces a $ into a report written in something else.
  ok('a plain value stays plain', F.fmtKpiLike(1500, '1.2K', 'USD') === '1.5K');
  ok('a value with a symbol keeps one', F.fmtKpiLike(1500, '$1.2K', 'USD') === '$1.5K');
  ok('thousands are shortened', F.fmtKpi(1500, 'USD') === '$1.5K');
  ok('and millions', F.fmtKpi(2500000, 'USD') === '$2.50M');
  ok('a small figure is written out', F.fmtKpi(12.5, 'USD') === '$12.5');
  ok('a negative keeps its sign in front of the symbol', F.fmtKpi(-1500, 'USD') === '-$1.5K');
  ok('a currency with no symbol falls back rather than showing letters',
    F.fmtKpi(100, 'USD') === '$100');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/finance/amounts.js)\n`);
process.exit(fail === 0 ? 0 : 1);
