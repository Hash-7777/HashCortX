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

console.log('\nMoonshot answers on four hosts, and the order matters:');
{
  ok('the OpenAI-compatible bases are all listed', P.MOONSHOT_API_BASES.length === 4);
  ok('and the Anthropic-protocol ones too', P.KIMI_ANTHROPIC_BASES.length === 4);
  ok('every base is https', [...P.MOONSHOT_API_BASES, ...P.KIMI_ANTHROPIC_BASES]
    .every((b) => b.startsWith('https://')));
  ok('all of them are inside connect-src',
    [...P.MOONSHOT_API_BASES, ...P.KIMI_ANTHROPIC_BASES].every((b) => cspAllows(new URL(b).origin)));

  const base = P.MOONSHOT_API_BASES[2];
  const ordered = P.orderedMoonshotBases(base);
  ok('a base that worked before is tried first', ordered[0] === base);
  ok('and the rest still follow it', ordered.length === P.MOONSHOT_API_BASES.length);
  ok('no base is lost or repeated', new Set(ordered).size === P.MOONSHOT_API_BASES.length);
  ok('with nothing remembered, the default order stands',
    P.orderedMoonshotBases(null)[0] === P.MOONSHOT_API_BASES[0]);
  ok('a remembered base that is not one of ours is ignored',
    P.orderedMoonshotBases('https://elsewhere.example/v1')[0] === P.MOONSHOT_API_BASES[0]);
}

console.log('\nA key refused by the wrong platform is not treated as a bad key:');
{
  // kimi.com and the older Moonshot platforms are separate account systems, so
  // a valid key returns 401 on the wrong one. Stopping there would report a
  // working key as broken.
  ok('401 tries the next host', P.shouldTryNextMoonshotEndpoint(401) === true);
  ok('403 tries the next host', P.shouldTryNextMoonshotEndpoint(403) === true);
  ok('404 tries the next host', P.shouldTryNextMoonshotEndpoint(404) === true);
  ok('500 does not — that is the host failing, not the wrong host',
    P.shouldTryNextMoonshotEndpoint(500) === false);
  ok('429 does not — sweeping hosts would just spend the rate limit again',
    P.shouldTryNextMoonshotEndpoint(429) === false);
  ok('200 does not', P.shouldTryNextMoonshotEndpoint(200) === false);
}

console.log('\nA Kimi for Code key is recognised, since it speaks another protocol:');
{
  ok('sk-ki is recognised', P.isKimiCodeKey('sk-ki-abc123') === true);
  ok('whatever the case', P.isKimiCodeKey('SK-KI-ABC') === true);
  ok('and with stray spaces', P.isKimiCodeKey('  sk-ki-abc  ') === true);
  ok('an ordinary Moonshot key is not', P.isKimiCodeKey('sk-abcdef') === false);
  ok('nothing is not', P.isKimiCodeKey('') === false && P.isKimiCodeKey(null) === false);
}

console.log('\nEach host is named the way a user would recognise it:');
{
  ok('kimi.com', P.moonshotEndpointLabel('https://api.kimi.com/v1') === 'api.kimi.com');
  ok('kimi.ai', P.moonshotEndpointLabel('https://api.kimi.ai/v1') === 'api.kimi.ai');
  ok('moonshot.cn', P.moonshotEndpointLabel('https://api.moonshot.cn/v1') === 'api.moonshot.cn');
  ok('moonshot.ai', P.moonshotEndpointLabel('https://api.moonshot.ai/v1') === 'api.moonshot.ai');
  ok('every base maps to a label',
    P.MOONSHOT_API_BASES.every((b) => P.moonshotEndpointLabel(b).startsWith('api.')));
}

console.log('\nMoonshot models are offered newest first, and none is dropped:');
{
  const listed = P.sortMoonshotModelIds(['moonshot-v1-8k', 'kimi-k2.6', 'kimi-k2-thinking']);
  ok('the newest comes first', listed[0] === 'kimi-k2.6');
  ok('the oldest comes last', listed[listed.length - 1] === 'moonshot-v1-8k');
  // A model released after this list was written must still appear.
  const withUnknown = P.sortMoonshotModelIds(['zzz-future-model', 'kimi-k2.6']);
  ok('an unlisted model still appears', withUnknown.includes('zzz-future-model'));
  ok('and sorts after the known ones', withUnknown[1] === 'zzz-future-model');
  ok('nothing is lost', P.sortMoonshotModelIds(['a', 'b', 'c']).length === 3);
  ok('the input is not modified', (() => {
    const input = ['moonshot-v1-8k', 'kimi-k2.6'];
    P.sortMoonshotModelIds(input);
    return input[0] === 'moonshot-v1-8k';
  })());
  ok('an empty list is safe', P.sortMoonshotModelIds([]).length === 0);
  ok('undefined is safe', P.sortMoonshotModelIds(undefined).length === 0);
}

console.log('\nAn OpenAI-style conversation becomes the Anthropic body Kimi expects:');
{
  const body = P.buildKimiAnthropicBody('kimi-k2.6', [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ], { temperature: 0.4, maxTokens: 100 });

  ok('the system prompt is lifted out', body.system === 'be brief');
  ok('and is not left among the messages', body.messages.every((m) => m.role !== 'system'));
  ok('content becomes an array', Array.isArray(body.messages[0].content));
  ok('the text survives', body.messages[0].content[0].text === 'hello');
  ok('roles are preserved', body.messages[1].role === 'assistant');
  ok('max_tokens is set', body.max_tokens === 100);
  ok('temperature is passed', body.temperature === 0.4);
  ok('streaming is off unless asked', body.stream === undefined);

  // Anthropic rejects an empty content array outright.
  const empty = P.buildKimiAnthropicBody('m', [{ role: 'user', content: '' }], {});
  ok('an empty message still carries one block', empty.messages[0].content.length === 1);
  ok('max_tokens has a default', empty.max_tokens === 4096);

  const withImage = P.buildKimiAnthropicBody('m', [{ role: 'user', content: 'see', images: ['AAA'] }], {});
  ok('an image becomes a base64 block', withImage.messages[0].content[1].source.data === 'AAA');
  ok('alongside the text', withImage.messages[0].content[0].type === 'text');

  // Anthropic knows only user and assistant.
  const toolish = P.buildKimiAnthropicBody('m', [{ role: 'tool', content: 'result' }], {});
  ok('an unknown role becomes user', toolish.messages[0].role === 'user');
  ok('no messages is safe', P.buildKimiAnthropicBody('m', [], {}).messages.length === 0);
  ok('undefined messages is safe', P.buildKimiAnthropicBody('m', undefined, {}).messages.length === 0);
}

// ── What came back ───────────────────────────────────────────────────────
console.log('\nHow many tokens a provider says it used, whichever way it says it:');
{
  const U = P.usageFrom;
  // The OpenAI spelling, which most providers follow.
  ok('the common spelling is read',
    JSON.stringify(U({ usage: { prompt_tokens: 12, completion_tokens: 5 } })) === '{"input":12,"output":5}');
  ok("Anthropic's is read too",
    JSON.stringify(U({ usage: { input_tokens: 7, output_tokens: 3 } })) === '{"input":7,"output":3}');
  ok("Gemini's is read too",
    JSON.stringify(U({ usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } })) === '{"input":9,"output":4}');
  ok("and the pair Ollama puts on its final object",
    JSON.stringify(U({ prompt_eval_count: 20, eval_count: 6 })) === '{"input":20,"output":6}');

  // These numbers go into a log a SEPARATE application reads. A response that
  // does not report usage must not be recorded as having cost nothing —
  // silence and zero are different, and only one of them is a measurement.
  ok('a response that says nothing about usage reports nothing', U({ choices: [] }) === null);
  ok('and so does an answer that is not an object at all',
    U(null) === null && U('text') === null && U(undefined) === null);
  ok('a genuine zero is still a zero, not silence',
    JSON.stringify(U({ usage: { prompt_tokens: 0, completion_tokens: 0 } })) === '{"input":0,"output":0}');
  // An empty usage object is a provider saying nothing in a longer way.
  ok('an empty usage object falls through rather than reporting nothing used',
    U({ usage: {}, usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }) !== null);
  ok('half an answer is still read', JSON.stringify(U({ usage: { completion_tokens: 4 } })) === '{"output":4}');
}

console.log('\nWhat somebody is told when a request failed:');
{
  const E = P.cloudHttpError;
  // Almost all of what a person sees on a bad day. A rate limit is not a
  // broken key, and being told the wrong one sends them to regenerate a key
  // that was working.
  const limited = E('groq', 429, '', null);
  ok('a rate limit is named as one', /rate limit/i.test(limited));
  // The single most confusing thing about these providers: a request that
  // FAILED still counts, so retrying a failure spends the budget.
  ok('and says that failed requests count against the quota too',
    /failed requests count/i.test(limited));
  ok('with somewhere to go and look', /console\.groq\.com/.test(limited));
  ok('a stated wait is used when the provider gave one',
    /Try again in 30s/.test(E('groq', 429, '', 30)));
  ok('and a sensible one when it did not', /~60s/.test(E('groq', 429, '', null)));

  const rejected = E('gemini', 401, 'invalid key', null);
  ok('a rejected key says the key was rejected', /rejected the API key/i.test(rejected));
  ok('and does not call it a rate limit', !/rate limit/i.test(rejected));
  ok('and points at where that provider makes keys', /aistudio\.google\.com/.test(rejected));
  ok('what the server said is passed on', /invalid key/.test(rejected));
  ok('403 is treated the same as 401', /rejected the API key/i.test(E('gemini', 403, '', null)));

  ok('a missing model says the model is missing', /model not found/i.test(E('openrouter', 404, '', null)));
  ok('an overloaded provider is not called broken', /overloaded/i.test(E('anthropic', 529, '', null)));
  ok('a server fault is named as theirs', /server error/i.test(E('samba', 500, '', null)));
  ok('and anything else still says which provider and what code',
    /Cerebras error 418/.test(E('cerebras', 418, '', null)));

  // Every provider the app can talk to must have a name a person recognises
  // and somewhere to look, or the message is worse than no message.
  const named = ['groq', 'gemini', 'openrouter', 'cerebras', 'samba', 'openai', 'anthropic', 'moonshot', 'deepseek', 'mistral'];
  ok('every provider has a readable name',
    named.every((p) => !new RegExp(`^${p} `).test(E(p, 500, '', null))),
    named.filter((p) => new RegExp(`^${p} `).test(E(p, 500, '', null))).join(', '));
  ok('and somewhere to check its quota',
    named.every((p) => /\w+\.\w+/.test(E(p, 429, '', null))));
  // A provider nobody listed still produces a message rather than "undefined"
  // — it is named by its own identifier, which is worse than a proper label
  // and far better than nothing.
  ok('a provider nobody listed is still named in its message',
    E('something', 500, '', null).startsWith('something')
    && E('something', 418, '', null).startsWith('something'));
  // Every message must name the provider and then say something — either what
  // went wrong or, for a code nobody has a sentence for, the code itself.
  ok('and every status says the provider and then something more',
    [429, 401, 404, 503, 500, 418].every((code) => {
      const message = E('something', code, '', null);
      return message.startsWith('something ') && message.length > 'something '.length + 5;
    }));
  // A wall of provider HTML in an error box helps nobody.
  ok('a long server response is cut down',
    E('groq', 400, 'x'.repeat(5000), null).length < 300);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/providers.js)`);
process.exit(fail ? 1 : 0);
