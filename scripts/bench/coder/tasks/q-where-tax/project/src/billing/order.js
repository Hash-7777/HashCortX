const { taxOn } = require('./tax');
const { shippingFor } = require('./shipping');

// What the customer pays for a list of { price, quantity } lines.
function orderTotal(lines, country) {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  return Math.round((subtotal + taxOn(subtotal) + shippingFor(country, subtotal)) * 100) / 100;
}

module.exports = { orderTotal };
