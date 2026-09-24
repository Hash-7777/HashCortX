// Flat shipping, free over a threshold.
const FREE_OVER = 500;
const FLAT = { EG: 45, SA: 60 };

function shippingFor(country, subtotal) {
  if (subtotal >= FREE_OVER) return 0;
  return FLAT[country] ?? 80;
}

module.exports = { shippingFor, FREE_OVER };
