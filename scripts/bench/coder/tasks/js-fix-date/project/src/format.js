const pad = (n) => String(n).padStart(2, '0');

// A date as YYYY-MM-DD, in local time.
function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

// A time as HH:MM, in local time.
function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = { formatDate, formatTime };
