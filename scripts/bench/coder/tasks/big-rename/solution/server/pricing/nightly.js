// What a stay at the guesthouse costs.

/** The price of one night in `room`. */
function nightlyPrice(room) {
  return room.rate;
}

/** What a stay of `nights` nights in `room` costs in all. */
function totalForStay(room, nights) {
  return nightlyPrice(room) * nights;
}

module.exports = { nightlyPrice, totalForStay };
