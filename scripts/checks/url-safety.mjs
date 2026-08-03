// ==============================================================
// Fetch-address checks
//
// Loads the REAL src/js/url-safety.js into a Node VM.
//
// This gate decides where a language model may send the agent. It shipped
// untested, and the comment above it claimed a server proxy did a stricter
// check that no shipped build ever had. These pin what it does refuse — and,
// just as importantly, what it must keep allowing, because a fetch tool that
// blocks ordinary websites is a broken tool that people work around.
//
// Run with: npm run check:url-safety
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'url-safety.js'), 'utf8');
const sandbox = { window: {}, URL };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'url-safety.js' });
const U = sandbox.window.HCUrlSafety;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

console.log('\nSchemes that do not fetch a remote document are refused:');
for (const u of [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,<script>x</script>',
  'ftp://example.com/x',
  'not a url at all',
  '',
]) ok(`refused: ${u.slice(0, 40) || '(empty)'}`, U.isSafeExternalUrl(u) === false);

console.log('\nThe user’s own machine and network are refused:');
for (const u of [
  'http://localhost/admin',
  'http://127.0.0.1:8080/',
  'http://0.0.0.0/',
  'http://10.1.2.3/',
  'http://192.168.1.1/',
  'http://172.16.5.5/',
  'http://172.31.255.255/',
  'http://[::1]/',
  'http://[fe80::1]/',
  'http://[fc00::1]/',
  'http://[fd12:3456::1]/',
]) ok(`refused: ${u}`, U.isSafeExternalUrl(u) === false);

console.log('\nCloud metadata services are refused:');
for (const u of [
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://metadata.goog/',
  'http://100.100.100.200/',
]) ok(`refused: ${u}`, U.isSafeExternalUrl(u) === false);

console.log('\nCredentials in the URL are refused — they disguise the real host:');
for (const u of [
  'https://user:pass@example.com/',
  'https://evil.com:x@example.com/',
]) ok(`refused: ${u}`, U.isSafeExternalUrl(u) === false);

console.log('\nOrdinary public addresses are still allowed:');
for (const u of [
  'https://example.com/',
  'https://en.wikipedia.org/wiki/Rust',
  'http://example.org/page?q=1#frag',
  'https://sub.domain.example.co.uk/path',
  'https://8.8.8.8/',
  'https://172.15.0.1/',   // just outside the private 172.16–31 block
  'https://172.32.0.1/',   // just outside the other end
  'https://11.0.0.1/',     // not 10.x
  'https://100.63.0.1/',   // just below carrier-grade NAT
  'https://100.128.0.1/',  // just above it
]) ok(`allowed: ${u}`, U.isSafeExternalUrl(u) === true);

console.log('\nThe hostname rule is reusable on its own, for resolved addresses:');
for (const h of ['127.0.0.1', '10.0.0.1', '192.168.0.5', '169.254.169.254', '::1', 'fe80::1', 'fd00::1', '0.0.0.0'])
  ok(`private: ${h}`, U.isPrivateHostname(h) === true);
for (const h of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', 'example.com'])
  ok(`public: ${h}`, U.isPrivateHostname(h) === false);
ok('an empty hostname is treated as unsafe', U.isPrivateHostname('') === true);
ok('null is treated as unsafe', U.isPrivateHostname(null) === true);

console.log('\nThe hostname a caller must resolve is reported:');
ok('from a normal URL', U.hostnameOf('https://Example.COM/path') === 'example.com');
ok('from a URL with a port', U.hostnameOf('https://example.com:8443/x') === 'example.com');
ok('null when it is not a URL', U.hostnameOf('nonsense') === null);

console.log('\nWhat this check CANNOT do, recorded so it is not mistaken for more:');
{
  // A public name that resolves to a private address passes here. It has to:
  // the renderer cannot resolve a name. This is why net_resolve_is_public
  // exists in Rust, and why removing that call would reopen the hole.
  ok('a public hostname is allowed on its face, whatever it resolves to',
    U.isSafeExternalUrl('http://internal.example.com/') === true);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/url-safety.js)`);
process.exit(fail ? 1 : 0);
