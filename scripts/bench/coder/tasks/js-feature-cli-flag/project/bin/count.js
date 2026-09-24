#!/usr/bin/env node
// Prints how many words a text file has.
const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: count <file>');
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const words = text.split(/\s+/).filter(Boolean).length;
console.log(words);
