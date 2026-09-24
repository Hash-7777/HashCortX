const test = require('node:test');
const assert = require('node:assert');
const { signupErrors } = require('../src/signup');
const { invitable } = require('../src/invite');

test('a good sign-up has no errors', () => {
  assert.deepStrictEqual(signupErrors({ name: 'Sara', email: 'sara@example.com', password: 'longenough' }), []);
});

test('a bad email is reported', () => {
  assert.deepStrictEqual(signupErrors({ name: 'Sara', email: 'sara@', password: 'longenough' }), ['email is not valid']);
});

test('only valid addresses are invited', () => {
  assert.deepStrictEqual(invitable(['a@b.co', 'nope', ' c@d.org ']), ['a@b.co', 'c@d.org']);
});
