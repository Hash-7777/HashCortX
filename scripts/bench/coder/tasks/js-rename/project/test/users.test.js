const test = require('node:test');
const assert = require('node:assert');
const { getUsr } = require('../src/users');
const { userResponse } = require('../src/api');

test('finds a user', () => {
  assert.strictEqual(getUsr(2).name, 'Omar');
});

test('answers 404 for a missing user', () => {
  assert.strictEqual(userResponse(9).status, 404);
});
