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
  // 7075, up from 7059. The typewriter that types an agent's answer into the
  // bubble now answers a promise the agent loop waits for, instead of running
  // on detached frames that painted the raw markdown back over the rendered
  // reply after the turn had ended. The added lines are the promise, an
  // abort branch so a stopped answer is not left truncated, and the note
  // saying why the wait matters.
  // 7085, up from 7075. Ten lines of comment, no code: agent dispatch also
  // required the context-injection toggle, which defaults to off, so a new
  // install could select an agent and silently get plain chat. The condition
  // is now the agent alone, and the note records why that toggle never had
  // anything to say about it.
  // 7093, up eight. The chat fetch tool now says the page is being retrieved
  // while it is: approving released the request and the wait that followed was
  // silent, which read as the click having hung.
  'js/app.js': 7093,
  // 4246, up from 4220. The repair pass can now fail over to another model
  // instead of the run abandoning a parsed spec and generating a fresh one from
  // nothing, and it states which validation issues it is repairing. Both are in
  // finalizeOrRepairGeneratedSpec, which is where the run's work was being
  // thrown away.
  'modes/systems/mode.js': 4246,
  'modes/virtual-os/mode.js': 3808,
  // 3820, up from 3756. The trace drawer could be read and never taken: no
  // selection, no copy, no file. Most of these lines are the two handlers and
  // the single reader that turns the entries into text for both. The rest is
  // the observer that keeps the viewport's aspect when the drawer changes the
  // canvas's height without the window resizing.
  // 3872, up from 3820. The deterministic stage is now wired in: symmetry,
  // floor contact and unrenderable parts are settled in code before anything
  // is drawn, and the Audit Agent that used to be asked for them — and that
  // added marker geometry of its own — is gone from the pipeline.
  // 3552. The model is now set on the floor from the geometry that exists,
  // measured once the meshes are built, rather than from a part's declared
  // width and radius. A real run lifted a fish by 2.40 on the estimate and
  // left it hanging above the grid.
  'modes/forge/mode.js': 3879,
  'modes/agent-maker/mode.js': 2980,
  'modes/finance/mode.js': 2705,
  'modes/code/mode.js': 2715,
};

console.log('\nFile sizes go down, never up:');
for (const [file, budget] of Object.entries(LINE_BUDGET)) {
  ratchet(file, lines(file), budget, 'move something into its own file rather than growing this one');
}

// index.html is measured differently, on purpose.
//
// A plain line count punishes the thing it is supposed to reward. Moving a
// block of code out of app.js into its own file adds one <script> line here,
// so a shell budget counted naively fails on exactly the change that makes the
// app smaller — and the way to make it pass would be to not extract anything.
//
// So the asset lines are excluded. They are a manifest of what the page loads,
// not content the shell is carrying, and in Stage 3 they stop being written by
// hand at all. What is counted is markup: the shell's own structure, plus the
// mode panels that should not be in it. That number may only fall.
const SHELL_MARKUP_BUDGET = 625;

console.log('\nThe shell holds no more markup than it did:');
{
  const isAsset = (l) => /<script\s+src=|<link[^>]+rel="stylesheet"/.test(l);
  const markup = textLines(read('index.html')).filter((l) => !isAsset(l));
  ratchet('index.html markup lines', markup.length, SHELL_MARKUP_BUDGET,
    'new markup in the shell belongs to whatever owns it');
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
const RESPONSIBILITY_BUDGET = 14;

console.log('\napp.js holds fewer separate responsibilities over time:');
{
  const banners = read('js/app.js').match(/^\s*\/\/ ={5,} .* ={5,}$/gm) || [];
  ratchet('app.js sections', banners.length, RESPONSIBILITY_BUDGET,
    'a new section in this file is a new file that was not created');
}

// ── 3. No mode markup comes back to the shell ────────────────────────────
//
// These were 1,124 lines — 47% of index.html — of full-screen panels sitting
// in the shared document, parsed on every launch for the one mode the user is
// in. They are now in src/modes/<id>/panel.html and inserted at boot.
//
// The budget is zero and stays zero. This is no longer a debt being paid down;
// it is a line that has been drawn, and the check is what keeps the next
// mode's markup from being pasted into the shell because it was quicker.
const MODE_WRAPS = [
  'sandbox-wrap', 'forge-mode-wrap', 'agent-maker-wrap',
  'system-maker-wrap', 'virtual-os-wrap', 'coder-mode-wrap',
];
const MODE_MARKUP_BUDGET = 0;

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
