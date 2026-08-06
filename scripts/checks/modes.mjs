// ==============================================================
// Mode contract — checks
//
// HashCortx has one chat and seven full-screen modes. A mode is supposed to be
// a self-contained thing: it registers itself, it mounts, it tears down, and
// the app never has to know its name.
//
// That is nearly true. Every mode does self-register:
//
//   (window._registeredModes ||= {})["virtual-os"] = {
//     label, bodyClass, appClass, fullscreen, btnId, mount, destroy
//   };
//
// and setTab() drives it generically. What is NOT true is the rest of the
// wiring. A mode's stylesheet, its script tag, its tab button and its markup
// are all hand-written into index.html, in four separate places, and nothing
// notices when one of them is missing.
//
// The failure that shape produces is always the same and always silent:
// something registers, nothing shows, and no error is raised anywhere. A mode
// with no button cannot be opened. A button with no registration falls through
// to the chat branch and looks like a no-op click. A bodyClass nothing styles
// gives a mode the wrong skin while every line of its JS runs correctly.
//
// So this file states the contract:
//
//   1. Every registration is complete and well-formed.
//   2. Every mode can actually be reached, and every route leads somewhere.
//   3. Every skin class a mode claims is a class something styles.
//   4. Every mode's files are loaded.
//   5. RATCHET — how many SHARED files still mention each mode by name. This
//      is the number that says whether adding a mode is a one-folder job or a
//      six-edit job. It may fall and never rise.
//
// Rule 5 is the point of the file. The others protect what already works;
// rule 5 is the one that has to move.
//
// Run with: npm run check:modes
// ==============================================================
import { readFileSync, existsSync } from 'node:fs';
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

/**
 * Where each mode lives today.
 *
 * The file names do not match the mode ids — "agent-maker" is served by
 * swarm-maker.js and agent-maker.css, "systems" by system-maker.js, "code" by
 * code-mode.js and coder-mode.css. That mismatch is itself part of why a mode
 * is hard to follow, and it is why this table has to be written out by hand
 * rather than derived. When a mode moves into src/modes/<id>/, its entry here
 * collapses to the folder and this comment goes away.
 */
const MODES = {
  'code':        { js: 'js/code-mode.js',    css: 'css/coder-mode.css' },
  'forge':       { js: 'js/forge-mode.js',   css: 'css/forge-mode.css' },
  'finance':     { js: 'js/finance-mode.js', css: 'css/finance-mode.css' },
  'sandbox':     { js: 'js/sandbox.js',      css: 'css/sandbox.css' },
  'systems':     { js: 'js/system-maker.js', css: 'css/system-maker.css' },
  'agent-maker': { js: 'js/swarm-maker.js',  css: 'css/agent-maker.css' },
  'virtual-os':  { js: 'js/virtual-os.js',   css: 'css/virtual-os.css' },
};

/** Tabs that are the chat itself wearing a different skin, not registered modes. */
const CHAT_TABS = new Set(['chats']);

// ── Read every registration out of the source ────────────────────────────
const registrations = new Map();
for (const [id, { js }] of Object.entries(MODES)) {
  const src = read(js);
  const m = src.match(
    new RegExp(`_registeredModes[^\\n]*\\)\\[["']${id}["']\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`)
  );
  if (!m) continue;
  const body = m[1];
  const keys = [...body.matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map((k) => k[1]);
  const value = (key) => (body.match(new RegExp(`\\b${key}\\s*:\\s*([^,\\n]+)`)) || [])[1]?.trim();
  registrations.set(id, {
    keys,
    label: value('label')?.replace(/^["']|["'],?$/g, ''),
    btnId: value('btnId')?.replace(/^["']|["'],?$/g, ''),
    bodyClass: value('bodyClass')?.replace(/^["']|["'],?$/g, ''),
    appClass: value('appClass')?.replace(/^["']|["'],?$/g, ''),
  });
}

// ── 1. Every registration is complete ────────────────────────────────────
//
// Order matters less than presence. A missing `destroy` means the previous
// mode's DOM and listeners survive into the next one, which is the kind of
// thing that shows up three modes later as a stray click handler.
console.log('\nEvery mode registers itself completely:');
check('every mode has a registration', registrations.size === Object.keys(MODES).length,
  Object.keys(MODES).filter((id) => !registrations.has(id)).join(', '));

const REQUIRED_KEYS = ['label', 'bodyClass', 'appClass', 'fullscreen', 'btnId', 'mount', 'destroy'];
for (const [id, reg] of registrations) {
  const missing = REQUIRED_KEYS.filter((k) => !reg.keys.includes(k));
  check(`${id} declares ${REQUIRED_KEYS.length} keys`, missing.length === 0, `missing ${missing.join(', ')}`);
}

// ── 2. Every mode is reachable, and every route leads somewhere ───────────
//
// Both directions. A registration with no button is a mode nobody can open; a
// button with no registration falls through setTab() into the plain-chat
// branch and reads as a dead click.
console.log('\nEvery mode can be opened, and every tab opens something:');
{
  const buttons = new Map(
    [...html.matchAll(/<button[^>]*\bdata-tab="([^"]+)"[^>]*\bid="([^"]+)"/g)].map((m) => [m[1], m[2]])
  );

  for (const [id, reg] of registrations) {
    check(`${id} has a tab button`, buttons.has(id), 'no [data-tab] button in index.html');
    if (buttons.has(id)) {
      check(`${id} btnId matches its button`, reg.btnId === buttons.get(id),
        `registration says "${reg.btnId}", markup says "${buttons.get(id)}"`);
    }
  }

  for (const [tab, btnId] of buttons) {
    check(`tab "${tab}" (${btnId}) leads somewhere`,
      registrations.has(tab) || CHAT_TABS.has(tab),
      'no registered mode and not a chat tab');
  }
}

// ── 3. Every skin class a mode claims is styled ──────────────────────────
//
// setTab() adds bodyClass and appClass and trusts that CSS somewhere acts on
// them. When it does not, the mode's JS runs perfectly and the mode looks
// wrong, which is the hardest version of this bug to find because nothing in
// the behaviour is off.
console.log('\nEvery skin class a mode claims exists in a stylesheet:');
{
  const allCss = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1].replace(/^\//, ''))
    .filter((f) => !f.includes('vendor/'))
    .map((f) => read(f))
    .join('\n');

  for (const [id, reg] of registrations) {
    for (const key of ['bodyClass', 'appClass']) {
      const cls = reg[key];
      if (!cls || cls === 'null') continue;
      check(`${id} ${key} .${cls}`, allCss.includes(`.${cls}`), 'no stylesheet mentions it');
    }
  }
}

// ── 4. Every mode's files are loaded ─────────────────────────────────────
console.log('\nEvery mode ships its script and its stylesheet:');
for (const [id, { js, css }] of Object.entries(MODES)) {
  check(`${id} files exist`, existsSync(join(srcDir, js)) && existsSync(join(srcDir, css)));
  check(`${id} script is loaded`, html.includes(`src="/${js}"`), `no <script src="/${js}">`);
  check(`${id} stylesheet is loaded`, html.includes(`href="/${css}"`), `no <link href="/${css}">`);
}

// ── 5. THE RATCHET — how far a mode leaks into shared files ──────────────
//
// The real cost of a mode is not its own size. It is how many files that
// belong to nobody have to know its name. Today adding a mode means editing
// index.html in four places — a <link>, a <script>, a tab <button>, and a
// couple of hundred lines of markup — and app.js knows several of them by
// name too. Six edits, spread across shared files, with nothing to tell you
// when you have missed one.
//
// This counts the shared files that still mention each mode id. Lower a number
// when a mode's markup and wiring move into its own folder. The check fails if
// one rises, AND if one falls without being recorded — so paying it down stays
// deliberate, exactly like the colour budgets in theme.mjs.
//
// The goal for every mode is 1: named once, in the manifest.
const SHARED_FILES = [
  'index.html', 'main.js', 'js/app.js',
  'css/vars.css', 'css/base.css', 'css/main.css', 'css/modes.css',
  'css/tabs.css', 'css/sidebar.css', 'css/composer.css', 'css/modals.css',
  'styles.css',
];

// Measured. `code` is worst because Coder was built by copying chat and then
// diverging, so it left its name in six stylesheets on the way.
const LEAK_BUDGET = {
  'code': 8,
  'forge': 5,
  'finance': 3,
  'agent-maker': 3,
  'virtual-os': 3,
  'sandbox': 2,
  'systems': 2,
};

console.log('\nShared files naming a mode go down, never up:');
{
  check('every mode has a recorded budget',
    Object.keys(MODES).every((id) => id in LEAK_BUDGET),
    Object.keys(MODES).filter((id) => !(id in LEAK_BUDGET)).join(', '));
  check('every recorded budget is for a mode that exists',
    Object.keys(LEAK_BUDGET).every((id) => id in MODES),
    Object.keys(LEAK_BUDGET).filter((id) => !(id in MODES)).join(', '));

  for (const id of Object.keys(MODES)) {
    if (!(id in LEAK_BUDGET)) continue;
    const word = new RegExp(`\\b${id.replace(/[-]/g, '\\-')}\\b`);
    const hits = SHARED_FILES.filter((f) => existsSync(join(srcDir, f)) && word.test(read(f)));
    const n = hits.length;
    if (n > LEAK_BUDGET[id]) {
      check(`${id}`, false,
        `named in ${n} shared files, budget ${LEAK_BUDGET[id]} — ${hits.join(', ')}`);
    } else if (n < LEAK_BUDGET[id]) {
      check(`${id}`, false,
        `named in ${n} shared files, budget ${LEAK_BUDGET[id]} — good, now lower the budget to ${n}`);
    } else {
      check(`${id} (${n} shared files)`, true);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed  (mode contract)`);
process.exit(fail ? 1 : 0);
