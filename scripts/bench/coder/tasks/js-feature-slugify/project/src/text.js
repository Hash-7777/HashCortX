// The text with its first letter in capitals.
function capitalize(text) {
  const s = String(text);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { capitalize };
