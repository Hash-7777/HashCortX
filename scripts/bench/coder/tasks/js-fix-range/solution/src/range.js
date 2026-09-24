// Whole numbers from start to end, both included, counting up by step.
function range(start, end, step = 1) {
  if (step <= 0) throw new RangeError('step must be positive');
  const out = [];
  for (let n = start; n <= end; n += step) out.push(n);
  return out;
}

// The sum of the numbers range() would list.
function sumRange(start, end, step = 1) {
  return range(start, end, step).reduce((total, n) => total + n, 0);
}

module.exports = { range, sumRange };
