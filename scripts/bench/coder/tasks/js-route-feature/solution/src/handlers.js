const BOOKS = [
  { id: 1, title: 'The Cairo Trilogy' },
  { id: 2, title: 'Season of Migration to the North' },
];

function listBooks() {
  return { status: 200, body: BOOKS };
}

function getBook(params) {
  const book = BOOKS.find((b) => b.id === Number(params.id));
  return book ? { status: 200, body: book } : { status: 404, body: { error: 'not found' } };
}

function health() {
  return { status: 200, body: { status: 'ok' } };
}

module.exports = { listBooks, getBook, health };
