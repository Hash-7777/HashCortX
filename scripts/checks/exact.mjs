// ==============================================================
// Exact whole-number arithmetic — checks
//
// Loads the REAL src/js/chat/exact.js and holds that a whole-number
// expression is worked out exactly at any size, that anything it cannot
// answer exactly is left to the ordinary arithmetic, and that the calculate
// tool asks it first.
//
// Run with: npm run check:exact
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, BigInt, String, Number, Error };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'exact.js'), sandbox, { filename: 'exact.js' });
const X = sandbox.window.HCExact;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('Worked out exactly:');
ok('past the size ordinary numbers hold', X.integer('2**61 - 1') === '2305843009213693951');
ok('control: ordinary numbers round it', String(2 ** 61 - 1) !== '2305843009213693951');
ok('factorial', X.integer('17!') === '355687428096000' && X.integer('25!') === '15511210043330985984000000');
ok('a caret is a power, the way people write it', X.integer('2^10') === '1024');
ok('precedence: power before product before sum, power from the right', X.integer('2 + 3 * 2 ** 3 ** 2') === String(2 + 3 * 2 ** 9) && X.integer('-2**2') === '-4');
ok('brackets and a factorial of a bracket', X.integer('(3 + 2)! % 7') === '1');
ok('division where it comes out whole', X.integer('100 / 4') === '25');
ok('grouped thousands', X.integer('1,000,000 * 3') === '3000000');
ok('the days between two dates', X.integer('days(2026-03-03, 2026-07-19)') === '138' && X.integer('days(2024-02-28, 2024-03-01)') === '2' && X.integer('days(2026-07-19, 2026-03-03)') === '-138');
ok('... in a sum', X.integer('days(2026-01-01, 2026-12-31) + 1') === '365');
ok('a date that does not exist is not a number of days', X.integer('days(2026-02-30, 2026-03-01)') === null);

console.log('\nLeft to the ordinary arithmetic:');
ok('division with a remainder', X.integer('7 / 2') === null);
ok('a decimal', X.integer('2.5 * 4') === null);
ok('a function', X.integer('Math.sqrt(16)') === null && X.integer('sqrt(16)') === null);
ok('division by zero', X.integer('1 / 0') === null && X.integer('5 % 0') === null);
ok('a negative power', X.integer('2 ** -1') === null);
ok('something unfinished', X.integer('(1 + 2') === null && X.integer('3 *') === null && X.integer('') === null && X.integer('()') === null);
ok('a result too large to be worth printing, refused before it is worked out', X.integer('9 ** 999999') === null && X.integer('5000!') === null);

console.log('\nThe calculate tool asks it first:');
{
  const app = src('js', 'app.js');
  const tool = app.slice(app.indexOf('    calculate: {'), app.indexOf('    execute_python: {'));
  ok('exact first, then the ordinary reader', tool.indexOf('HCExact.integer(expression)') > 0 && tool.indexOf('HCExact.integer(expression)') < tool.indexOf('evaluateWritten'));
  ok('a rounded result says it was rounded', /rounded: too large to hold exactly/.test(tool));
  ok('the model is told how to ask for the days between two dates', /days\(2026-03-03, 2026-07-19\) for the days between two dates/.test(tool));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/chat/exact.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/exact.js)`);
process.exit(fail ? 1 : 0);
