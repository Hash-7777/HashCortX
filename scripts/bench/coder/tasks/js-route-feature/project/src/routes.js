const handlers = require('./handlers');

// Every route the server answers, in the order they are tried.
const ROUTES = [
  { method: 'GET', path: '/books', handler: handlers.listBooks },
  { method: 'GET', path: '/books/:id', handler: handlers.getBook },
];

module.exports = { ROUTES };
