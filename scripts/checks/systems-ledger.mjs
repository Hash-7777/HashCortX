// ==============================================================
// Generated-books checks
//
// Loads the REAL src/js/systems/ledger.js with the money and domain rules
// beside it, generates a company's year, and adds it up.
//
// A generated ERP is judged on whether its numbers hold together, and these
// are the sums an accountant does first: does each journal entry balance, does
// the bank statement agree with the reported cash, does an invoice equal its
// parts. None of that can be told by reading the code — it has to be run and
// totalled, which is the whole reason this file exists.
//
// Run with: npm run check:systems-ledger
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of [['js', 'systems', 'money.js'], ['js', 'systems', 'domain.js'], ['js', 'systems', 'ledger.js']]) {
  vm.runInContext(src(...f), sandbox, { filename: f.join('/') });
}
const { buildFinancialData } = sandbox.window.HCSystemsLedger;
const ID = sandbox.window.HCSystemsDomain.FINANCE_ENTITY_IDS;

const money = (n) => Math.round(n * 100) / 100;
const build = (over = {}) => {
  const spec = {
    id: 'sys_check',
    name: 'Acme Trading',
    description: 'invoicing and accounting for a trading company',
    entities: [],
    ...over,
  };
  const pack = buildFinancialData(spec, over.desc || 'accounting system', { collectBusinessNames: () => [] });
  return {
    currency: pack.currency,
    accounts: pack.data[ID.accounts],
    invoices: pack.data[ID.invoices],
    lines: pack.data[ID.invoiceLines],
    payments: pack.data[ID.payments],
    expenses: pack.data[ID.expenses],
    journal: pack.data[ID.journal],
    bank: pack.data[ID.bank],
    summary: pack.data[ID.summary],
  };
};
const entriesOf = (journal) => {
  const by = new Map();
  for (const row of journal) {
    if (!by.has(row.journal_id)) by.set(row.journal_id, []);
    by.get(row.journal_id).push(row);
  }
  return [...by.values()];
};

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const books = build();

console.log('Every journal entry balances:');
{
  const entries = entriesOf(books.journal);
  const unbalanced = entries.filter((rows) =>
    money(rows.reduce((a, r) => a + r.debit, 0)) !== money(rows.reduce((a, r) => a + r.credit, 0)));
  ok('there are entries to check', entries.length > 20);
  ok('not one of them is out', unbalanced.length === 0);
  ok('the whole journal balances',
    money(books.journal.reduce((a, r) => a + r.debit, 0)) === money(books.journal.reduce((a, r) => a + r.credit, 0)));
  ok('no entry is a single row on its own', entries.every((rows) => rows.length >= 2));
  ok('an invoice carrying tax is one entry of three rows', entries.some((rows) => rows.length === 3));
  ok('entry numbers run in order without gaps',
    entries.every((rows, i) => rows[0].journal_id === `JE-${String(i + 1).padStart(5, '0')}`));
  ok('every row of an entry shares its number',
    entries.every((rows) => rows.every((r) => r.journal_id === rows[0].journal_id)));
  ok('every row of an entry shares its date',
    entries.every((rows) => rows.every((r) => r.entry_date === rows[0].entry_date)));
  ok('no row is both a debit and a credit',
    books.journal.every((r) => r.debit === 0 || r.credit === 0));

  // Control: numbering by row count is what split entries in half. With three
  // rows on a taxed invoice it cannot keep up, and neighbouring halves get
  // joined into entries that do not balance.
  const byPairs = books.journal.map((_, i) => Math.ceil((i + 1) / 2));
  const rowsPerPair = new Map();
  books.journal.forEach((r, i) => {
    const k = byPairs[i];
    if (!rowsPerPair.has(k)) rowsPerPair.set(k, []);
    rowsPerPair.get(k).push(r);
  });
  const brokenByPairs = [...rowsPerPair.values()].filter((rows) =>
    money(rows.reduce((a, r) => a + r.debit, 0)) !== money(rows.reduce((a, r) => a + r.credit, 0)));
  ok('control: numbering one entry per two rows leaves most of them out of balance',
    brokenByPairs.length > rowsPerPair.size / 2);
}

console.log('\nThe journal is cut between entries, never through one:');
{
  const entries = entriesOf(books.journal);
  const last = entries[entries.length - 1];
  ok('the last entry shown is whole', money(last.reduce((a, r) => a + r.debit, 0)) === money(last.reduce((a, r) => a + r.credit, 0)));
  ok('the cut keeps the journal within its limit', books.journal.length <= 240);
  ok('and still shows a useful amount of it', books.journal.length > 200);
}

console.log('\nThe bank statement and the reported cash are the same number:');
{
  const lastBank = books.bank[books.bank.length - 1];
  const lastMonth = books.summary[books.summary.length - 1];
  ok('there is a bank ledger', !!lastBank);
  ok('the closing balance is the cash the summary reports', lastBank.balance === lastMonth.cash_balance);
  ok('every bank row carries the running balance after it',
    books.bank.every((row, i) => i === 0 || money(books.bank[i - 1].balance + row.amount) === row.balance));
  ok('money in is positive and money out is negative',
    books.bank.every((r) => (r.type === 'Deposit' ? r.amount > 0 : r.amount < 0)));

  // Control: a second running total, opening elsewhere and subtracting unpaid
  // expenses too, is what disagreed with the statement.
  let separate = 0;
  for (const m of books.summary) {
    const paid = books.payments.filter((p) => p.payment_date.startsWith(m.month.slice(0, 7))).reduce((a, p) => a + p.amount, 0);
    const spent = books.expenses.filter((e) => e.expense_date.startsWith(m.month.slice(0, 7))).reduce((a, e) => a + e.amount, 0);
    separate = money(separate + paid - spent);
  }
  ok('control: working cash out separately gives a different answer',
    separate !== books.summary[books.summary.length - 1].cash_balance);
}

console.log('\nAn invoice equals the parts it is made of:');
{
  ok('there are invoices', books.invoices.length > 10);
  ok('subtotal and tax make the total', books.invoices.every((i) => money(i.subtotal + i.tax) === i.total));
  ok('what is paid and what is left make the total', books.invoices.every((i) => money(i.paid + i.balance) === i.total));
  ok('nothing is paid more than it is worth', books.invoices.every((i) => i.paid <= i.total + 0.001));
  ok('nothing owes a negative amount', books.invoices.every((i) => i.balance >= -0.001));
  ok('a settled invoice reads as paid', books.invoices.every((i) => i.balance > 0.001 || i.status === 'Paid'));
  ok('an unsettled one does not', books.invoices.every((i) => i.balance <= 0.001 || i.status !== 'Paid'));
  ok('the lines of an invoice add up to its subtotal',
    books.invoices.every((inv) => {
      const lines = books.lines.filter((l) => l.invoice_number === inv.invoice_number);
      return !lines.length || Math.abs(lines.reduce((a, l) => a + l.line_total, 0) - inv.subtotal) < 0.02;
    }));
  ok('a payment never exceeds what its invoice was for',
    books.payments.every((p) => {
      const inv = books.invoices.find((i) => i.invoice_number === p.invoice_number);
      return !inv || p.amount <= inv.total + 0.001;
    }));
  ok('every payment belongs to an invoice',
    books.payments.every((p) => books.invoices.some((i) => i.invoice_number === p.invoice_number)));
}

console.log('\nThe company the books describe could exist:');
{
  // A year that shows a profit every month while cash falls to a large
  // negative is a set of books that reads as broken. It came of billing
  // everyone and collecting from two thirds of them, for ever.
  const billed = books.invoices.reduce((a, i) => a + i.total, 0);
  const collected = books.invoices.reduce((a, i) => a + i.paid, 0);
  ok('most of what is billed is collected', collected / billed > 0.85);
  ok('but not all of it, or nothing would be owed', collected / billed < 0.999);
  ok('what is still owed is a fraction of a year, not a pile of it',
    books.invoices.reduce((a, i) => a + i.balance, 0) < billed * 0.2);
  ok('older invoices are settled',
    books.invoices.filter((i) => i.issue_date < books.summary[books.summary.length - 3].month.slice(0, 7))
      .every((i) => i.balance <= 0.001));
  ok('the company does not run out of money', books.summary.every((m) => m.cash_balance > 0));
  ok('cash ends the year higher than it started',
    books.summary[books.summary.length - 1].cash_balance > books.summary[0].cash_balance);
  ok('a profitable year is not also a year of falling cash',
    !(books.summary.every((m) => m.net_profit > 0) &&
      books.summary[books.summary.length - 1].cash_balance < books.summary[0].cash_balance));
  ok('revenue less costs is the profit reported',
    books.summary.every((m) => money(m.revenue - m.cost_of_sales - m.operating_expenses) === m.net_profit));
  ok('gross profit is revenue less the cost of sales',
    books.summary.every((m) => money(m.revenue - m.cost_of_sales) === m.gross_profit));
}

console.log('\nThe same system always gets the same books:');
{
  const again = build();
  ok('the journal comes out identical', JSON.stringify(again.journal) === JSON.stringify(books.journal));
  ok('and so does the summary', JSON.stringify(again.summary) === JSON.stringify(books.summary));
  const other = build({ id: 'sys_other', name: 'Other Co' });
  ok('a different system gets different books', JSON.stringify(other.summary) !== JSON.stringify(books.summary));
}

console.log('\nThe currency follows what was asked for:');
{
  ok('a system described for Egypt is in pounds', build({ description: 'accounting for a Cairo business' }).currency === 'EGP');
  ok('one described in euros is in euros', build({ description: 'euro invoicing' }).currency === 'EUR');
  ok('anything else is in dollars', build({ description: 'plain invoicing' }).currency === 'USD');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/ledger.js)`);
process.exit(fail ? 1 : 0);
