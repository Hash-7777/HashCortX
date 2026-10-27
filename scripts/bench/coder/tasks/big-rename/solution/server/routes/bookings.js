const { totalForStay } = require('../pricing/nightly');

/** The answer to a booking request: the room, the nights and what it costs. */
function quote(room, nights) {
  return { room: room.name, nights, total: totalForStay(room, nights) };
}

module.exports = { quote };
