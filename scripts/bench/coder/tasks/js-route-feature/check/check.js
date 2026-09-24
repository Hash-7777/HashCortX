const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { handle } = require('../src/app');
const { ROUTES } = require('../src/routes');
const health = handle('GET', '/health');
assert.deepStrictEqual(health.body, { status: 'ok' }, 'GET /health answers { status: "ok" }');
assert.ok(!health.status || health.status === 200, 'with status 200');
assert.ok(ROUTES.some((r) => r.method === 'GET' && r.path === '/health'), '/health is registered in ROUTES');
assert.strictEqual(handle('POST', '/health').status, 404, 'only GET');
assert.strictEqual(handle('GET', '/books/1').body.id, 1, 'the other routes still work');
execFileSync(process.execPath, ['--test'], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
console.log('check passed');
