const assert = require('node:assert');
const { capitalize, slugify } = require('../src/text');

assert.strictEqual(typeof slugify, 'function', 'slugify is exported');
assert.strictEqual(slugify('  Hello, World!  '), 'hello-world');
assert.strictEqual(slugify('Node.js 24 is out'), 'node-js-24-is-out');
assert.strictEqual(slugify('a--b'), 'a-b');
assert.strictEqual(slugify('***'), '');
assert.strictEqual(slugify(''), '');
assert.strictEqual(slugify('Already-a-slug'), 'already-a-slug');
assert.strictEqual(capitalize('word'), 'Word');
console.log('check passed');
