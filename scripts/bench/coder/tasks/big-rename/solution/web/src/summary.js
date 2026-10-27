const { totalForStay } = require('../../server/pricing/nightly');

/** The line the booking summary shows under the dates. */
function summaryLine(room, nights) {
  return `${nights} nights in ${room.name}: ${totalForStay(room, nights)}`;
}

module.exports = { summaryLine };
