const USERS = [
  { id: 1, name: 'Amira', role: 'admin' },
  { id: 2, name: 'Omar', role: 'editor' },
  { id: 3, name: 'Lina', role: 'viewer' },
];

// The user with this id, or null.
function getUsr(id) {
  return USERS.find((u) => u.id === id) || null;
}

function allUsers() {
  return USERS.slice();
}

module.exports = { getUsr, allUsers };
