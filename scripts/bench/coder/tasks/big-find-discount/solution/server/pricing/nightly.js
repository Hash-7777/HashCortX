// What a stay at the guesthouse costs.

/** The price of one night in `room`. */
function nightlyPrice(room) {
  return room.rate;
}

/** What a stay of `nights` nights in `room` costs in all: 10% off for 7 nights or more. */
function stayTotal(room, nights) {
  const total = nightlyPrice(room) * nights;
  return nights >= 7 ? Math.round(total * 0.9 * 100) / 100 : total;
}

module.exports = { nightlyPrice, stayTotal };
