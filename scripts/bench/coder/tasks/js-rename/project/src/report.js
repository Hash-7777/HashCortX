const users = require('./users');

// One line per requested user, for the weekly report.
function reportLines(ids) {
  return ids.map((id) => {
    const user = users.getUsr(id);
    return user ? `${user.name} (${user.role})` : `unknown user ${id}`;
  });
}

module.exports = { reportLines };
