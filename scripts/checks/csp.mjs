// ==============================================================
// Content Security Policy checks
//
// The CSP in src-tauri/tauri.conf.json is the last thing standing between a
// compromised prompt and the network. It is also a single long string in a
// config file, which is the easiest place in this repo for a rule to be
// widened by accident and for nobody to notice — nothing fails, a request
// simply becomes possible.
//
// Two properties are pinned here, both of them holes that were open:
//
//   • No image may be loaded from the network. Every picture this app shows is
//     a bundled asset, a data: URL or a blob:. While https: was allowed, a
//     markdown image in a model's reply fetched an arbitrary host the moment
//     the reply was drawn — a request the user never saw, carrying whatever
//     the model chose to put in the URL.
//
//   • A wildcard host must have a caller. connect-src listed http://*:1234,
//     http://*:8080 and http://*:11435 for "self-hosted model servers"; no
//     line in this app has ever connected to any of them, so they granted
//     plaintext access to every host on those ports for no feature.
//
// It also checks the config's own comment against the config's own value,
// because the warning above the policy said no wildcard was ever used while
// four were listed below it.
//
// Run with: npm run check:csp
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const confText = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');

let pass = 0, fail = 0;
function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const cspMatch = /"csp"\s*:\s*"([^"]+)"/.exec(confText);
const csp = cspMatch ? cspMatch[1] : '';

/** The sources listed for one directive, e.g. directive('img-src'). */
function directive(name) {
  const found = new RegExp(`(?:^|;)\\s*${name} ([^;"]+)`).exec(csp);
  return found ? found[1].trim().split(/\s+/) : [];
}

console.log('\nThe policy is there to read:');
ok('tauri.conf.json defines a csp', !!csp);

// ── Images ───────────────────────────────────────────────────────────────────
//
// This is the check that matters most, because the channel it closes needs no
// click and leaves no trace in the UI.

console.log('\nNo picture is fetched from the network:');
const imgSrc = directive('img-src');
ok('img-src is declared', imgSrc.length > 0, 'without it, default-src applies and the rule is invisible');
for (const forbidden of ['https:', 'http:', '*', 'https://*']) {
  ok(`img-src does not allow ${forbidden}`, !imgSrc.includes(forbidden),
    'a markdown image in a model reply would fetch that host the moment the reply is drawn');
}
ok("img-src still allows the app's own pictures",
  ["'self'", 'data:', 'blob:'].every((s) => imgSrc.includes(s)),
  'generated images, pasted images and bundled assets all need these');

// The renderer half of the same rule. The CSP is what enforces it; this is
// what stops the user seeing a broken-image icon and not knowing why.
const appJs = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
ok('chat renders a remote markdown image as a link rather than an <img>',
  /renderer\.image\s*=/.test(appJs),
  "marked's default image renderer emits <img src> pointing anywhere the model likes");

// ── Wildcard hosts ───────────────────────────────────────────────────────────

console.log('\nEvery wildcard host has something that calls it:');
const connectSrc = directive('connect-src');
const wildcards = connectSrc.filter((s) => s.includes('*'));

/**
 * The one wildcard with a caller, and the reason it stays.
 *
 * Ollama is the only local server this app talks to, and it may run on another
 * machine on the user's network, so its port cannot be pinned to loopback.
 * Anything else added here needs a line of code that connects to it.
 */
const ALLOWED_WILDCARDS = new Map([
  ['http://*:11434', "Ollama's port — the app connects to a host the user configures, which may be another machine on their network"],
]);

for (const w of wildcards) {
  ok(`${w} is an approved wildcard`, ALLOWED_WILDCARDS.has(w),
    'add the caller first, then list it here with the reason — a wildcard host grants every host on that port');
}

// Both ways: an entry that stops being used should not sit here forever.
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.html')) out.push(full);
  }
  return out;
}
const allSource = sourceFiles(join(root, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
for (const [w, why] of ALLOWED_WILDCARDS) {
  const port = w.split(':').pop();
  ok(`${w} is still reached by the source (${why.split('—')[0].trim()})`,
    allSource.includes(`:${port}`),
    'nothing connects to this port any more — remove it from connect-src and from this list');
}

// ── The config's comment against the config's value ──────────────────────────

console.log('\nThe warning above the policy matches the policy:');
const claimsNoWildcard = /Never use a wildcard \(\*\) here — that would allow any domain/.test(confText);
ok('the comment does not claim a rule the policy breaks',
  !(claimsNoWildcard && wildcards.length > 0),
  `the comment says no wildcard is used and ${wildcards.length} are listed`);

// ── Script sources ───────────────────────────────────────────────────────────
//
// docs/SECURITY.md names these one by one, so the doc goes stale silently when
// the list changes. Pinning the count is what makes that a failure.

console.log('\nOnly the CDN Pyodide needs is allowed to serve script:');
const scriptSrc = directive('script-src');
const remoteScript = scriptSrc.filter((s) => s.startsWith('http'));
ok('exactly one remote script host', remoteScript.length === 1,
  `found ${remoteScript.length}: ${remoteScript.join(', ')} — vendor the library instead, and update docs/SECURITY.md`);
ok('and it is jsDelivr, which serves Pyodide', remoteScript[0] === 'https://cdn.jsdelivr.net');

const securityDoc = readFileSync(join(root, 'docs', 'SECURITY.md'), 'utf8');
ok('docs/SECURITY.md does not name a CDN the policy dropped',
  !/cdnjs\.cloudflare\.com|cdn\.sheetjs\.com/.test(securityDoc),
  'both are vendored now; the document still lists them as permitted');

console.log(`\n${pass} passed, ${fail} failed  (content security policy)`);
process.exit(fail ? 1 : 0);
