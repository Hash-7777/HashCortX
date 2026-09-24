const test = require('node:test');
const assert = require('node:assert');
const { clamp } = require('../src/clamp');

test('a value below the range becomes the minimum', () => {
  assert.strictEqual(clamp(-5, 0, 10), 0);
});

test('a value inside the range is unchanged', () => {
  assert.strictEqual(clamp(4, 0, 10), 4);
});

test('a value above the range becomes the maximum', () => {
  assert.strictEqual(clamp(15, 0, 10), 10);
});

test('the edges are inside the range', () => {
  assert.strictEqual(clamp(0, 0, 10), 0);
  assert.strictEqual(clamp(10, 0, 10), 10);
});
