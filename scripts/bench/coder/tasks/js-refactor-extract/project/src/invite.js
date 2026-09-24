// The addresses from a list that an invitation can be sent to.
function invitable(addresses) {
  return addresses
    .map((a) => String(a || '').trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

module.exports = { invitable };
