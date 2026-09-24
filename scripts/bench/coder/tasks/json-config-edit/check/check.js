const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const text = fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8');
let now;
try { now = JSON.parse(text); } catch (e) { throw new Error('config/app.json is no longer valid JSON: ' + e.message); }
const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'original.json'), 'utf8'));
assert.strictEqual(now.server.port, 8080, 'port is 8080 (a number)');
assert.strictEqual(now.server.logLevel, 'warn', 'server.logLevel is "warn"');
const expected = JSON.parse(JSON.stringify(before));
expected.server.port = 8080;
expected.server.logLevel = 'warn';
assert.deepStrictEqual(now, expected, 'nothing else changed');
console.log('check passed');
