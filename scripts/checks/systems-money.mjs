// ==============================================================
// ERP money and date arithmetic — checks
//
// Loads the REAL src/js/systems/money.js. These few small functions produce
// every invoice total, every due date and every sample figure in a generated
// business system, and until this file existed none of them could be checked.
//
// Small is not the same as obviously right. Moving `addDays` out and asking it
// a question in four time zones found that it had been returning a date a day
// early for everyone east of Greenwich — see the section below, which is
// deliberately run against several zones rather than whichever one this
// machine happens to be in.
//
// Run with: npm run check:systems-money
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, Date, Math, Number, String, Set, Array, isNaN };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', 'money.js'), 'utf8'), sandbox, { filename: 'money.js' });
const M = sandbox.window.HCSystemsMoney;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nA date moved by some days lands on the right day, anywhere:');
{
  // THE DEFECT THIS FOUND. Parsing "2026-01-10T00:00:00" gives LOCAL midnight,
  // and toISOString converts to UTC — so east of Greenwich the date came back
  // as the day before. Every due date in every generated system was a day out
  // for most of the world, consistently enough to look deliberate.
  ok('moving a date by nothing leaves it alone', M.addDays('2026-01-10', 0) === '2026-01-10');
  ok('a day forward is the next day', M.addDays('2026-01-10', 1) === '2026-01-11');
  ok('a day back is the day before', M.addDays('2026-01-10', -1) === '2026-01-09');
  ok('over a month end', M.addDays('2026-01-31', 1) === '2026-02-01');
  ok('over a year end', M.addDays('2026-12-31', 1) === '2027-01-01');
  // 2028 is a leap year; 2026 is not.
  ok('through a February that has a 29th', M.addDays('2028-02-28', 1) === '2028-02-29');
  ok('and through one that does not', M.addDays('2026-02-28', 1) === '2026-03-01');
  ok('a nonsense date comes back rather than as Invalid Date',
    M.addDays('not a date', 3) === 'not a date');
  ok('and days that are not a number move nothing',
    M.addDays('2026-01-10', 'soon') === '2026-01-10');
}

console.log('\nAnd the same in every time zone, which is the point:');
{
  // Run in-process by re-reading the module under a changed zone. The failure
  // was invisible in London and wrong in Cairo, so checking one zone — this
  // machine's — is what let it ship.
  const zones = ['UTC', 'Africa/Cairo', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'];
  const before = process.env.TZ;
  const wrong = [];
  for (const tz of zones) {
    process.env.TZ = tz;
    const box = { window: {}, Date, Math, Number, String, Set, Array, isNaN };
    vm.createContext(box);
    vm.runInContext(readFileSync(join(root, 'src', 'js', 'systems', 'money.js'), 'utf8'), box, { filename: 'money.js' });
    const m = box.window.HCSystemsMoney;
    if (m.addDays('2026-01-10', 0) !== '2026-01-10') wrong.push(`${tz}: same day gave ${m.addDays('2026-01-10', 0)}`);
    if (m.addDays('2026-01-10', 1) !== '2026-01-11') wrong.push(`${tz}: +1 gave ${m.addDays('2026-01-10', 1)}`);
    if (m.addDays('2026-03-01', -1) !== '2026-02-28') wrong.push(`${tz}: -1 gave ${m.addDays('2026-03-01', -1)}`);
  }
  process.env.TZ = before;
  ok(`the answer is the same in ${zones.length} zones, from Kiritimati to New York`,
    wrong.length === 0, wrong.slice(0, 3).join(' | '));
}

console.log('\nThe months up to now are months, whatever their length:');
{
  const asOf = new Date(Date.UTC(2026, 0, 15));
  const twelve = M.recentMonths(12, asOf);
  ok('twelve are asked for and twelve come back', twelve.length === 12);
  ok('the last of them is the month asked about', twelve[11].key === '2026-01');
  ok('and the first is eleven months before it', twelve[0].key === '2025-02');
  // Subtracting thirty days twelve times would drift; a calendar month does
  // not care that February is short.
  ok('every month in between is there and in order',
    twelve.map((m) => m.key).join() === '2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12,2026-01');
  // The fifteenth is inside every month whatever its length, so a marker
  // never lands in the month before or after the one it labels.
  ok('each month is marked by a date inside it',
    twelve.every((m) => m.date.startsWith(m.key) && m.date.endsWith('-15')));

  const acrossFebruary = M.recentMonths(3, new Date(Date.UTC(2028, 2, 31)));
  ok('asking from the 31st does not skip a short month',
    acrossFebruary.map((m) => m.key).join() === '2028-01,2028-02,2028-03',
    acrossFebruary.map((m) => m.key).join());

  ok('one month is allowed', M.recentMonths(1, asOf).length === 1);
  // Zero, minus five and a word are all "no count given" — one situation, so
  // one answer. Reading minus five as a single month is a second answer.
  ok('a count that is not a positive number falls back to the default',
    M.recentMonths(0, asOf).length === 12
    && M.recentMonths(-5, asOf).length === 12
    && M.recentMonths('lots', asOf).length === 12);
  ok('and a runaway count is capped', M.recentMonths(100000, asOf).length === 240);
}

console.log('\nSample figures are varied, and the same on every reload:');
{
  // A table whose numbers change each time the page opens looks like the app
  // losing the data rather than like a demonstration.
  ok('the same seed and index give the same number',
    M.seededRand('invoices', 4) === M.seededRand('invoices', 4));
  ok('a different index gives a different one',
    M.seededRand('invoices', 4) !== M.seededRand('invoices', 5));
  ok('and so does a different seed',
    M.seededRand('invoices', 4) !== M.seededRand('orders', 4));

  // Every value must be usable as a fraction of a list length, so it can
  // never reach one — an index past the end of an array is an undefined row.
  let low = 1;
  let high = 0;
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const v = M.seededRand('entity', i);
    low = Math.min(low, v);
    high = Math.max(high, v);
    buckets[Math.floor(v * 10)]++;
  }
  ok('every value sits between nothing and one', low >= 0 && high < 1, `${low} … ${high}`);
  ok('and none of them can index past the end of a list', high < 1);
  // Not a test of randomness — a test that it is not obviously lopsided, which
  // would make every generated table look the same.
  const fullest = Math.max(...buckets);
  const emptiest = Math.min(...buckets);
  ok('the spread is not lopsided', fullest < emptiest * 2,
    `fullest tenth ${fullest}, emptiest ${emptiest}`);
  ok('nothing usable as a seed still gives a number',
    M.seededRand(null, 0) >= 0 && M.seededRand(undefined, 3) < 1);
}

console.log('\nMoney is money, to the penny:');
{
  ok('a long fraction is rounded', M.roundMoney(10.005) === 10.01);
  ok('and a short one is left alone', M.roundMoney(10.5) === 10.5);
  ok('a whole number stays whole', M.roundMoney(10) === 10);
  ok('nothing usable is nothing, not a NaN',
    M.roundMoney('x') === 0 && M.roundMoney(null) === 0 && M.roundMoney(undefined) === 0);
  ok('a negative is rounded the same way', M.roundMoney(-2.345) === -2.35 || M.roundMoney(-2.345) === -2.34);
}

console.log('\nA new module never takes a name another one is using:');
{
  const slug = (s, f = 'module') => String(s || f).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || f;
  ok('a free name is taken as it is', M.uniqueModuleId(['orders'], 'Invoices', slug) === 'invoices');
  ok('a taken one is numbered', M.uniqueModuleId(['invoices'], 'Invoices', slug) === 'invoices_2');
  ok('and keeps counting', M.uniqueModuleId(['invoices', 'invoices_2'], 'Invoices', slug) === 'invoices_3');
  ok('nothing usable still gets an identifier', M.uniqueModuleId([], '', slug) === 'module');
  ok('and nothing that is not a list is survivable', M.uniqueModuleId(null, 'Orders', slug) === 'orders');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/systems/money.js)\n`);
process.exit(fail === 0 ? 0 : 1);
