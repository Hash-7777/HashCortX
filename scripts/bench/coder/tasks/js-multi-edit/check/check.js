const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../src/limits');
assert.strictEqual(L.MAX_USERS, 100);
assert.strictEqual(L.MAX_UPLOAD_MB, 25);
assert.strictEqual(L.TIMEOUT_SECONDS, 60);
assert.strictEqual(L.MAX_PROJECTS, 200);
assert.strictEqual(L.WEBHOOK_RETRIES, 5);
// Every line but the three is exactly as it was.
const before = fs.readFileSync(path.join(__dirname, 'original.js'), 'utf8').split('\n');
const now = fs.readFileSync(path.join(__dirname, '..', 'src', 'limits.js'), 'utf8').split('\n');
assert.strictEqual(now.length, before.length, 'same number of lines');
const changed = before.map((line, i) => (line === now[i] ? null : i + 1)).filter(Boolean);
assert.strictEqual(changed.length, 3, 'exactly three lines changed, found ' + changed.join(', '));
console.log('check passed');
