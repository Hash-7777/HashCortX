// The value, held between min and max (both included).
function clamp(value, min, max) {
  if (min > max) throw new RangeError('min is above max');
  return Math.min(Math.max(value, min), max);
}

module.exports = { clamp };
