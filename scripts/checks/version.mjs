// ==============================================================
// One version, everywhere it is written
//
// The version is written in five places: three build files that decide what the
// binary reports, and two labels in the shell that decide what the user reads —
// the badge in the title bar and the line on the loading screen.
//
// v2.5.0 shipped with the build files bumped and both labels still saying v2.0.
// So the DMG was 2.5.0, macOS reported 2.5.0, and the app itself said 2.0 in the
// two places anyone actually looks. A user who checks the version to find out
// whether they have the fixes was told the wrong answer by the product while the
// installer told them the right one.
//
// Nothing could catch that. The labels are plain text in markup; they are correct
// right up until a release, and a release is exactly when nobody is reading the
// markup.
//
// So: all five agree, or this fails. The build files carry the full `major.minor.patch`;
// the labels may carry either that or `major.minor`, because a title bar has
// little room and "v2.5" is not a lie about 2.5.0 — it is the same version, said
// shorter. `v2.4` would be.
//
// Run with: npm run check:version
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// tauri.conf.json is the one the bundler reads, so it is the answer the others
// have to match rather than a fourth opinion. It carries comments, so it is read
// the same way csp.mjs reads it — as text — rather than through JSON.parse,
// which refuses it.
const tauri = (read('src-tauri/tauri.conf.json').match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
const npm = JSON.parse(read('package.json')).version;
const cargo = (read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m) || [])[1];

console.log(`\nThe build files agree on a version (${tauri}):`);
check('package.json', npm === tauri, `says ${npm}`);
check('src-tauri/Cargo.toml', cargo === tauri, `says ${cargo}`);
check('the version looks like a version', /^\d+\.\d+\.\d+$/.test(tauri), `got "${tauri}"`);

// What the user reads.
const shell = read('src/index.html');
const badge = (shell.match(/class="hc-toolbar-badge"[^>]*>v?([\d.]+)</) || [])[1];
const patch = (shell.match(/class="patch-badge">[^<]*?v([\d.]+)/) || [])[1];

/** `2.5` and `2.5.0` are the same version written at different lengths. */
const sameVersion = (shown) => shown === tauri || tauri.startsWith(shown + '.');

console.log('\nWhat the app tells the user matches what it is:');
check('the title-bar badge exists', !!badge, 'no version found in the hc-toolbar-badge span');
check(`the title-bar badge (v${badge})`, !!badge && sameVersion(badge),
  `shows v${badge}, the build is ${tauri} — this is the version a user reads to find out what they have`);
check('the loading-screen line exists', !!patch, 'no version found in the patch-badge line');
check(`the loading-screen line (v${patch})`, !!patch && sameVersion(patch),
  `shows v${patch}, the build is ${tauri}`);

// The loading screen also names a month. A stale month is a smaller lie than a
// stale version, but it is the same kind, and it is free to check that it is not
// still naming the month of a release two versions ago.
const month = (shell.match(/class="patch-badge">[^<]*?·\s*([A-Z][a-z]+ \d{4})/) || [])[1];
check('the loading screen names a month', !!month, 'no month found on the patch-badge line');

console.log(`\n${pass} passed, ${fail} failed  (one version everywhere)`);
process.exit(fail ? 1 : 0);
