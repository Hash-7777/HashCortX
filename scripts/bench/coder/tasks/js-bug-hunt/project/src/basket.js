const { discountFor } = require('./codes');

function createBasket() {
  return { items: [], codes: [] };
}

function addItem(basket, name, price, quantity = 1) {
  basket.items.push({ name, price, quantity });
  return basket;
}

// Records a discount code the customer entered. Unknown codes are ignored.
function applyCode(basket, code) {
  if (discountFor(code) > 0) basket.codes.push(String(code).trim().toUpperCase());
  return basket;
}

function subtotal(basket) {
  return basket.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

// What the customer pays: the subtotal less every code's discount.
function total(basket) {
  const off = basket.codes.reduce((sum, code) => sum + discountFor(code), 0);
  return Math.round(subtotal(basket) * (1 - Math.min(off, 0.5)) * 100) / 100;
}

module.exports = { createBasket, addItem, applyCode, subtotal, total };
