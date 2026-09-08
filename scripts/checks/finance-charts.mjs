// ==============================================================
// Finance chart checks
//
// Loads the REAL src/js/finance/charts.js into a Node VM and reads back the
// SVG it draws.
//
// A chart is read faster than the table beside it and trusted more, so a chart
// that is wrong is worse than no chart at all: nothing about it looks wrong.
// The figures come from a model, which means they arrive with gaps and with
// whatever else the model felt like sending.
//
// Run with: npm run check:finance-charts
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'finance', 'charts.js'), 'utf8'),
  sandbox, { filename: 'charts.js' });
const C = sandbox.window.HCFinanceCharts;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
/** Legend entries in the order they are drawn, as "Label = amount". */
const legendOf = (svg) => [...svg.matchAll(/>([A-Za-z][A-Za-z ]*)<\/text>[\s\S]{0,220}?· ([\d.]+[KMB]?)</g)]
  .map((m) => `${m[1]} = ${m[2]}`);

console.log('A slice carries its own label:');
{
  // The values were filtered on their own and the labels read back by position
  // afterwards, so dropping one value moved every label after it onto the wrong
  // slice — putting the wrong name on the biggest slice of a spending chart.
  const chart = {
    labels: ['Rent', 'Refunds', 'Payroll', 'Marketing', 'Software'],
    datasets: [{ values: [4000, 0, 9000, 1500, 800] }],
  };
  const legend = legendOf(C.renderDonutChart(chart, 'a'));
  ok('the biggest slice is the biggest category', legend[0] === 'Payroll = 9.0K');
  ok('the next is right too', legend[1] === 'Rent = 4.0K');
  ok('and the next', legend[2] === 'Marketing = 1.5K');
  ok('and the last', legend[3] === 'Software = 800');
  ok('the category worth nothing is not drawn', !legend.some((l) => l.startsWith('Refunds')));
  ok('every remaining category is drawn', legend.length === 4);

  // Control: reading the labels back by position after filtering is the fault.
  const vals = [4000, 0, 9000, 1500, 800].filter((v) => v > 0);
  const byPosition = vals.map((v, i) => chart.labels[i]);
  ok('control: reading labels by position after filtering mislabels the slices',
    byPosition[1] !== 'Payroll');
}

console.log('\nNothing a model can send makes a chart throw:');
{
  // A model writes null for a point it has no figure for. That used to be
  // handed straight to the formatter, which threw and took the report with it.
  for (const bad of [null, undefined, NaN, 'abc', {}, [], Infinity, -Infinity]) {
    const data = { labels: ['a', 'b', 'c'], datasets: [{ values: [10, bad, 30] }] };
    const name = String(bad === undefined ? 'undefined' : JSON.stringify(bad));
    let threw = false;
    let sawNaN = false;
    for (const draw of [C.renderLineChart, C.renderBarChart, C.renderDonutChart]) {
      try {
        const out = draw(data, 'x');
        if (/NaN|undefined|Infinity/.test(out)) sawNaN = true;
      } catch { threw = true; }
    }
    ok(`a value of ${name} draws without throwing`, !threw);
    ok(`a value of ${name} leaves nothing broken in the drawing`, !sawNaN);
  }
}

console.log('\nA point with no figure is a gap, not a zero:');
{
  // Drawing it at zero would show a month of nothing where the truth is that
  // nothing was recorded, and on a chart of somebody's money those read very
  // differently.
  const withGap = C.renderLineChart({ labels: ['Jan', 'Feb', 'Mar'], datasets: [{ values: [100, null, 300] }] }, 'g');
  const withZero = C.renderLineChart({ labels: ['Jan', 'Feb', 'Mar'], datasets: [{ values: [100, 0, 300] }] }, 'g');
  ok('a gap does not draw the same picture as a zero', withGap !== withZero);
  ok('a gap draws fewer points than a full series',
    (withGap.match(/<circle/g) || []).length < (C.renderLineChart({ labels: ['Jan', 'Feb', 'Mar'], datasets: [{ values: [100, 200, 300] }] }, 'g').match(/<circle/g) || []).length);
  const bars = C.renderBarChart({ labels: ['Jan', 'Feb', 'Mar'], datasets: [{ values: [100, null, 300] }] }, 'b');
  ok('a bar with no figure is not drawn', (bars.match(/<rect [^>]*rx="3"/g) || []).length === 2);
  ok('the bars that remain are still drawn', (bars.match(/<rect [^>]*rx="3"/g) || []).length > 0);
}

console.log('\nThe axis is worked out from real numbers only:');
{
  const svg = C.renderLineChart({ labels: ['a', 'b'], datasets: [{ values: [null, undefined] }] }, 'e');
  ok('a series of nothing does not break the axis', !/NaN/.test(svg));
  const big = C.renderBarChart({ labels: ['a', 'b'], datasets: [{ values: [1000, 2000] }] }, 'f');
  ok('a normal series is drawn', big.includes('<rect'));
  ok('the axis is labelled', big.includes('text-anchor="end"'));
}

console.log('\nAn empty chart is nothing, not a broken one:');
{
  ok('no labels draws nothing', C.renderBarChart({ labels: [], datasets: [{ values: [1] }] }, 'x') === '');
  ok('no datasets still draws the frame', typeof C.renderBarChart({ labels: ['a'], datasets: [] }, 'x') === 'string');
  ok('a donut of nothing draws nothing', C.renderDonutChart({ labels: ['a'], datasets: [{ values: [0] }] }, 'x') === '');
  ok('a donut of negatives draws nothing', C.renderDonutChart({ labels: ['a'], datasets: [{ values: [-5] }] }, 'x') === '');
  ok('a missing datasets key does not throw', typeof C.renderDonutChart({ labels: ['a'] }, 'x') === 'string');
}

console.log('\nLabels are escaped, because a model wrote them:');
{
  const svg = C.renderBarChart({ labels: ['<script>x</script>'], datasets: [{ label: '<b>d</b>', values: [5] }] }, 'x');
  ok('a tag in a label is escaped', !svg.includes('<script>'));
  ok('and in a series name', !svg.includes('<b>d</b>'));
  const donut = C.renderDonutChart({ labels: ['<img src=x>'], datasets: [{ values: [5] }] }, 'x');
  ok('and in a slice label', !donut.includes('<img src=x>'));
}

console.log('\nFigures are shortened the way money is read:');
{
  ok('thousands', C.formatNum(1500) === '1.5K');
  ok('millions', C.formatNum(2_400_000) === '2.4M');
  ok('billions', C.formatNum(3_100_000_000) === '3.1B');
  ok('small numbers keep their pennies', C.formatNum(0.25) === '0.25');
  ok('whole numbers do not gain any', C.formatNum(42) === '42');
  ok('negatives keep their sign', C.formatNum(-1500) === '-1.5K');
  ok('a missing figure is shown as missing', C.formatNum(null) === '–');
  ok('so is one that is not a number', C.formatNum('abc') === '–');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/finance/charts.js)`);
process.exit(fail ? 1 : 0);
