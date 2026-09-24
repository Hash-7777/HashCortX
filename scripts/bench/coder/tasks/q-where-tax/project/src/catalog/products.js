const PRODUCTS = [
  { sku: 'MUG-01', name: 'Mug', price: 120 },
  { sku: 'TEE-02', name: 'T-shirt', price: 340 },
];

function findProduct(sku) {
  return PRODUCTS.find((p) => p.sku === sku) || null;
}

module.exports = { findProduct };
