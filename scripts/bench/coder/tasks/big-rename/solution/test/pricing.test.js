const test = require('node:test');
const assert = require('node:assert');
const { totalForStay } = require('../server/pricing/nightly');
const { quote } = require('../server/routes/bookings');

test('a stay costs the nightly rate for each night', () => {
  assert.strictEqual(totalForStay({ name: 'Garden Room', rate: 80 }, 3), 240);
});

test('a quote carries the total', () => {
  assert.deepStrictEqual(quote({ name: 'Attic', rate: 50 }, 2), { room: 'Attic', nights: 2, total: 100 });
});
