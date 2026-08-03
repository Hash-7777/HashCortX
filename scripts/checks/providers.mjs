// ==============================================================
// Cloud provider checks
//
// Loads the REAL src/js/providers.js, and reads the real Content Security
// Policy out of src-tauri/tauri.conf.json.
//
// The check that earns this file: every endpoint the app can call must be
// inside the CSP's connect-src list. If it is not, the request is blocked by
// the webview — not with an error naming the policy, but as a failed fetch
// that the app reports as the provider being unreachable. That is a very
// convincing way to look broken, and nothing else in the repository would
// catch it before a user did.
//
// It also checks the reverse: every provider the settings screen offers must
// exist in the table, so adding a provider to the UI and forgetting the
// endpoint fails here rather than at runtime.
//
// Run with: npm run check:providers
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const src = readFileSync(join(root, 'src', 'js', 'providers.js'), 'utf8');
const sandbox = { window: {}, URL };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'providers.js' });
const P = sandbox.window.HCProviders;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── The CSP, read from the real config ───────────────────────────────────────
const conf = readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8');
const cspLine = /"csp"\s*:\s*"([^"]+)"/.exec(conf);
const connectSrc = cspLine
  ? (/connect-src ([^;"]+)/.exec(cspLine[1])?.[1] || '').trim().split(/\s+/)
  : [];

console.log('\nThe policy was found and read:');
ok('tauri.conf.json has a csp', !!cspLine);
ok('it has a connect-src list', connectSrc.length > 0, `${connectSrc.length} entries`);

function cspAllows(origin) {
  const { protocol, hostname } = new URL(origin);
  return connectSrc.some((entry) => {
    if (entry === "'self'" || entry === '*') return entry === '*';
    let e = entry;
    if (!/^[a-z]+:/.test(e)) e = `${protocol}//${e}`;
    let parsed;
    try { parsed = new URL(e); } catch { return false; }
    if (parsed.protocol !== protocol) return false;
    if (parsed.hostname === hostname) return true;
    // A wildcard entry such as http://*:11434 matches any host on that port.
    if (parsed.hostname === '*') return true;
    if (parsed.hostname.startsWith('*.')) return hostname.endsWith(parsed.hostname.slice(1));
    return false;
  });
}

console.log('\nEvery provider endpoint is inside connect-src:');
for (const origin of P.allHosts()) {
  ok(`reachable: ${origin}`, cspAllows(origin),
    'the webview would block this — add it to connect-src in tauri.conf.json');
}

console.log('\nEvery provider the settings screen offers is in the table:');
{
  // Read the list the UI actually builds from, rather than a copy of it.
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  const block = /const API_PROVIDERS = \[([\s\S]*?)\n  \];/.exec(app);
  ok('API_PROVIDERS was found in app.js', !!block);
  const offered = block ? [...block[1].matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map(m => m[1]) : [];
  ok('it lists providers', offered.length > 0, `${offered.length} found`);
  for (const id of offered) {
    ok(`in the table: ${id}`, !!P.get(id), 'the settings screen offers it but nothing knows its endpoint');
  }
}

console.log('\nEvery entry in the table is complete:');
for (const [id, p] of Object.entries(P.PROVIDERS)) {
  ok(`${id} has a label`, typeof p.label === 'string' && p.label.length > 0);
  ok(`${id} says how it authenticates`, ['bearer', 'anthropic', 'query'].includes(p.auth), `got ${p.auth}`);
  ok(`${id} names somewhere to reach it`, !!(p.chatUrl || p.host || (p.hosts && p.hosts.length)));
  if (p.chatUrl) ok(`${id} uses https`, new URL(p.chatUrl).protocol === 'https:');
}

console.log('\nHeaders carry the key the way each provider expects:');
{
  const bearer = P.headersFor('groq', 'KEY123');
  ok('bearer providers send Authorization', bearer.Authorization === 'Bearer KEY123');
  ok('and a JSON content type', bearer['Content-Type'] === 'application/json');

  const anthropic = P.headersFor('anthropic', 'KEY123');
  ok('anthropic sends x-api-key, not Authorization', anthropic['x-api-key'] === 'KEY123' && !anthropic.Authorization);
  ok('anthropic sends its required version header', !!anthropic['anthropic-version']);

  const gemini = P.headersFor('gemini', 'KEY123');
  ok('a query-auth provider puts no key in the headers',
    !gemini.Authorization && !gemini['x-api-key'] && !JSON.stringify(gemini).includes('KEY123'));

  const router = P.headersFor('openrouter', 'KEY123');
  ok('openrouter keeps its attribution headers', router['X-Title'] === 'HashCortx' && !!router['HTTP-Referer']);
}

console.log('\nAn unknown provider fails loudly rather than plausibly:');
{
  let threw = false;
  try { P.headersFor('nope', 'k'); } catch { threw = true; }
  ok('headersFor throws', threw);
  threw = false;
  try { P.requestFor('nope', 'k'); } catch { threw = true; }
  ok('requestFor throws', threw);
  threw = false;
  // Gemini builds its own URL; asking for a ready-made one is a mistake worth
  // reporting rather than papering over.
  try { P.requestFor('gemini', 'k'); } catch { threw = true; }
  ok('requestFor refuses a provider that builds its own URL', threw);
  ok('get() returns null for an unknown provider', P.get('nope') === null);
}

console.log('\nA ready-made request has both halves:');
{
  const r = P.requestFor('openai', 'KEY123');
  ok('it has the endpoint', r.url === 'https://api.openai.com/v1/chat/completions');
  ok('it has the headers', r.headers.Authorization === 'Bearer KEY123');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/providers.js)`);
process.exit(fail ? 1 : 0);
