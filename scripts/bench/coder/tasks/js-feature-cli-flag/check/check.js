const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tool = path.join(__dirname, '..', 'bin', 'count.js');
const sample = path.join(__dirname, 'sample.txt');
fs.writeFileSync(sample, 'one two\nthree\n\nfour five six');
const run = (...args) => execFileSync(process.execPath, [tool, ...args], { encoding: 'utf8' }).trim();

assert.strictEqual(run(sample), '6', 'word count without the option');
assert.strictEqual(run('--lines', sample), '4', 'line count with --lines');
fs.writeFileSync(sample, 'a\nb\n');
assert.strictEqual(run('--lines', sample), '2', 'a trailing newline does not add a line');
assert.strictEqual(run(sample), '2');
console.log('check passed');
