const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'greet.js'), 'utf8');
assert.ok(!/(^|[^\r])\n/.test(text), 'every line still ends with CRLF');
assert.ok(!/Hello/.test(text), 'no Hello left');
const { greet, greetAll } = require('../src/greet');
assert.strictEqual(greet('Mona'), 'Hi, Mona!');
assert.strictEqual(greetAll(['A', 'B']), 'Hi, A! Hi, B!');
assert.strictEqual(greetAll([]), 'Hi, everyone!');
console.log('check passed');
