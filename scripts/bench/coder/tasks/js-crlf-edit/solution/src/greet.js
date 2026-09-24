// Greetings shown on the welcome screen.

function greet(name) {
  return `Hi, ${name}!`;
}

function greetAll(names) {
  if (!names.length) return "Hi, everyone!";
  return names.map((n) => `Hi, ${n}!`).join(" ");
}

module.exports = { greet, greetAll };
