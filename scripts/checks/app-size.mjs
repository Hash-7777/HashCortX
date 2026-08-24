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
  // 3792, up from 3768. A model is drawn as one printed piece now — one
  // material for every part, matte, and solid once it has arrived — instead of
  // each part carrying its own colour on top of a colour for its role. The
  // added lines are the note saying why the joins, not the colours, are what a
  // person reads shape from.
  // 3663. The parts are no longer assembled on screen: the mote flight, the
  // scan line it was drawn with, and the per-part stagger are gone, and the
  // model simply fades up whole.
  // 3722, up from 3663. A part whose shape the app cannot build is now read as
  // the nearest one it can — a design that wrote an egg, a pipe and a ring used
  // to arrive as three identical cubes, silently. The run also says when a
  // design came back as plain blocks and balls, which was the model's doing and
  // looked like the app's.
  // 2962. 760 lines of hand-written subject geometry — spoons, knives, swords,
  // a phone, a laptop, a drone, a house, a tower, a human skeleton — reachable
  // from nothing. The only path to them was a padding pass whose caller had
  // already been switched off.
  // 3102, up from 2962. A model now knows how big it is in life: the size is
  // measured from the geometry that exists rather than assumed, shown on the
  // badge and in Properties, editable without rebuilding anything, and applied
  // when a file is written. The added lines are that lens and the note saying
  // why the scene span and the real size are deliberately two different things.
  // 3125, up from 3102. A design can do arithmetic and say "this part, twenty
  // four times around Y" instead of writing out twenty-four positions. The
  // added lines are the two fields that carry a repeat and the named values
  // through, and the prompt that tells a model both exist.
  // 3254, up from 3125. A model can be fused into one solid and cut: the
  // Solidify action builds the field, walks it into a single skin, puts that on
  // screen in place of the parts and writes it instead of them. The added lines
  // are that action and the note saying why it is a snapshot rather than a mode.
  // 3277, up from 3254. The fuse now says whether the thing could be made:
  // one line before export, then each finding with the number it was judged
  // against, so a person can disagree with the limit and not only the verdict.
  // 3283, up from 3277. The export path forced every material to an opacity
  // of 0.86 — a leftover of the reveal animation, harmless on screen and not
  // harmless in a file, because the GLB writer copies opacity into the base
  // colour's alpha. The added lines are the note saying why the number has to
  // be 1 and not merely high.
  // 3303, up from 3283. Mirroring can name its plane now, so an object laid
  // along X — which the prompt asks for — can have the symmetry it actually
  // has. The added lines are the reader that turns a request into a plane,
  // the plane carried onto both halves so a repair pass moves a twin the
  // right way, and the prompt sentence that offers the choice.
  // 3371, up from 3303. Saved projects moved out of the renderer's
  // localStorage and into a file. Most of the added lines are the difference
  // between a save that could fail silently and one that cannot: reading and
  // writing are now asynchronous, a store that could not be read switches
  // writing off rather than letting an empty list overwrite it, projects saved
  // by an older version are carried across once, and every caller says what
  // actually happened instead of assuming it worked.
  // 3397, up from 3371. Exports are written by this app now rather than by a
  // generic mesh exporter, so the bytes can be read back and measured. The
  // added lines are the collector that gathers the scene's meshes and their
  // placements — the placing, joining and mirrored-part winding all happen in
  // src/js/forge/io/scene.js, where they are plain arithmetic and are checked.
  // 3395, down two. OBJ is written by this app as well now, so the second
  // vendored exporter and the branch that loaded it are both gone.
  // 3402, up seven. A part can be exported as 3MF, the one format that states
  // its own unit, so it opens at the size it was designed at without anyone
  // typing a scale. The branch and the note saying why it is worth having.
  // 3413, up eleven. A part can be exported as STEP: a solid a CAD program
  // will edit, rather than a surface it will only look at. The added lines are
  // the branch and the notice that says every time that the body is faceted,
  // because the alternative is somebody opening the file expecting to fillet a
  // curve and finding a many-sided prism.
  // 3534, up from 3413. A part's own dimensions can be changed now — a
  // cylinder's radius rather than a scale factor on two axes that turns it
  // into an oval prism. Most of the added lines are the geometry asking
  // src/js/forge/params.js for every fallback instead of writing its own, so
  // the panel cannot show a number the part was not built with; the rest are
  // the fields and the one-part rebuild behind them.
  // 3604, up from 3534. The parts list is an ordered build list now, not a
  // flat set of labels: every part shows where it falls in the order, can be
  // moved earlier or later, and can be renamed. Order is not decoration — the
  // parts are folded into the solid in it, and cutting a bore then adding a
  // boss is a different object from the reverse.
  'modes/forge/mode.js': 3604,
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
