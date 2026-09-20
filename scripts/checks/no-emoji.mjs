// ==============================================================
// Nothing in the app is a picture typed as text
//
// Every mark the app shows is drawn, as an SVG, so it sits on the same
// baseline, takes the colour around it and looks the same on every machine. A
// typed picture — an emoji — does none of that: it arrives in the platform's
// own colours at the platform's own weight, and it is what made a workspace of
// line art look like a chat app.
//
// This reads every file the app ships and fails on one, naming the file, the
// line and the character. It covers what the app writes on screen AND what it
// asks a model to write, because an answer full of ticks and warning signs
// ends up on the same screen.
//
// Run with: npm run check:no-emoji
// ==============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = join(root, 'src');

// Pictographs, flags and anything wearing the emoji presentation selector.
//
// A few marks in the same block are plain typography, not pictures: a tick, a
// cross, a chevron, a four-pointed star. They are one colour, they take the
// colour of the text around them, and they are how a terminal line says a step
// finished. Those are named here and allowed; everything else in the block —
// the warning sign, the green tick, the red cross — is a picture.
const MARKS = '✓✔✗✘✕✖✦✧★☆❯❮·•—–…';
const PICTURE = new RegExp(`(?![${MARKS}])[\\u{1F000}-\\u{1FAFF}\\u{1F1E6}-\\u{1F1FF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]`, 'u');
// Kept on purpose, each for a reason:
const ALLOWED = new Map([
  // Takes pictures OUT of an answer before it is written to a file.
  ['js/export-format.js', 'it removes them from exported text'],
]);
const SKIP_DIRS = new Set(['vendor', 'wheels', 'assets']);
const EXTS = ['.js', '.html', '.css', '.json', '.txt', '.md'];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...files(full));
    } else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

let pass = 0;
let fail = 0;
const found = [];
for (const file of files(src)) {
  const rel = relative(src, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    const m = line.match(PICTURE);
    if (m) hits.push(`${rel}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 90)}`);
  });
  if (!hits.length) continue;
  if (ALLOWED.has(rel)) { pass++; console.log(`  ok    ${rel} keeps them — ${ALLOWED.get(rel)}`); continue; }
  found.push(...hits);
}
if (found.length) {
  fail++;
  console.log('  FAIL  a picture is typed as text where a drawn mark belongs:');
  for (const hit of found.slice(0, 40)) console.log(`          ${hit}`);
  if (found.length > 40) console.log(`          …and ${found.length - 40} more`);
} else {
  pass++;
  console.log('  ok    no picture is typed as text anywhere the app ships');
}

// The list is kept exact: an entry that no longer needs to be there comes off.
for (const [rel, why] of ALLOWED) {
  const full = join(src, rel);
  const still = readFileSync(full, 'utf8').match(PICTURE);
  if (still) { pass++; continue; }
  fail++;
  console.log(`  FAIL  ${rel} is on the kept list (${why}) and has none — take it off the list`);
}

console.log(`\n${pass} passed, ${fail} failed  (no typed pictures)`);
process.exit(fail ? 1 : 0);
