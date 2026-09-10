// ==============================================================
// What the released app's security policy actually allows
//
// The policy in tauri.conf.json is not the one the released app runs under.
// A production build rewrites it for index.html, the page everything else is
// drawn into (tauri-codegen and tauri's asset manager, 2.x):
//
//   • every <style> block in the page gets a nonce, added to style-src;
//   • every <script> loaded from an http address gets a nonce, in script-src;
//   • every inline <script> with content is hashed, in script-src.
//
// And once a directive holds a nonce or a hash, the browser ignores its
// 'unsafe-inline'. That is standard, and it is not visible in development,
// where Tauri sends no policy at all — so none of it shows until a release.
//
// One small style block in index.html was enough to make the released app drop
// every style="" attribute it drew. This check holds the page to the shape
// under which the configured policy means what it says.
//
// Run with: npm run check:production-policy
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const page = readFileSync(join(root, 'src', 'index.html'), 'utf8');
const conf = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`); }
}

/** What a production build adds to the policy for a page, by Tauri's rules. */
function productionAdditions(html) {
  const tags = html.replace(/<!--[\s\S]*?-->/g, '');   // a parser does not see comments
  const styleBlocks = (tags.match(/<style[\s>]/gi) || []).length;
  const httpScripts = (tags.match(/<script[^>]*\ssrc=["']https?:/gi) || []).length;
  const inlineScripts = [...tags.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((m) => m[1].trim()).length;
  return {
    styleNonce: styleBlocks > 0,
    scriptNonceOrHash: httpScripts > 0 || inlineScripts > 0,
  };
}

const policy = /"csp"\s*:\s*"([^"]+)"/.exec(conf)?.[1] || '';
const directive = (name) => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(policy) || [])[1] || '';
const released = productionAdditions(page);

console.log('Inline styles survive a production build:');
{
  ok('the policy allows inline styles as configured', /'unsafe-inline'/.test(directive('style-src')));
  ok('index.html has no style block, so no nonce reaches style-src and that holds in a release',
    !released.styleNonce, 'move it into a stylesheet: a nonce makes the browser ignore \'unsafe-inline\' for every style in the app');
  // Control: the page as it shipped, with a launch background inline.
  const shipped = page.replace('</head>', '<style id="critical-launch-bg">html{background:#000}</style></head>');
  ok('control: a style block in the page puts a nonce in style-src', productionAdditions(shipped).styleNonce);
  ok('control: a style block inside a comment does not', !productionAdditions('<!-- <style>x</style> -->').styleNonce);
}

console.log('\nWhat a release does with scripts:');
{
  // The page's two inline scripts — the import map and the PDF worker path —
  // are hashed, so 'unsafe-inline' in script-src has no effect in a release.
  // Inline script, an onclick="" written as markup included, does not run there.
  ok('a release adds hashes to script-src, so its \'unsafe-inline\' does not apply', released.scriptNonceOrHash);

  // So a handler written into markup — onclick="", oninput="" — is dead in
  // every release, however well it works in development. The agent editor's
  // role icons and its temperature readout were both wired that way.
  const HANDLER = /\son(click|dblclick|change|input|error|load|submit|mouse[a-z]+|key[a-z]+|focus|blur|pointer[a-z]+)\s*=\s*["']/i;
  const src = join(root, 'src');
  const offenders = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'vendor') continue;
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|html)$/.test(name)) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|<!--)/.test(line)) return;
        if (HANDLER.test(line)) offenders.push(`${full.slice(src.length + 1)}:${i + 1}`);
      });
    }
  })(src);
  ok('no event handler is written into markup anywhere in the app', offenders.length === 0, offenders.join(', '));
  ok('control: the pattern finds one', HANDLER.test('<button onclick="x()">'));
}

console.log(`\n${pass} passed, ${fail} failed  (the released app's policy)`);
process.exit(fail ? 1 : 0);
