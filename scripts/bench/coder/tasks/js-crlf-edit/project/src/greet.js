// Greetings shown on the welcome screen.

function greet(name) {
  return `Hello, ${name}!`;
}

function greetAll(names) {
  if (!names.length) return "Hello, everyone!";
  return names.map((n) => `Hello, ${n}!`).join(" ");
}

module.exports = { greet, greetAll };
