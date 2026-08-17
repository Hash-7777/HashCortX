// ==============================================================
// One stylesheet layer — checks
//
// HashCortx has two design systems.
//
// src/css/*.css is the first: tokens in vars.css, --sans / --serif / --mono,
// one sheet per area. src/styles.css is the second: its own --hc-* namespace,
// its own type scale, 343 selectors — and it is linked LAST, so wherever the
// two disagree, it wins. Nothing in either file says so. You find out by
// changing a rule in css/ and watching nothing happen.
//
// The vocabularies no longer collide, which is the half that would hurt most:
// the second system keeps to its --hc-* namespace, and the only sheets that
// reach for a shared token do it inside a selector, on purpose. Section 5
// holds that. What remains is overlap of SELECTORS and a pile of !important,
// which the ratchets below are grinding down.
//
// This is not a tidiness complaint. It is where the bugs come from:
//
//   • `html,body { font-family: var(--hc-font) }` in the second system made the
//     entire app monospace. Every font choice in the first system was dead.
//   • A `low-gpu` rule with !important made the shipping wallpaper opacity
//     unreachable, so the value being tuned was never the value that shipped.
//   • The `background` shorthand in a shared rule silently erased a select's
//     caret image, because the shorthand resets background-image.
//   • `[hidden]` lost to `.field { display:flex }`, and then again to
//     `button { display:inline-flex }` — twice, weeks apart, same cause.
//
// Every one of those is the same shape: two rules for one thing, and the
// loser is the one you are reading. So this file measures the overlap and
// refuses to let it grow.
//
//   1. Load order is a decision, written down — not whatever the last edit did.
//   2. RATCHET — selectors declared in more than one sheet.
//   3. RATCHET — !important per sheet. Each one is a fight that should have
//      been settled by deleting the other rule.
//   4. RATCHET — the size of the second token namespace, down to nothing.
//
// Run with: npm run check:css-layers
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stylesheets } from './lib/page-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');
const read = (f) => readFileSync(join(srcDir, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The sheets the app loads, in the order it loads them. Order is the point. */
const SHEETS = stylesheets(srcDir);

/**
 * Every selector a sheet declares, qualified by the at-rule it sits inside.
 *
 * Written as a small walker rather than a regex because two things have to be
 * right or the numbers lie. @keyframes stops (`0%`, `from`, `to`) are not
 * selectors, and counting them made a first pass report 98 duplicates where
 * there were 57. And a selector inside `@media (max-width: 900px)` is not the
 * same rule as the same selector outside it, so the media condition is carried
 * into the key.
 */
function selectorsOf(file) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  const stack = [];
  let buf = '';
  for (const c of css) {
    if (c === '{') {
      const head = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (head.startsWith('@')) { stack.push({ kind: 'at', head }); continue; }
      if (stack.some((s) => s.kind === 'at' && s.head.startsWith('@keyframes'))) {
        stack.push({ kind: 'stop', head });
        continue;
      }
      const context = stack.filter((s) => s.kind === 'at').map((s) => s.head).join(' ');
      for (const part of head.split(',')) {
        const sel = part.trim().replace(/\s+/g, ' ');
        if (sel) out.add(context ? `${context} | ${sel}` : sel);
      }
      stack.push({ kind: 'rule', head });
    } else if (c === '}') {
      stack.pop();
      buf = '';
    } else {
      buf += c;
    }
  }
  return out;
}

// ── 1. Load order is stated ──────────────────────────────────────────────
//
// styles.css having the last word is currently load-bearing — a fair amount of
// the app looks the way it does because of it. That is survivable while it is
// deliberate. What is not survivable is someone adding a sheet after it and
// changing which system wins, for every rule at once, without meaning to.
console.log('\nLoad order is a decision, not an accident:');
{
  check('styles.css is loaded last',
    SHEETS[SHEETS.length - 1] === 'styles.css',
    `last is ${SHEETS[SHEETS.length - 1]} — the override chain just changed`);
  check('vars.css is loaded first',
    SHEETS[0] === 'css/vars.css',
    `first is ${SHEETS[0]} — tokens must exist before anything reads them`);
}

// ── 2. Selectors declared in more than one sheet ─────────────────────────
//
// Two sheets styling one selector means one of them is invisible, and which
// one depends on link order rather than on anything in the rule. Lower the
// budget as rules are merged into the sheet that owns them.
const DUPLICATE_BUDGET = 54;

console.log('\nSelectors declared in more than one sheet go down, never up:');
{
  const owners = new Map();
  for (const file of SHEETS) {
    for (const sel of selectorsOf(file)) {
      if (!owners.has(sel)) owners.set(sel, []);
      owners.get(sel).push(file);
    }
  }
  const duplicated = [...owners.entries()].filter(([, files]) => files.length > 1);
  const n = duplicated.length;

  if (n > DUPLICATE_BUDGET) {
    const worst = duplicated
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([sel, files]) => `${sel} (${files.join(' + ')})`);
    check('duplicated selectors', false,
      `${n}, budget ${DUPLICATE_BUDGET} — one of each pair is dead. Worst:\n          ${worst.join('\n          ')}`);
  } else if (n < DUPLICATE_BUDGET) {
    check('duplicated selectors', false,
      `${n}, budget ${DUPLICATE_BUDGET} — good, now lower the budget to ${n}`);
  } else {
    check(`duplicated selectors (${n})`, true);
  }
}

// ── 3. !important per sheet ──────────────────────────────────────────────
//
// Almost every one of these exists to beat another rule in this same app.
// Deleting the rule it is fighting is the fix; adding a second !important is
// how a stylesheet becomes unreadable. modals.css and styles.css hold 246 of
// the 245-odd in the app between them, which is the shape of the problem.
const IMPORTANT_BUDGET = {
  // 153, not 154: one of these was a mention inside a comment.
  'styles.css': 153,
  // 83, down from 92: the memory map's nine went with its own palette. Every
  // one of them was there to beat a rule the map itself had no need to fight —
  // it was forcing its width, its padding, its display mode and the stroke on
  // its own icons. Built on the shared tokens it wins those on specificity.
  'css/modals.css': 83,
  'css/modes.css': 17,
  'modes/sandbox/mode.css': 14,
  // 10, not 11: one was a mention inside a comment.
  'modes/agent-maker/mode.css': 10,
  'modes/virtual-os/mode.css': 11,
  'modes/code/mode.css': 11,
  'modes/systems/mode.css': 10,
  'css/base.css': 8,
  'modes/finance/mode.css': 4,
  'css/main.css': 3,
  'css/vars.css': 0,
  'css/sidebar.css': 0,
  'css/tabs.css': 0,
  'css/composer.css': 0,
  'modes/forge/mode.css': 0,
};

console.log('\n!important counts go down, never up:');
{
  check('every loaded sheet has a recorded budget',
    SHEETS.every((f) => f in IMPORTANT_BUDGET),
    SHEETS.filter((f) => !(f in IMPORTANT_BUDGET)).join(', '));
  check('every recorded budget is for a sheet still loaded',
    Object.keys(IMPORTANT_BUDGET).every((f) => SHEETS.includes(f)),
    Object.keys(IMPORTANT_BUDGET).filter((f) => !SHEETS.includes(f)).join(', '));

  for (const file of SHEETS.filter((f) => f in IMPORTANT_BUDGET)) {
    // Comments first. This counted the word, not the declaration, so a comment
    // explaining why a rule needs !important read as another one — three sheets
    // were each carrying a phantom. A note about the debt is not the debt.
    const n = (read(file).replace(/\/\*[\s\S]*?\*\//g, '').match(/!important/g) || []).length;
    if (n > IMPORTANT_BUDGET[file]) {
      check(`${file}`, false, `${n} !important, budget ${IMPORTANT_BUDGET[file]} — delete the rule it is fighting instead`);
    } else if (n < IMPORTANT_BUDGET[file]) {
      check(`${file}`, false, `${n} !important, budget ${IMPORTANT_BUDGET[file]} — good, now lower the budget to ${n}`);
    } else {
      check(`${file} (${n})`, true);
    }
  }
}

// ── 4. The second token namespace shrinks to nothing ─────────────────────
//
// styles.css defined 38 --hc-* tokens. 27 of them — the entire parallel
// spacing scale, the radius scale, the shadows and the transitions — were
// never referenced by a single rule anywhere in the app. A second design
// system that nothing used. They are gone.
//
// The eleven left are read by something, and they are not duplicates of the
// vars.css tokens: --hc-font is the intro screen's JetBrains Mono stack and
// the colours are its own cyan palette. Folding those into vars.css changes
// what is drawn, so it is its own change rather than a tidy-up — which is why
// this number is 11 and not 0 yet.
const HC_TOKEN_BUDGET = 11;

console.log('\nThe second token namespace shrinks to nothing:');
{
  const n = (read('styles.css').match(/^\s*--hc-[a-z0-9-]+\s*:/gm) || []).length;
  if (n > HC_TOKEN_BUDGET) {
    check('--hc-* tokens defined', false, `${n}, budget ${HC_TOKEN_BUDGET} — put it in vars.css instead`);
  } else if (n < HC_TOKEN_BUDGET) {
    check('--hc-* tokens defined', false, `${n}, budget ${HC_TOKEN_BUDGET} — good, now lower the budget to ${n}`);
  } else {
    check(`--hc-* tokens defined (${n})`, true);
  }
}

// ── 5. No sheet takes a shared token away from vars.css ──────────────────
//
// The overlap that would hurt most is not a duplicated selector — it is a
// redefined TOKEN. vars.css owns the shared vocabulary, and a sheet loaded
// after it that redefines one of those names at `:root` changes every rule in
// the app that reads it, from a file the reader is not looking at. Nothing
// would fail; the value would simply be somebody else's.
//
// That is the shape of the font bug in the header of this file. Today no sheet
// does it — styles.css keeps its own vocabulary in the --hc-* namespace, and
// the two places it does reach for a shared token are scoped to a selector and
// deliberate. This pins that, so it stays true rather than being true by luck.
//
// A scoped redefinition is legitimate: it is what a token is for. It has to be
// listed here with a reason, so adding one is a decision and not a drift.
const SCOPED_TOKEN_OVERRIDES = {
  '#intro-screen':
    'The intro screen is a self-contained cyan scene on its own dark ground, ' +
    'not the gold app chrome. It restates the surfaces and the accent for its ' +
    'own subtree, which is what a scoped token override is for.',
  'html.low-gpu, body.low-gpu':
    'The reduced-effects mode. Turning blur and shadow off by rewriting the ' +
    'tokens is exactly right — every rule reading them follows, and no rule ' +
    'needs to know the mode exists.',
};

// Global scopes: a redefinition here reaches the whole app.
const GLOBAL_SCOPES = new Set([':root', 'html', 'body', ':root,html', 'html,body', '*']);

console.log('\nNo sheet takes a shared token away from vars.css:');
{
  const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokensIn = (css) => new Set([...decomment(css).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const shared = tokensIn(read('css/vars.css'));
  check(`vars.css owns a shared vocabulary (${shared.size} tokens)`, shared.size > 0);

  let globals = 0, undeclared = 0;
  for (const sheet of stylesheets(srcDir)) {
    if (sheet.endsWith('vars.css')) continue;
    const css = decomment(read(sheet.replace(/^\//, '')));
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = sel.split(/\s+/).join(' ').trim();
      const hit = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)]
        .map((m) => m[1]).filter((t) => shared.has(t));
      if (!hit.length) continue;
      if (GLOBAL_SCOPES.has(selector.replace(/\s*,\s*/g, ','))) {
        globals++;
        check(`${sheet} redefines ${hit.join(', ')} at "${selector}"`, false,
          'this is the shared vocabulary, redefined for the whole app from a sheet that does not own it — scope it to a selector, or change vars.css');
      } else if (!(selector in SCOPED_TOKEN_OVERRIDES)) {
        undeclared++;
        check(`${sheet} redefines ${hit.join(', ')} at "${selector}"`, false,
          'a scoped token override is fine, but it has to be listed in SCOPED_TOKEN_OVERRIDES in this file with the reason it exists');
      }
    }
  }
  if (globals === 0) check('nothing redefines a shared token for the whole app', true);
  if (undeclared === 0) check('every scoped override is listed with a reason', true);

  // Both ways, so an entry that stops being true is caught too.
  for (const selector of Object.keys(SCOPED_TOKEN_OVERRIDES)) {
    const still = stylesheets(srcDir).some((sheet) => {
      if (sheet.endsWith('vars.css')) return false;
      const css = decomment(read(sheet.replace(/^\//, '')));
      return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, sel, body]) =>
        sel.split(/\s+/).join(' ').trim() === selector &&
        [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].some((m) => shared.has(m[1])));
    });
    check(`"${selector}" still overrides a shared token`, still,
      'nothing does this any more — remove the entry rather than leaving a reason for something that stopped happening');
  }
}

console.log(`\n${pass} passed, ${fail} failed  (one stylesheet layer)`);
process.exit(fail ? 1 : 0);
