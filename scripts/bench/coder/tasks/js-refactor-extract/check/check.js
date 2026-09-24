const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const { isValidEmail } = require('../src/validate');
assert.strictEqual(typeof isValidEmail, 'function', 'src/validate.js exports isValidEmail');
assert.strictEqual(isValidEmail('a@b.co'), true);
assert.strictEqual(isValidEmail('a@b'), false);
for (const f of ['src/signup.js', 'src/invite.js']) {
  const text = read(f);
  assert.ok(/isValidEmail/.test(text), `${f} uses isValidEmail`);
  assert.ok(!/\/\^\[\^\\s@\]/.test(text), `${f} no longer carries its own copy of the pattern`);
}
const { signupErrors } = require('../src/signup');
const { invitable } = require('../src/invite');
assert.deepStrictEqual(signupErrors({ name: '', email: 'x', password: '1' }), ['name is required', 'email is not valid', 'password is too short']);
assert.deepStrictEqual(invitable([' e@f.io', 'bad@', null]), ['e@f.io']);
execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
console.log('check passed');
