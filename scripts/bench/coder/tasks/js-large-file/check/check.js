const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { calcShipping, ZONES } = require('../src/rates');
const base = ZONES.north.base(false);
assert.strictEqual(calcShipping('north', 10), base, 'under 20 kg is the base charge');
assert.strictEqual(calcShipping('north', 20), base, '20 kg is still the base charge');
assert.strictEqual(calcShipping('north', 24), Math.round((base + 10) * 100) / 100, '4 kg over adds 10');
assert.strictEqual(calcShipping('coast', 20.5, true), Math.round((ZONES.coast.base(true) + 2.5) * 100) / 100);
const before = fs.readFileSync(path.join(__dirname, 'original.js'), 'utf8').split('\n');
const now = fs.readFileSync(path.join(__dirname, '..', 'src', 'rates.js'), 'utf8').split('\n');
const changed = before.filter((line, i) => line !== now[i]).length + Math.abs(before.length - now.length);
assert.ok(changed <= 3, `only the faulty line changes (${changed} lines differ)`);
console.log('check passed');
