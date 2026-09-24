// Value added tax, charged on the goods and not on shipping.
const VAT = 0.14;

function taxOn(amount) {
  return Math.round(amount * VAT * 100) / 100;
}

module.exports = { taxOn, VAT };
