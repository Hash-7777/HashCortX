const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { stayTotal } = require('../server/pricing/nightly');
const { quote } = require('../server/routes/bookings');
const { summaryLine } = require('../web/src/summary');
const room = { name: 'Garden Room', rate: 100 };
assert.strictEqual(stayTotal(room, 6), 600, 'six nights cost the full rate');
assert.strictEqual(stayTotal(room, 7), 630, 'seven nights are 10% off');
assert.strictEqual(stayTotal(room, 10), 900, 'ten nights are 10% off');
assert.strictEqual(quote(room, 8).total, 720, 'a quote carries the discount');
assert.ok(summaryLine(room, 7).endsWith('630'), 'the summary shows the discounted total');
// The dependency and the build output were not touched.
for (const rel of ['node_modules/rate-helpers/lib/part000.js', 'dist/app.bundle.js']) {
  assert.ok(fs.readFileSync(path.join(root, rel), 'utf8').includes('function stayTotal'), `${rel} was left alone`);
}
const tests = fs.readdirSync(path.join(root, 'test')).map((f) => fs.readFileSync(path.join(root, 'test', f), 'utf8')).join('\n');
assert.ok(/\b7\b|seven/i.test(tests) && /630|0\.9|10\s*%|discount/i.test(tests), 'a test covers the discount');
execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
console.log('check passed');
