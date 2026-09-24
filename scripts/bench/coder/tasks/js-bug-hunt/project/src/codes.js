// Discount codes and what each one takes off, as a fraction of the subtotal.
const CODES = {
  SPRING10: 0.10,
  WELCOME5: 0.05,
  STAFF25: 0.25,
};

function discountFor(code) {
  return CODES[String(code || '').trim().toUpperCase()] || 0;
}

module.exports = { discountFor };
