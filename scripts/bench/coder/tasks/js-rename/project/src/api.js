const { getUsr } = require('./users');

// What the API answers for GET /users/:id.
function userResponse(id) {
  const user = getUsr(Number(id));
  if (!user) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: user };
}

module.exports = { userResponse };
