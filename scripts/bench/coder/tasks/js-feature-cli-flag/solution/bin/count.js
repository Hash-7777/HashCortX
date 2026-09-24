#!/usr/bin/env node
// Prints how many words a text file has, or with --lines how many lines.
const fs = require('node:fs');

const args = process.argv.slice(2);
const lines = args.includes('--lines');
const file = args.find((a) => a !== '--lines');
if (!file) {
  console.error('usage: count [--lines] <file>');
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
if (lines) {
  console.log(text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
} else {
  console.log(text.split(/\s+/).filter(Boolean).length);
}
