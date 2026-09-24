// The tests must pass on the real clamp, and fail on each broken one: a test
// that cannot catch a bug is not a test.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'test', 'clamp.test.js');
assert.ok(fs.existsSync(file), 'test/clamp.test.js exists');
const runs = () => spawnSync(process.execPath, ['--test', file], { cwd: root, encoding: 'utf8' }).status === 0;
assert.ok(runs(), 'the tests pass on the real clamp');

const real = fs.readFileSync(path.join(root, 'src', 'clamp.js'), 'utf8');
const broken = {
  'no lower bound': 'function clamp(v, min, max) { return Math.min(v, max); }',
  'no upper bound': 'function clamp(v, min, max) { return Math.max(v, min); }',
  'edges excluded': 'function clamp(v, min, max) { return v <= min ? min + 1 : v >= max ? max - 1 : v; }',
  'returns the value': 'function clamp(v) { return v; }',
};
const missed = [];
try {
  for (const [name, body] of Object.entries(broken)) {
    fs.writeFileSync(path.join(root, 'src', 'clamp.js'), body + '\nmodule.exports = { clamp };\n');
    if (runs()) missed.push(name);
  }
} finally {
  fs.writeFileSync(path.join(root, 'src', 'clamp.js'), real);
}
assert.deepStrictEqual(missed, [], 'the tests catch every broken clamp');
console.log('check passed');
