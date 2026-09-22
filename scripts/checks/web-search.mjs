// ==============================================================
// Web search checks
//
// Loads the REAL src/js/chat/web-search.js with a stand-in fetch, so what is
// asked of each search service, and what comes back, is checked with no
// network.
//
// Run with: npm run check:web-search
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, encodeURIComponent, JSON, Set };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'web-search.js'), sandbox, { filename: 'web-search.js' });
const W = sandbox.window.HCWebSearch;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const recorder = (answer) => {
  const asked = [];
  return { asked, fetch: async (url, init) => { asked.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null }); return answer(url); } };
};
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

console.log('A query written for a search box:');
{
  const q = W.queryOf('site:nodejs.org latest version');
  ok('the site is taken out of the words', q.words === 'latest version' && q.domains.join() === 'nodejs.org');
  const only = W.queryOf('site:https://nodejs.org/en/download/');
  ok('a query that is only a site still has words to search', only.words === 'nodejs org en download' && only.domains.join() === 'nodejs.org');
  ok('a plain query is left as it is', W.queryOf('latest stable Node.js').words === 'latest stable Node.js' && W.queryOf('latest stable Node.js').domains.length === 0);
  ok('the same site named twice is one domain', W.queryOf('a site:x.org site:X.org/b').domains.join() === 'x.org');
}

console.log('\nTavily:');
{
  const r = recorder(() => json({ answer: 'v26', results: [{ title: 'Node', content: 'x'.repeat(900), url: 'https://nodejs.org', score: 0.9 }] }));
  const out = await W.tavily('site:nodejs.org latest version', 5, { key: 'k', fetch: r.fetch });
  ok('the site goes in the field Tavily has for it, never in the query', r.asked[0].body.include_domains.join() === 'nodejs.org' && r.asked[0].body.query === 'latest version');
  ok('the key goes only to Tavily, with no referrer', r.asked[0].url === 'https://api.tavily.com/search' && r.asked[0].body.api_key === 'k' && r.asked[0].init.referrerPolicy === 'no-referrer');
  ok('its answer and results come back, each snippet cut to size', out.answer === 'v26' && out.results[0].url === 'https://nodejs.org' && out.results[0].snippet.length === 400);
  const plain = recorder(() => json({ results: [] }));
  await W.tavily('node', 5, { key: 'k', fetch: plain.fetch });
  ok('a query naming no site sends no domain filter', !('include_domains' in plain.asked[0].body));
  ok('no key, no request', (await W.tavily('x', 5, { fetch: async () => { throw new Error('asked'); } })) === null);
  ok('a refusal is "no answer", so the next search is tried', (await W.tavily('x', 5, { key: 'k', fetch: async () => json({}, 400) })) === null);
  ok('an unreachable service is the same', (await W.tavily('x', 5, { key: 'k', fetch: async () => { throw new Error('offline'); } })) === null);
}

console.log('\nGoogle and Wikipedia:');
{
  const g = recorder(() => json({ items: [{ title: 'T', snippet: 's', link: 'https://a.b' }] }));
  const out = await W.google('q', 3, { key: 'k', cx: 'c', fetch: g.fetch });
  ok('Google is asked on the one host the CSP permits', g.asked[0].url.startsWith('https://customsearch.googleapis.com/customsearch/v1?') && out[0].url === 'https://a.b');
  ok('... and only with both its key and its engine id', (await W.google('q', 3, { key: 'k', fetch: g.fetch })) === null);
  const w = recorder((url) => (url.includes('list=search')
    ? json({ query: { search: [{ title: 'Node.js' }] } })
    : json({ query: { pages: { 1: { title: 'Node.js', extract: 'A runtime.' } } } })));
  const wiki = await W.wikipedia('site:nodejs.org node', 3, { fetch: w.fetch });
  ok('Wikipedia is searched for the words, a site filter it cannot read left out', w.asked[0].url.includes('srsearch=node&') && wiki[0].url === 'https://en.wikipedia.org/wiki/Node.js');
  ok('... and a failure there is an empty list', (await W.wikipedia('x', 3, { fetch: async () => { throw new Error('offline'); } })).length === 0);
}

console.log('\nHow the chat uses it:');
{
  const app = src('js', 'app.js');
  ok('each key is read at the moment of asking and handed only to its own service', /HCWebSearch\.tavily\(query, limit, \{ key: \(tavilyKeyEl\.value/.test(app) && /HCWebSearch\.google\(query, limit, \{ key: googleKeyEl\.value\.trim\(\), cx: googleCxEl/.test(app));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/chat/web-search.js'") > 0 && src('boot.js').indexOf("'/js/chat/web-search.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/web-search.js)`);
process.exit(fail ? 1 : 0);
