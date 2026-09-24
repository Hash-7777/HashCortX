const test = require('node:test');
const assert = require('node:assert');
const { range, sumRange } = require('../src/range');

test('includes both ends', () => {
  assert.deepStrictEqual(range(1, 5), [1, 2, 3, 4, 5]);
});

test('counts by step', () => {
  assert.deepStrictEqual(range(0, 10, 5), [0, 5, 10]);
});

test('sums what it lists', () => {
  assert.strictEqual(sumRange(1, 4), 10);
});
