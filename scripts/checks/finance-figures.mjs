// ==============================================================
// Finance figures checks
//
// Loads the REAL src/js/finance/figures.js (with amounts.js, which reads a
// written amount) and holds the rule a report now rests on: the model lists
// figures, and every total, card, chart and table row is worked out here from
// that one list — so an edit changes everything made from it, and a total can
// never disagree with its lines.
//
// Run with: npm run check:finance-figures
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Intl, Math, Number, JSON, Map, Set };
vm.createContext(sandbox);
for (const f of ['amounts.js', 'figures.js', 'prompt.js']) vm.runInContext(src('js', 'finance', f), sandbox, { filename: f });
const F = sandbox.window.HCFinanceFigures;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

// A household month, synthetic.
const listed = [
  { item: 'Pay', amount: 3000, flow: 'in', category: 'Income' },
  { item: 'Rent', amount: '1,100', flow: 'out', category: 'Housing' },
  { item: 'Food', amount: 400, flow: 'out', category: 'Food' },
  { item: 'Bus pass', amount: 60, flow: 'expense', category: 'Transport' },
  { item: 'Savings', amount: 200, flow: 'saved', category: 'Savings' },
];

console.log('What the model lists is read and checked:');
{
  const f = F.read(listed);
  ok('every figure, with an amount read from how it was written', f.length === 5 && f[1].amount === 1100);
  ok('which way the money went, in the words a model uses', f[0].flow === 'in' && f[3].flow === 'out' && f[4].flow === 'saved');
  ok('a negative amount is kept as its size', F.read([{ item: 'x', amount: -45, flow: 'out' }])[0].amount === 45);
  ok('a figure with no amount, or nothing, is left out', F.read([{ item: 'x' }, { item: 'y', amount: 0 }, null, 'z']).length === 0);
  ok('no category is "Other", and a date is kept only when it is one', (() => { const [a] = F.read([{ item: 'x', amount: 1, date: 'May' }]); return a.category === 'Other' && !('date' in a); })());
  ok('not a list, nothing', F.read(undefined).length === 0 && F.read({}).length === 0);
}

console.log('\nThe sums are the app\'s, made once from the list:');
{
  const s = F.summarize(F.read(listed));
  ok('money in, money out and set aside', s.in === 3000 && s.out === 1560 && s.saved === 200);
  ok('what is left over is in less out less set aside', s.net === 1240);
  ok('the saving rate is set aside over money in', s.rate === 6.7);
  ok('spending by category, largest first', s.byCategory.map(([n]) => n).join() === 'Housing,Food,Transport');
  const many = F.summarize(F.read(Array.from({ length: 10 }, (_, i) => ({ item: `c${i}`, amount: 10 + i, flow: 'out', category: `C${i}` }))));
  ok('past seven categories the rest are one "Other", so nothing is lost', many.byCategory.length === 8 && many.byCategory[7][0] === 'Other' && many.byCategory.reduce((n, [, v]) => n + v, 0) === many.out);
  const dated = F.summarize(F.read([{ item: 'a', amount: 5, flow: 'out', date: '2026-01-04' }, { item: 'b', amount: 7, flow: 'in', date: '2026-02-01' }]));
  ok('dated figures are also summed by month', dated.byMonth.length === 2 && dated.byMonth[0].out === 5 && dated.byMonth[1].in === 7);
  ok('cents do not drift', F.summarize(F.read([{ item: 'a', amount: 0.1, flow: 'out' }, { item: 'b', amount: 0.2, flow: 'out' }])).out === 0.3);
}

console.log('\nThe cards, charts and table are made from the sums:');
{
  const report = { currency: 'EGP', figures: F.read(listed), kpis: [
    { label: 'Total Expenses', value: '1,500' },          // a sum, and wrong: dropped
    { label: 'Months of runway', value: '4.2' },          // not a sum: kept, marked
  ] };
  F.apply(report);
  const card = (label) => report.kpis.find((k) => k.label === label);
  ok('money in, out, set aside, left over and the rate, worked out', card('Money in') && card('Money out') && card('Set aside') && card('Left over') && card('Saving rate'));
  ok('in the report\'s own currency', /EGP/.test(card('Money out').value) && /1,560/.test(card('Money out').value));
  ok('a sum the model wrote, and got wrong, is not shown', !report.kpis.some((k) => /Total Expenses/.test(k.label)));
  ok('a measure that is not a sum is kept, after the app\'s, marked as the model\'s', report.kpis.at(-1).label === 'Months of runway' && report.kpis.at(-1).byModel && report.kpis.at(-1).estimated);
  ok('the app\'s cards are marked as worked out', report.kpis.filter((k) => k.computed).length === 5);
  ok('a chart of where the money goes, from the categories', report.charts[0].type === 'donut' && report.charts[0].datasets[0].values.join() === '1100,400,60');
  ok('the table is the list, and says so', report.table.figures === true && report.table.rows.length === 5 && report.table.headers.join() === 'Item,Category,In / out,Amount');
  const kept = (label) => F.apply({ figures: F.read(listed), kpis: [{ label, value: '1' }] }).kpis.some((k) => k.label === label);
  ok('a ratio or a span of time built on money is the model\'s to give', kept('Debt to income') && kept('Profit margin') && kept('Burn rate') && kept('Months of runway'));
  ok('a total or a rate the app works out is not repeated', !kept('Savings rate') && !kept('Net income') && !kept('Monthly Expenses') && !kept('Total costs'));
  ok('a business names its own totals', F.kpisOf(F.summarize(F.read(listed)), 'USD', { in: 'Revenue', out: 'Costs', net: 'Profit' }).map((k) => k.label).slice(0, 2).join() === 'Revenue,Costs');
  ok('money with no currency named is written plainly', F.money(1234.5, '') === '1,234.50' && F.money(1234, 'USD') === '$1,234');
}

console.log('\nAn edit to the table changes everything made from it:');
{
  const report = { currency: 'USD', figures: F.read(listed), kpis: [{ label: 'Debt to income', value: '12%' }] };
  F.apply(report);
  const table = report.table;
  table.rows[1][3] = '1,300';                               // rent, by hand
  table.rows.push(['Gym', 'Health', 'Out', '40']);          // a row added
  table.rows.push(['', '', '', '']);                        // a row still being filled in
  report.kpis.at(-1).value = '15%';                         // the model's card, corrected
  report.figures = F.fromTable(table);
  F.apply(report);
  ok('the table is read back into the list, a half-filled row waiting', report.figures.length === 6 && report.figures[1].amount === 1300);
  ok('money out follows the edit', report.kpis.find((k) => k.label === 'Money out').value === '$1,800');
  ok('and what is left over', report.kpis.find((k) => k.label === 'Left over').value === '$1,000');
  ok('the chart follows it too', report.charts[0].labels.includes('Health') && report.charts[0].datasets[0].values[0] === 1300);
  ok('a card of the model\'s corrected by hand keeps the correction', report.kpis.find((k) => k.label === 'Debt to income').value === '15%');
  const back = F.fromTable(F.tableOf(F.read([{ item: 'a', amount: 3, flow: 'saved', category: 'S', date: '2026-03-01' }])));
  ok('a table read back gives the same list, date and all', back[0].flow === 'saved' && back[0].date === '2026-03-01' && back[0].amount === 3);
}

console.log('\nA report saved before figures is left as it was:');
{
  const old = { kpis: [{ label: 'Total', value: '9' }], charts: [{ type: 'bar' }], table: { rows: [['a']] } };
  F.apply(old);
  ok('nothing is added or taken away', old.kpis.length === 1 && old.charts.length === 1 && !old.table.figures);
}

console.log('\nHow the Finance mode uses it:');
{
  const mode = src('modes', 'finance', 'mode.js');
  const prompt = sandbox.window.HCFinancePrompt.SYSTEM;
  ok('the model is asked for figures and told the app does the sums', /"figures": \[/.test(prompt) && /THE APP DOES THE MATHS/.test(prompt) && /Do NOT add anything up/.test(prompt));
  ok('... and asked for no charts or table of its own', !/"charts": \[/.test(prompt) && !/"table": \{/.test(prompt));
  ok('a new report\'s figures are read and worked out before it is drawn', /report\.figures = FIG\(\)\.read\(report\.figures\);\s*if \(hasFigures\(report\)\) FIG\(\)\.apply\(report\);/.test(mode));
  ok('an edit to the table works the report out again from the list', /currentReport\.figures = FIG\(\)\.fromTable\(table\);\s*FIG\(\)\.apply\(currentReport\);/.test(mode));
  ok('... and draws the cards and charts again', /if \(hasFigures\(currentReport\)\) \{\s*const grid = document\.querySelector\("#finReport \.fin-kpi-grid"\);/.test(mode));
  ok('a card the app works out cannot be typed over', /k\.computed \? "" : editAttr\(`kpis\.\$\{i\}\.value`\)/.test(mode));
  ok('the analysis says when it was written before the edits', /Written from the figures as they first were/.test(mode));
  ok('a model that cannot answer hands the report to another', /window\.HCChatFailover\.agentTurns\(\{/.test(mode) && /untilFinished: true/.test(mode));
  const boot = src('boot.js');
  ok('the pieces load before the mode', boot.indexOf("'/js/finance/figures.js'") > boot.indexOf("'/js/finance/amounts.js'") && boot.indexOf("'/js/finance/prompt.js'") > 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/finance/figures.js)`);
process.exit(fail ? 1 : 0);
