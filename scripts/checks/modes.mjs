// ==============================================================
// Mode contract — checks
//
// A mode is a folder. src/modes/<id>/ holds its behaviour in mode.js, its look
// in mode.css and its markup in panel.html; the manifest names it once, and
// the loader turns that name into the tags and the markup index.html used to
// carry by hand.
//
// It was not always. Adding a mode meant four edits to index.html — a <link>,
// a <script>, a tab button, and a couple of hundred lines of markup — plus an
// entry in two check files. Six places, none of which knew about the others,
// and a mode missing one of them registered perfectly and then did nothing
// when clicked. The failure is always silent, because every piece is optional
// as far as the browser is concerned.
//
// So the contract is stated here:
//
//   1. The folders and the manifest agree, in both directions.
//   2. A mode registers itself under the same id as its folder.
//   3. Every registration is complete.
//   4. Every mode can be opened, every tab opens something, and each mode
//      carries its own tab button.
//   5. Every skin class a mode claims is one a stylesheet acts on.
//   6. Every panel has a host element to be inserted into.
//   7. RATCHET — how many SHARED files still name each mode. This is the
//      number that says whether adding a mode is a one-folder job. It may
//      fall and never rise.
//
// Run with: npm run check:modes
// ==============================================================
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { modes as manifestModes, stylesheets, panelMarkup } from './lib/page-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');
const read = (f) => readFileSync(join(srcDir, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const MODES = manifestModes(srcDir);
const MANIFEST = MODES.map((m) => m.id);

// ── 1. The folders and the manifest agree ────────────────────────────────
//
// Both directions, because each failure is different and each is silent. A
// folder missing from the manifest is a mode that never loads. A manifest
// entry with no folder is two 404s at boot and a tab that does nothing.
console.log('\nThe manifest and the folders agree:');
{
  const folders = readdirSync(join(srcDir, 'modes'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  check('the manifest lists modes', MANIFEST.length > 0, 'MANIFEST is empty or unreadable');
  check('every folder is in the manifest',
    folders.every((f) => MANIFEST.includes(f)),
    folders.filter((f) => !MANIFEST.includes(f)).join(', ') + ' — will never load');
  check('every manifest entry has a folder',
    MANIFEST.every((id) => folders.includes(id)),
    MANIFEST.filter((id) => !folders.includes(id)).join(', '));

  for (const id of MANIFEST) {
    for (const file of ['mode.js', 'mode.css', 'panel.html']) {
      check(`${id}/${file}`, existsSync(join(srcDir, 'modes', id, file)));
    }
  }
}

// ── 1b. Every panel has somewhere to go ──────────────────────────────────
//
// The panels were not all in one place: Finance and Sandbox were inside #app,
// four were inside #mainApp, and Coder was a direct child of <body>. Those are
// different stacking and layout contexts. A host that no longer exists means
// insertAdjacentHTML throws, the mode is skipped, and its tab does nothing.
console.log('\nEvery panel has a host element to go into:');
for (const { id, host } of MODES) {
  if (host === 'body') { check(`${id} → body`, true); continue; }
  check(`${id} → ${host}`, html.includes(`id="${host.slice(1)}"`),
    'no such element in index.html — the panel would never be inserted');
}

// ── 2 & 3. Registration: present, complete, and under the right id ───────
//
// The id a mode registers itself under is what setTab() looks up. If it drifts
// from the folder name, the files load and the tab still does nothing — the
// exact failure this whole layout exists to make impossible.
const REQUIRED_KEYS = ['label', 'bodyClass', 'appClass', 'fullscreen', 'btnId', 'mount', 'destroy'];
const registrations = new Map();

console.log('\nEvery mode registers itself, completely, under its own id:');
for (const id of MANIFEST) {
  const src = read(`modes/${id}/mode.js`);
  const m = src.match(
    new RegExp(`_registeredModes[^\\n]*\\)\\[["']${id}["']\\]\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`)
  );
  if (!m) {
    check(`${id} registers under "${id}"`, false,
      'no registration with this id — the folder name and the registered id must match');
    continue;
  }
  check(`${id} registers under "${id}"`, true);

  const body = m[1];
  const keys = [...body.matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map((k) => k[1]);
  const value = (key) => (body.match(new RegExp(`\\b${key}\\s*:\\s*([^,\\n]+)`)) || [])[1]
    ?.trim().replace(/^["']|["'],?$/g, '');
  registrations.set(id, { btnId: value('btnId'), bodyClass: value('bodyClass'), appClass: value('appClass') });

  const missing = REQUIRED_KEYS.filter((k) => !keys.includes(k));
  check(`${id} declares ${REQUIRED_KEYS.length} keys`, missing.length === 0, `missing ${missing.join(', ')}`);
}

// ── 4. Reachable, in both directions ─────────────────────────────────────
console.log('\nEvery mode can be opened, and every tab opens something:');
{
  // The shell holds one tab button — Chats. Every other one lives in its own
  // mode's panel.html, inside a <template data-mode-tab>, and is lifted into
  // the strip at boot.
  const allMarkup = html + '\n' + panelMarkup(srcDir);
  const buttons = new Map(
    [...allMarkup.matchAll(/<button[^>]*\bdata-tab="([^"]+)"[^>]*\bid="([^"]+)"/g)].map((m) => [m[1], m[2]])
  );
  const CHAT_TABS = new Set(['chats']);

  for (const [id, reg] of registrations) {
    check(`${id} has a tab button`, buttons.has(id), 'no [data-tab] button in its panel.html');
    const own = read(`modes/${id}/panel.html`);
    check(`${id} owns its tab button`,
      /<template[^>]*data-mode-tab/.test(own) && own.includes(`data-tab="${id}"`),
      'the button that opens this mode is not in its own panel.html');
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

// ── 5. Skin classes are real ─────────────────────────────────────────────
//
// setTab() adds bodyClass and appClass and trusts CSS somewhere to act on
// them. When nothing does, the mode's JS runs perfectly and the mode looks
// wrong — the hardest version of this to find, because the behaviour is fine.
console.log('\nEvery skin class a mode claims exists in a stylesheet:');
{
  const allCss = stylesheets(srcDir).map(read).join('\n');
  for (const [id, reg] of registrations) {
    for (const key of ['bodyClass', 'appClass']) {
      const cls = reg[key];
      if (!cls || cls === 'null') continue;
      check(`${id} ${key} .${cls}`, allCss.includes(`.${cls}`), 'no stylesheet mentions it');
    }
  }
}

// ── 6. THE RATCHET — how far a mode leaks into shared files ──────────────
//
// The real cost of a mode is not its own size. It is how many files that
// belong to nobody have to know its name.
//
// The stylesheets, the scripts and the markup have all left index.html. What
// still names a mode is the manifest (which is the point), its tab button in
// index.html, the mode-switching special cases in app.js, its accent block in
// vars.css — and, for Coder and Forge, the extra cases the shared stylesheets
// carry because both grew out of the chat view.
//
// The goal for every mode is 1: named once, in the manifest.
const SHARED_FILES = [
  'index.html', 'main.js', 'js/app.js', 'modes/manifest.js',
  'css/vars.css', 'css/base.css', 'css/main.css', 'css/modes.css',
  'css/tabs.css', 'css/sidebar.css', 'css/composer.css', 'css/modals.css',
  'styles.css',
];

//
// One caveat, stated rather than hidden: this counts the mode's id as a word,
// so "code" and "sandbox" also match ordinary English in UI copy — "Code
// interpreter (Python sandbox)" is a sentence, not a coupling. Their numbers
// are therefore higher than their real coupling. The metric is still worth
// having, because it moves in the right direction for the right reasons and it
// cannot be made to go up by accident.
const LEAK_BUDGET = {
  'code': 9,
  'forge': 6,
  'finance': 3,
  'agent-maker': 3,
  'virtual-os': 3,
  'sandbox': 3,
  'systems': 2,
};

console.log('\nShared files naming a mode go down, never up:');
{
  check('every mode has a recorded budget',
    MANIFEST.every((id) => id in LEAK_BUDGET),
    MANIFEST.filter((id) => !(id in LEAK_BUDGET)).join(', '));
  check('every recorded budget is for a mode that exists',
    Object.keys(LEAK_BUDGET).every((id) => MANIFEST.includes(id)),
    Object.keys(LEAK_BUDGET).filter((id) => !MANIFEST.includes(id)).join(', '));

  for (const id of MANIFEST) {
    if (!(id in LEAK_BUDGET)) continue;
    const word = new RegExp(`\\b${id.replace(/-/g, '\\-')}\\b`);
    const hits = SHARED_FILES.filter((f) => existsSync(join(srcDir, f)) && word.test(read(f)));
    const n = hits.length;
    if (n > LEAK_BUDGET[id]) {
      check(`${id}`, false, `named in ${n} shared files, budget ${LEAK_BUDGET[id]} — ${hits.join(', ')}`);
    } else if (n < LEAK_BUDGET[id]) {
      check(`${id}`, false, `named in ${n} shared files, budget ${LEAK_BUDGET[id]} — good, now lower the budget to ${n}`);
    } else {
      check(`${id} (${n} shared files)`, true);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed  (mode contract)`);
process.exit(fail ? 1 : 0);
