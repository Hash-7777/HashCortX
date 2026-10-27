const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const left = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'logs', '.bench-check', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\bstayTotal\b/.test(fs.readFileSync(p, 'utf8'))) left.push(path.relative(root, p));
  }
})(root);
assert.deepStrictEqual(left, [], 'no file of the project still names stayTotal');
const { totalForStay } = require('../server/pricing/nightly');
const { quote } = require('../server/routes/bookings');
const { summaryLine } = require('../web/src/summary');
assert.strictEqual(totalForStay({ name: 'Attic', rate: 50 }, 2), 100);
assert.strictEqual(quote({ name: 'Attic', rate: 50 }, 2).total, 100);
assert.ok(summaryLine({ name: 'Attic', rate: 50 }, 2).endsWith('100'));
for (const rel of ['node_modules/rate-helpers/lib/part000.js', 'dist/app.bundle.js']) {
  assert.ok(fs.readFileSync(path.join(root, rel), 'utf8').includes('function stayTotal'), `${rel} was left alone`);
}
execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
console.log('check passed');
