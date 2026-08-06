// ==============================================================
// Size ratchets — checks
//
// src/js/app.js is 8,682 lines in a single IIFE, holding sixteen separate
// responsibilities: state, projects, persistence, tabs, the agents UI, the
// agent editor, settings, cloud models, rendering, prompts, the send pipeline,
// agent tools, the Python sandbox, the knowledge base, boot, and the swarm.
//
// index.html is 2,373 lines, and 1,124 of them — nearly half — are the markup
// of full-screen modes that are hidden almost all of the time. Every launch
// parses all of it for the one mode the user is in.
//
// Neither file got that way by decision. They got that way because there was
// never a number that said no. A file with everything in it has no natural
// place to stop, so the next feature goes in it too, and each time the reason
// is good.
//
// This is the number that says no. It is a two-way ratchet, the same shape as
// the colour budgets in theme.mjs: a file may not grow past what is recorded,
// AND may not shrink without the record being updated. The second half is what
// makes paying it down deliberate — it turns "I moved some code out" into a
// line in a commit.
//
// Three measures, because lines alone are easy to game by moving a big file
// somewhere else:
//
//   1. Lines per file.
//   2. How many separate responsibilities app.js holds, counted by its own
//      section banners. Splitting it means this falls.
//   3. How much of index.html is mode markup rather than shell.
//
// Run with: npm run check:app-size
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');
const read = (f) => readFileSync(join(srcDir, f), 'utf8');
// Lines of text. A single trailing newline terminates the last line rather
// than starting an empty one — otherwise every file reads one line longer than
// `wc -l` says, and the budgets below would all be off by one.
const textLines = (s) => s.replace(/\n$/, '').split('\n');
const lines = (f) => textLines(read(f)).length;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A two-way ratchet: may not rise, and may not fall without being recorded. */
function ratchet(label, actual, budget, whenOver) {
  if (actual > budget) check(label, false, `${actual}, budget ${budget} — ${whenOver}`);
  else if (actual < budget) check(label, false, `${actual}, budget ${budget} — good, now lower the budget to ${actual}`);
  else check(`${label} (${actual})`, true);
}

// ── 1. Lines per file ────────────────────────────────────────────────────
//
// Only the files big enough to hide things in. A 300-line module does not need
// a ceiling; an 8,000-line one is where a dead branch survives for a year.
const LINE_BUDGET = {
  'js/app.js': 8682,
  'index.html': 2372,
  'js/system-maker.js': 4220,
  'js/virtual-os.js': 3836,
  'js/forge-mode.js': 3756,
  'js/swarm-maker.js': 3025,
  'js/finance-mode.js': 2705,
  'js/code-mode.js': 2695,
};

console.log('\nFile sizes go down, never up:');
for (const [file, budget] of Object.entries(LINE_BUDGET)) {
  ratchet(file, lines(file), budget, 'move something into its own file rather than growing this one');
}

// ── 2. How many things app.js is responsible for ─────────────────────────
//
// Counted from the file's own `// ========= Name =========` banners. Those
// banners are already an admission: someone drew a line because the file had
// stopped being one thing. Sixteen lines drawn inside one closure means
// sixteen things that can see each other's variables whether they should or
// not, which is the actual cost — not the length.
//
// This falls by one every time a section becomes a file.
const RESPONSIBILITY_BUDGET = 16;

console.log('\napp.js holds fewer separate responsibilities over time:');
{
  const banners = read('js/app.js').match(/^\s*\/\/ ={5,} .* ={5,}$/gm) || [];
  ratchet('app.js sections', banners.length, RESPONSIBILITY_BUDGET,
    'a new section in this file is a new file that was not created');
}

// ── 3. How much of the shell is really a mode ────────────────────────────
//
// Each of these blocks is a full-screen mode's markup, sitting in the shared
// document. It belongs with the mode's JS and CSS, and until it moves there,
// adding a mode means editing index.html in four places with nothing checking
// that you did all four.
//
// Falls to zero as each mode takes its markup into its own folder.
const MODE_WRAPS = [
  'sandbox-wrap', 'forge-mode-wrap', 'agent-maker-wrap',
  'system-maker-wrap', 'virtual-os-wrap', 'coder-mode-wrap',
];
const MODE_MARKUP_BUDGET = 1124;

console.log('\nMode markup leaves the shell:');
{
  const src = textLines(read('index.html'));
  let total = 0;
  const per = [];
  for (const id of MODE_WRAPS) {
    const start = src.findIndex((l) => l.includes(`id="${id}"`));
    if (start === -1) { per.push(`${id}: gone`); continue; }
    // Walk div depth from the opening tag until it closes. Depth goes above
    // zero on the opening line, so the first time it returns to zero is the
    // wrap's own closing tag.
    let depth = 0, end = start;
    for (let i = start; i < src.length; i++) {
      depth += (src[i].match(/<div\b/g) || []).length - (src[i].match(/<\/div>/g) || []).length;
      if (depth <= 0) { end = i; break; }
    }
    const n = end - start + 1;
    total += n;
    per.push(`${id}: ${n}`);
  }
  console.log(`        ${per.join('  ·  ')}`);
  ratchet('lines of mode markup in index.html', total, MODE_MARKUP_BUDGET,
    'a mode\'s markup belongs in the mode\'s own folder');
}

console.log(`\n${pass} passed, ${fail} failed  (size ratchets)`);
process.exit(fail ? 1 : 0);
