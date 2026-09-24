const assert = require('node:assert');
const { formatDate, formatTime } = require('../src/format');

assert.strictEqual(formatDate(new Date(2024, 0, 5)), '2024-01-05');
assert.strictEqual(formatDate(new Date(2023, 11, 31)), '2023-12-31');
assert.strictEqual(formatDate(new Date(2025, 8, 9)), '2025-09-09');
assert.strictEqual(formatTime(new Date(2024, 0, 5, 7, 3)), '07:03');
console.log('check passed');
