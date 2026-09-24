const { isValidEmail } = require('./validate');

// The addresses from a list that an invitation can be sent to.
function invitable(addresses) {
  return addresses
    .map((a) => String(a || '').trim())
    .filter(isValidEmail);
}

module.exports = { invitable };
