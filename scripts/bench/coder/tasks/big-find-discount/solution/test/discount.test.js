const test = require('node:test');
const assert = require('node:assert');
const { stayTotal } = require('../server/pricing/nightly');

test('seven nights or more are 10% off', () => {
  assert.strictEqual(stayTotal({ name: 'Attic', rate: 100 }, 7), 630);
  assert.strictEqual(stayTotal({ name: 'Attic', rate: 100 }, 6), 600);
});
