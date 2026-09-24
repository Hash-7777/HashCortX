// Hidden check: the project's own tests, and cases they do not cover.
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { range, sumRange } = require('../src/range');

execFileSync(process.execPath, ['--test'], { stdio: 'inherit' });
assert.deepStrictEqual(range(3, 3), [3]);
assert.deepStrictEqual(range(5, 1), []);
assert.deepStrictEqual(range(0, 9, 4), [0, 4, 8]);
assert.strictEqual(sumRange(1, 100), 5050);
assert.throws(() => range(1, 2, 0), RangeError);
console.log('check passed');
