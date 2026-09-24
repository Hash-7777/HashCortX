const { isValidEmail } = require('./validate');

// Checks a sign-up form and lists what is wrong with it.
function signupErrors(form) {
  const errors = [];
  if (!form.name || !form.name.trim()) errors.push('name is required');
  if (!isValidEmail(form.email)) errors.push('email is not valid');
  if (String(form.password || '').length < 8) errors.push('password is too short');
  return errors;
}

module.exports = { signupErrors };
