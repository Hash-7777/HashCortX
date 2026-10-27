const { stayTotal } = require('../pricing/nightly');

/** The answer to a booking request: the room, the nights and what it costs. */
function quote(room, nights) {
  return { room: room.name, nights, total: stayTotal(room, nights) };
}

module.exports = { quote };
