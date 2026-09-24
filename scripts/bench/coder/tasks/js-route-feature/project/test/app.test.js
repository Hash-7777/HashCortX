const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../src/app');

test('lists books', () => {
  assert.strictEqual(handle('GET', '/books').body.length, 2);
});

test('finds one book', () => {
  assert.strictEqual(handle('GET', '/books/2').body.id, 2);
});

test('answers 404 for anything else', () => {
  assert.strictEqual(handle('GET', '/nope').status, 404);
});
