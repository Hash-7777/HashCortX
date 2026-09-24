const test = require('node:test');
const assert = require('node:assert');
const { createBasket, addItem, applyCode, total } = require('../src/basket');

test('one code takes its discount off', () => {
  const b = addItem(createBasket(), 'lamp', 100);
  applyCode(b, 'SPRING10');
  assert.strictEqual(total(b), 90);
});

test('the same code twice counts once', () => {
  const b = addItem(createBasket(), 'lamp', 100);
  applyCode(b, 'SPRING10');
  applyCode(b, 'spring10 ');
  assert.strictEqual(total(b), 90);
});

test('two different codes both count', () => {
  const b = addItem(createBasket(), 'lamp', 100);
  applyCode(b, 'SPRING10');
  applyCode(b, 'WELCOME5');
  assert.strictEqual(total(b), 85);
});
