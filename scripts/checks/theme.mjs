// ==============================================================
// One identity — checks
//
// HashCortx is one app with several modes, and it had stopped looking like
// one. Each mode carried its own copy of the same decisions: five near-blacks
// for the background, four borders, four reds all meaning "danger", four
// greens all meaning "success", radii of 6, 7, 8, 10 and 14 pixels. None of it
// was a design choice. It is what happens when a mode is built beside the
// others rather than on top of them, and nothing notices, because a stray hex
// is never wrong enough to fail.
//
// So this fails instead. Three rules:
//
//   1. The shared tokens exist and mean one thing.
//   2. A mode declares its accent and nothing else — it may not redefine what
//      a surface, a line, or the colour of "danger" is.
//   3. The count of hardcoded colours per stylesheet may go down but never up.
//      A ratchet rather than a ban, because the ERP preview and the terminal
//      palettes genuinely need their own colours, and pretending otherwise
//      would mean either a false rule or a dishonest exception list.
//
// Run with: npm run check:theme
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssDir = join(here, '..', '..', 'src', 'css');
const read = (f) => readFileSync(join(cssDir, f), 'utf8');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const vars = read('vars.css');

// ── 1. The shared vocabulary ─────────────────────────────────────────────
console.log('\nThe shared tokens exist:');
for (const token of [
  '--surface-0', '--surface-1', '--surface-2', '--surface-raised', '--surface-sunken',
  '--space-1', '--space-4', '--space-6',
  '--control-h', '--control-h-sm', '--control-h-lg',
  '--radius-xs', '--radius-sm', '--radius', '--radius-lg',
  '--ok', '--warn', '--danger', '--info',
  '--accent', '--accent-2', '--accent-soft', '--accent-line', '--accent-ink',
]) {
  check(token, new RegExp(`^\\s*${token}\\s*:`, 'm').test(vars));
}

// ── 2. A mode may change its accent, and only its accent ─────────────────
//
// This is the rule that keeps the app one app. Without it a mode can quietly
// re-declare what a border or a background is and drift away again, which is
// exactly how it drifted the first time.
const ACCENT_ONLY = new Set(['--accent', '--accent-2', '--accent-soft', '--accent-line', '--accent-ink']);

console.log('\nEach mode declares an accent, and nothing else:');
{
  const modeBlocks = [...vars.matchAll(/(body\.[a-z-]+|\.sbx-mode)\s*\{([^}]*)\}/g)];
  check('every mode has a block', modeBlocks.length >= 7, `found ${modeBlocks.length}`);
  for (const [, selector, body] of modeBlocks) {
    const declared = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const strays = declared.filter((d) => !ACCENT_ONLY.has(d));
    check(`${selector} sets only accent tokens`, strays.length === 0, strays.join(', '));
    check(`${selector} sets an accent at all`, declared.includes('--accent'));
  }
}

// ── 3. Nothing else redefines the shared meaning ─────────────────────────
//
// "Danger" must be one red across the whole app. A user should never have to
// learn that a warning is one colour here and another two tabs over.
const SHARED = [
  '--ok', '--warn', '--danger', '--info',
  '--surface-0', '--surface-1', '--surface-2',
  '--text', '--text-dim', '--muted', '--line', '--line-strong',
  '--radius', '--radius-lg', '--radius-sm', '--radius-xs',
];
console.log('\nNo stylesheet redefines what the shared tokens mean:');
for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css') && f !== 'vars.css')) {
  const src = read(file);
  const redefined = SHARED.filter((t) => new RegExp(`^\\s*${t}\\s*:`, 'm').test(src));
  check(`${file}`, redefined.length === 0, `redefines ${redefined.join(', ')}`);
}

// ── 4. The ratchet ───────────────────────────────────────────────────────
//
// Counts of hardcoded colours, measured. Lower these when a file is converted;
// the check fails if one rises, and also if one falls without being recorded,
// so paying the debt down is deliberate rather than accidental.
//
// system-maker is high on purpose: most of what remains there is the generated
// ERP prototype in the preview, which is meant to look like real business
// software rather than like HashCortx. Its builder chrome is on the tokens.
const BUDGET = {
  'vars.css': 35,
  'system-maker.css': 131,
  'modals.css': 64,
  'virtual-os.css': 56,
  'modes.css': 51,
  'main.css': 43,
  'coder-mode.css': 37,
  'agent-maker.css': 36,
  'finance-mode.css': 29,
  'tabs.css': 18,
  'sidebar.css': 9,
  'composer.css': 5,
  'base.css': 3,
  'sandbox.css': 2,
  'forge-mode.css': 2,
};

console.log('\nHardcoded colour counts go down, never up:');
{
  const files = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
  check('every stylesheet has a recorded budget',
    files.every((f) => f in BUDGET),
    files.filter((f) => !(f in BUDGET)).join(', '));

  for (const file of files.filter((f) => f in BUDGET)) {
    const count = (read(file).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).length;
    if (count > BUDGET[file]) {
      check(`${file}`, false, `${count} colours, budget ${BUDGET[file]} — use a token, or raise this deliberately`);
    } else if (count < BUDGET[file]) {
      check(`${file}`, false, `${count} colours, budget ${BUDGET[file]} — good, now lower the budget to ${count}`);
    } else {
      check(`${file} (${count})`, true);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed  (one identity)`);
process.exit(fail ? 1 : 0);
