// ============================================================
// Ready-made connections, and how a key is presented —
// src/js/mcp/presets.js. Run with: npm run check:mcp-presets
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sandbox = { window: {}, String, Array, Object };
vm.createContext(sandbox);
vm.runInContext(src('js', 'mcp', 'presets.js'), sandbox, { filename: 'presets.js' });
const P = sandbox.window.HCMcpPresets;
const byId = (id) => P.PRESETS.find((p) => p.id === id);

console.log('The ready-made choices:');
{
  ok('each service a person can connect with a key today, and one for any other system', P.PRESETS.map((p) => p.id).join() === 'odoo,github,stripe,supabase,other');
  ok('each says what key it needs and where to get it', P.PRESETS.every((p) => p.name && p.key && p.key.label && p.key.note));
  ok('a hosted service has its own address; a system a company runs asks for its address', P.PRESETS.every((p) => !!p.url !== !!p.address));
  // Pinned as each service's own documentation gives them, so a change is made on purpose.
  ok('GitHub, at its documented address, reading-only unless the person says otherwise', byId('github').url === 'https://api.githubcopilot.com/mcp/' && byId('github').readOnlyUrl === 'https://api.githubcopilot.com/mcp/readonly' && byId('github').auth === 'bearer');
  ok('Stripe, at its documented address, with an agent key as a bearer token', byId('stripe').url === 'https://mcp.stripe.com' && !byId('stripe').readOnlyUrl && byId('stripe').auth === 'bearer' && /agent key/i.test(byId('stripe').key.label));
  ok('Supabase, at its documented address, read-only unless the person says otherwise', byId('supabase').url === 'https://mcp.supabase.com/mcp' && byId('supabase').readOnlyUrl === 'https://mcp.supabase.com/mcp?read_only=true' && byId('supabase').auth === 'bearer');
  ok('Odoo takes the address its connector shows, and its key tried the usual ways', !byId('odoo').url && byId('odoo').auth === 'auto' && /MCP server app in your Odoo/.test(byId('odoo').address.note));
  ok('every fixed address is https', P.PRESETS.filter((p) => p.url).every((p) => [p.url, p.readOnlyUrl].filter(Boolean).every((u) => u.startsWith('https://'))));
  ok('each ready-made choice signs in with a key; one that signs in through the browser needs no choice of its own', P.PRESETS.every((p) => ['bearer', 'auto'].includes(p.auth)));
  ok('an unknown choice is any other system', P.find('nope').id === 'other' && P.find('github').id === 'github');
}

console.log('\nThe address used:');
{
  ok('a service\'s reading-only address, unless reading only is turned off', P.addressOf(byId('github')) === 'https://api.githubcopilot.com/mcp/readonly' && P.addressOf(byId('github'), { readOnly: false }) === 'https://api.githubcopilot.com/mcp/');
  ok('a service with none has one address either way', P.addressOf(byId('stripe'), { readOnly: true }) === 'https://mcp.stripe.com' && P.addressOf(byId('stripe'), { readOnly: false }) === 'https://mcp.stripe.com');
  ok('otherwise the one the person gave, trimmed', P.addressOf(byId('odoo'), { address: '  https://acme.example.com/mcp ' }) === 'https://acme.example.com/mcp' && P.addressOf(byId('other'), {}) === '');
  ok('a hosted service ignores an address typed for another choice', P.addressOf(byId('supabase'), { address: 'https://elsewhere.example.com' }) === 'https://mcp.supabase.com/mcp?read_only=true');
}

console.log('\nHow a key is presented:');
{
  const ways = (...a) => P.attempts(...a).map((w) => `${w.auth}${w.header ? `:${w.header}` : ''}`).join();
  ok('automatic: as a bearer token, then in the key header most systems read', ways('auto', '', true) === 'bearer,header:X-API-Key');
  ok('automatic with no key: none, and then the browser if the system asks for a sign-in', ways('auto', '', false) === 'none,oauth');
  ok('a chosen key sign-in with no key sends none', ways('bearer', '', false) === 'none' && ways('header', 'X-Key', false) === 'none');
  ok('a browser sign-in sends no key, even one typed', ways('oauth', '', true) === 'oauth' && ways('oauth', '', false) === 'oauth');
  ok('a chosen way is the only one', ways('bearer', '', true) === 'bearer' && ways('header', ' X-Secret ', true) === 'header:X-Secret' && ways('none', '', true) === 'none');
}

console.log('\nA tool\'s name in words:');
{
  ok('words joined by underscores or dashes', P.toolLabel('search_records') === 'Search records' && P.toolLabel('get-record') === 'Get record');
  ok('words joined by capitals', P.toolLabel('listIssues') === 'List issues' && P.toolLabel('list_open_issues') === 'List open issues');
  ok('nothing stays nothing', P.toolLabel('') === '' && P.toolLabel(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/mcp/presets.js)`);
process.exit(fail ? 1 : 0);
