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
const srcDir = join(here, '..', '..', 'src');
const cssDir = join(srcDir, 'css');

/**
 * Every stylesheet the page actually loads, not just the ones in src/css/.
 *
 * This check originally scanned that folder alone, and missed src/styles.css —
 * 1,400 lines calling itself the master design system, carrying a second set
 * of brand tokens, and linked LAST so it has the final say. A guard that reads
 * a directory rather than the page is a guard the page can step around.
 */
function linkedStylesheets() {
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const out = [];
  for (const [, href] of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) {
    if (href.includes('vendor/')) continue;      // third-party, not ours to shape
    out.push(href.replace(/^\//, ''));
  }
  return out;
}
const SHEETS = linkedStylesheets();
const read = (f) => readFileSync(join(srcDir, f), 'utf8');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const vars = read('css/vars.css');

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
for (const file of SHEETS.filter((f) => !f.endsWith('css/vars.css'))) {
  const src = read(file);
  const redefined = SHARED.filter((t) => new RegExp(`^\\s*${t}\\s*:`, 'm').test(src));
  check(`${file}`, redefined.length === 0, `redefines ${redefined.join(', ')}`);
}

// ── 4. Corners come from the scale ───────────────────────────────────────
//
// The app had thirteen radii: 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 20, 22.
// Coder's corners were sharp, Virtual OS's were round, everything else sat
// between — which is most of why two modes at the same colour still read as
// two products.
//
// Allowed without a token: 1px and 2px, which are hairlines, bars and
// scrollbar thumbs where a 6px corner would look like a mistake; 999px and 50%
// for pills and circles; and var(--sys-radius…), which the generated ERP
// prototype sets per spec from its own theme.
console.log('\nEvery corner comes from the scale:');
for (const file of SHEETS.filter((f) => !f.endsWith('css/vars.css'))) {
  const src = read(file);
  const strays = [];
  for (const [, value] of src.matchAll(/border-radius:\s*([^;}]+)/g)) {
    for (const [, px] of value.matchAll(/(?<![-\w(])(\d+)px/g)) {
      const n = Number(px);
      if (n >= 3 && n !== 999 && !value.includes('--sys-radius')) strays.push(`${n}px`);
    }
  }
  check(`${file}`, strays.length === 0, `off-scale: ${[...new Set(strays)].join(', ')}`);
}

// ── 5. Every id selector points at something ─────────────────────────────
//
// A CSS rule whose selector matches nothing does not fail. It sits in the
// file looking like styling, and the thing it was meant to style keeps the
// styling it had. A whole redesign of Coder was written against `#coder`,
// which does not exist — the root is `#coder-mode-wrap` — and every rule in
// it was dead. Nothing said so; the mode simply looked identical.
//
// The listed ones are leftovers from a system-stats bar that was removed:
// styling for a ping button, CPU temperature, fan, RAM and power readouts
// that no longer exist. Recorded rather than deleted here so that removing
// them is its own change, and so a NEW dead selector fails instead of
// joining them.
const DEAD_ID_SELECTORS = new Set([
  'cpuTempBtn', 'fanBtn', 'fanVal', 'pingBtn', 'pingMs',
  'powerBtn', 'ramBtn', 'ramVal', 'voidAgentOSBtn',
]);

console.log('\nEvery id a stylesheet targets exists:');
{
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const known = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  // Ids the JS builds at runtime count as real.
  const jsFiles = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  };
  collect(srcDir);
  for (const f of jsFiles) {
    const js = readFileSync(f, 'utf8');
    for (const m of js.matchAll(/id=["']([a-zA-Z][\w-]*)["']/g)) known.add(m[1]);
  }

  for (const file of SHEETS) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const dead = new Set();
    for (const [, selBlock] of css.matchAll(/([^{}]+)\{/g)) {
      for (const [, id] of selBlock.matchAll(/#([a-zA-Z][\w-]*)/g)) {
        if (!known.has(id) && !DEAD_ID_SELECTORS.has(id)) dead.add(id);
      }
    }
    check(`${file}`, dead.size === 0, `targets ids that do not exist: ${[...dead].join(', ')}`);
  }
}

// ── 6. The ratchet ───────────────────────────────────────────────────────
//
// Counts of hardcoded colours, measured. Lower these when a file is converted;
// the check fails if one rises, and also if one falls without being recorded,
// so paying the debt down is deliberate rather than accidental.
//
// system-maker is high on purpose: most of what remains there is the generated
// ERP prototype in the preview, which is meant to look like real business
// software rather than like HashCortx. Its builder chrome is on the tokens.
const BUDGET = {
  // Not in css/. A second design system in its own --hc-* namespace, linked
  // last so it has the final say; recorded here so it can shrink but not grow.
  'styles.css': 32,
  'css/vars.css': 35,
  'css/system-maker.css': 131,
  'css/modals.css': 64,
  'css/virtual-os.css': 56,
  'css/modes.css': 50,
  'css/main.css': 43,
  'css/coder-mode.css': 35,
  'css/agent-maker.css': 36,
  'css/finance-mode.css': 29,
  'css/tabs.css': 18,
  'css/sidebar.css': 9,
  'css/composer.css': 5,
  'css/base.css': 3,
  'css/sandbox.css': 2,
  'css/forge-mode.css': 2,
};

console.log('\nHardcoded colour counts go down, never up:');
{
  // Both directions: a linked sheet with no budget, and a budget for a sheet
  // the page no longer loads. The second is how a stale entry hides a file
  // that has quietly stopped mattering.
  const files = SHEETS;
  check('every linked stylesheet has a recorded budget',
    files.every((f) => f in BUDGET),
    files.filter((f) => !(f in BUDGET)).join(', '));
  check('every recorded budget is for a stylesheet still loaded',
    Object.keys(BUDGET).every((f) => files.includes(f)),
    Object.keys(BUDGET).filter((f) => !files.includes(f)).join(', '));

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

// ── 4. A class must be able to hide an element ───────────────────────────────
//
// `button:not(.template-item):not(.chat-item) { display: inline-flex }` scored
// 0,2,1 — higher than any single-class rule in this app. So every
// `.some-button { display: none }` written anywhere silently lost to it and the
// button stayed on screen. Coder's side rail is what surfaced it: a 14px bar
// meant to appear only when the file panel is collapsed sat over the panel
// permanently, clipping the first character off every line in that column.
//
// The pattern to refuse is narrow and exact: a `display` declaration whose
// subject is a bare element type inflated with `:not()`. Written without the
// `:not()`s it scores 0,0,1 and a class rule wins, which is what anyone writing
// one expects.
console.log('\nA class can still hide an element:');
{
  let offenders = 0;
  for (const file of SHEETS) {
    // Comments go first. A brace inside prose is not a rule, and this check
    // was defeated by its own explanation in main.css, which quotes
    // `{ display: none }` while describing the trap.
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    // Selector immediately followed by a block containing `display`.
    for (const m of css.matchAll(/(^|[}\n])\s*([^{}@\n][^{}]*?)\{([^{}]*)\}/g)) {
      const [, , selector, body] = m;
      if (!/(^|;|\s)display\s*:/.test(body)) continue;
      for (const part of selector.split(',')) {
        const s = part.trim();
        if (!s || s.startsWith('/*')) continue;
        // What matters is the SUBJECT — the last compound — not the start of
        // the selector. `body.x #app > *:not(#y)` is an intentional
        // hide-everything-else rule whose subject is `*`; `button:not(.a)` is
        // the trap. Parenthesised groups are stripped first so a combinator
        // inside :not() cannot split the selector in the wrong place.
        // Only a SINGLE compound is the trap: a bare element inflated by
        // :not(), with no ancestor to scope it, so it applies to every such
        // element in the app. `.panel .row span { display: … }` is also a bare
        // element subject, but it is scoped to a component and nobody expects a
        // loose class to beat it.
        const parts = s.replace(/\([^()]*\)/g, '').split(/[\s>+~]+/).filter(Boolean);
        if (parts.length === 1 && /^[a-z][a-z0-9-]*/i.test(parts[0]) && /:not\(/.test(s)) {
          offenders++;
          check(`${file}: ${s.slice(0, 70)}`, false,
            'sets display on a bare element but scores above a class — write it without :not() and give the exceptions their own rule');
        }
      }
    }
  }
  if (offenders === 0) check('no display rule out-specifies a plain class', true);
}

console.log(`\n${pass} passed, ${fail} failed  (one identity)`);
process.exit(fail ? 1 : 0);
