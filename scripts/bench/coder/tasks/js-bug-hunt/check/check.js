const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createBasket, addItem, applyCode, total } = require('../src/basket');
const b = addItem(addItem(createBasket(), 'lamp', 100), 'bulb', 10, 2);
applyCode(b, 'STAFF25');
applyCode(b, ' staff25');
applyCode(b, 'STAFF25');
assert.strictEqual(total(b), 90, 'a code entered three times counts once');
applyCode(b, 'WELCOME5');
assert.strictEqual(total(b), 84, 'a second, different code still counts');
applyCode(b, 'NOPE');
assert.strictEqual(total(b), 84, 'an unknown code changes nothing');
execFileSync(process.execPath, ['--test'], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
console.log('check passed');
