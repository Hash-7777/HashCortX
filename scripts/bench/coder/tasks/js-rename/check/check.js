const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const left = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.bench-check' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/getUsr\b/.test(fs.readFileSync(p, 'utf8'))) left.push(path.relative(root, p));
  }
})(root);
assert.deepStrictEqual(left, [], 'no file still names getUsr');

const { getUser } = require('../src/users');
const { userResponse } = require('../src/api');
const { reportLines } = require('../src/report');
assert.strictEqual(getUser(1).name, 'Amira');
assert.strictEqual(userResponse(3).body.name, 'Lina');
assert.deepStrictEqual(reportLines([2, 7]), ['Omar (editor)', 'unknown user 7']);
execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
console.log('check passed');
