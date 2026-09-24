const { ROUTES } = require('./routes');

// The parameters a path fills in for a pattern like /books/:id, or null.
function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i];
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// The answer to one request.
function handle(method, path) {
  for (const route of ROUTES) {
    const params = route.method === method ? match(route.path, path) : null;
    if (params) return route.handler(params);
  }
  return { status: 404, body: { error: 'no such route' } };
}

module.exports = { handle };
