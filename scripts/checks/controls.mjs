// ==============================================================
// Dead controls — checks
//
// scripts/checks/dom-ids.mjs catches the code half of this: a lookup for an
// element that is not there. This is the other half, and nothing was watching
// it — an element that IS there and that no code ever touches.
//
// That is a button which renders, has a title, highlights on hover, and does
// nothing at all when pressed. It is the most convincing kind of broken,
// because everything about it looks like a working feature.
//
// It was not hypothetical. When this was first run it found four:
//
//   • the composer's context-injection toggle, which had no handler in any
//     build — the only other way to switch the feature on was a slash command
//     that called a function nobody had written, so it threw;
//   • "View Audit Log" in the About dialog, offering to show a security record
//     and doing nothing;
//   • the second Close in the Virtual OS editor, which did not close;
//   • a Stop button in the Virtual OS chat, permanently disabled.
//
// Run with: npm run check:controls
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelMarkup } from './lib/page-assets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = join(root, 'src');

/**
 * Controls that no JS names, with the reason that is correct.
 *
 * Checked both ways: an entry that stops being unreferenced fails too, so this
 * list cannot quietly rot into a place where dead controls hide.
 */
const ALLOWED_UNREFERENCED = new Map([
  ['tabChats', 'the workspace tabs are handled together by one delegated listener on .tabs, matched by data-tab rather than by id'],
  ['voidChatStopBtn', 'rendered disabled and never enabled — a placeholder for cancelling a Virtual OS chat turn, which that mode does not yet offer'],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// The shell AND every mode panel. A button in a mode's panel.html is still a
// button the app ships; reading index.html alone would call all of them gone.
const html = readFileSync(join(srcDir, 'index.html'), 'utf8') + '\n' + panelMarkup(srcDir);
const js = walk(srcDir).map((f) => readFileSync(f, 'utf8')).join('\n');

const buttonIds = [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const unreferenced = buttonIds.filter((id) => !js.includes(id));

console.log('\nEvery button does something when pressed:');
check(`${buttonIds.length} buttons carry an id`, buttonIds.length > 0);

for (const id of unreferenced) {
  check(`#${id}`, ALLOWED_UNREFERENCED.has(id),
    'no JavaScript names this id — wire it, or record why it is inert');
}
if (!unreferenced.length) check('none are unreferenced', true);

// The list must not outlive the problem it describes.
console.log('\nThe exceptions are still exceptions:');
for (const [id, reason] of ALLOWED_UNREFERENCED) {
  if (!buttonIds.includes(id)) {
    check(`#${id} still exists`, false, `listed as inert but no longer in the markup — remove the entry (${reason})`);
  } else if (js.includes(id)) {
    check(`#${id} is still unreferenced`, false, 'it is wired now — remove it from the allow list');
  } else {
    check(`#${id} (${reason.slice(0, 52)}…)`, true);
  }
}

console.log(`\n${pass} passed, ${fail} failed  (dead controls)`);
process.exit(fail ? 1 : 0);
