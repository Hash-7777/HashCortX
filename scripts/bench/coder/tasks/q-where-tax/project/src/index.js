const { orderTotal } = require('./billing/order');
const { findProduct } = require('./catalog/products');

module.exports = { orderTotal, findProduct };
