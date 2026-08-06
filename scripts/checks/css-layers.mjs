// ==============================================================
// One stylesheet layer — checks
//
// HashCortx has two design systems.
//
// src/css/*.css is the first: tokens in vars.css, --sans / --serif / --mono,
// one sheet per area. src/styles.css is the second: its own --hc-* namespace,
// its own type scale, 347 selectors — and it is linked LAST, so wherever the
// two disagree, it wins. Nothing in either file says so. You find out by
// changing a rule in css/ and watching nothing happen.
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

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');
const read = (f) => readFileSync(join(srcDir, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The sheets the page loads, in the order it loads them. Order is the point. */
const SHEETS = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
  .map((m) => m[1].replace(/^\//, ''))
  .filter((f) => !f.includes('vendor/'));

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
const DUPLICATE_BUDGET = 57;

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
  'styles.css': 154,
  'css/modals.css': 92,
  'css/modes.css': 17,
  'css/sandbox.css': 14,
  'css/agent-maker.css': 11,
  'css/virtual-os.css': 11,
  'css/coder-mode.css': 11,
  'css/system-maker.css': 10,
  'css/base.css': 8,
  'css/finance-mode.css': 4,
  'css/main.css': 3,
  'css/vars.css': 0,
  'css/sidebar.css': 0,
  'css/tabs.css': 0,
  'css/composer.css': 0,
  'css/forge-mode.css': 0,
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
    const n = (read(file).match(/!important/g) || []).length;
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
// styles.css defines 30 --hc-* tokens. Only 22 uses of them exist in the whole
// app, 20 of those inside styles.css itself. So this is not a design system in
// use; it is a second one left running beside the first, and one of the two
// decides what the app looks like depending on link order.
//
// The target is zero: every --hc-* either becomes a token in vars.css or is
// deleted with the rule that used it.
const HC_TOKEN_BUDGET = 30;

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

console.log(`\n${pass} passed, ${fail} failed  (one stylesheet layer)`);
process.exit(fail ? 1 : 0);
