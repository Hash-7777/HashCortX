// ==============================================================
// Looking something up for a model that cannot — checks
//
// Loads the REAL src/js/code/lookup.js and holds when HashCoder reads an
// address or searches for a model given no web tools, and what it searches
// for; that a request to build a search box or an online shop is not a
// lookup; that a model with the tools does its own; that light mode shows
// the results as words; and that the loop makes the calls before the
// model's first turn.
//
// Run with: npm run check:code-lookup
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'lookup.js'), sandbox, { filename: 'lookup.js' });
vm.runInContext(src('js', 'code', 'light.js'), sandbox, { filename: 'light.js' });
const L = sandbox.HCCodeLookup;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const q = (request, earlier = []) => { const c = L.callsFor(request, ['read_file', 'write_file'], earlier); return c.length ? (c[0].arguments.query ?? c[0].arguments.url) : ''; };

console.log('What is searched for:');
ok('a name the request gives', q('make a page for the pharmacy called Lantern Lane Pharmacy, look it up to get real info and pics') === 'Lantern Lane Pharmacy');
ok('what follows "look up" or "search for"', q('look up Lantern Lane Pharmacy Bristol and use their colours') === 'Lantern Lane Pharmacy Bristol' && q('search for the best date picker library and add it') === 'the best date picker library');
ok('what follows "find info about"', q('find info about the borrow checker and explain it') === 'the borrow checker');
ok('the words just before "search it"', q('the bakery is Orchard Crumb search it to get logos') === 'the bakery is Orchard Crumb');
ok('"search on the internet" after a request that named something searches for that', q('search on internet', ['the shop called Orchard Crumb search it for logos', 'make a site']) === 'Orchard Crumb' && q('search the web', ['the pharmacy is called Lantern Lane Pharmacy']) === 'Lantern Lane Pharmacy');
ok('...and searches for nothing when nothing was named', q('search on internet', ['make a simple site']) === '' && q('look it up') === '');
ok('no more than twelve words', q(`look up ${'word '.repeat(30)}`).split(' ').length === 12);

console.log('\nWhat is not a lookup:');
for (const r of ['add a search bar to the header', 'make an online shop for shoes', 'add a button to get details of the user', 'build a page that shows info from the API', 'make a simple website for a pharmacy', 'fix the bug in app.js', 'make the hero look rich']) ok(`"${r}"`, q(r) === '');

console.log('\nAn address given:');
{
  const c = L.callsFor('use the colours from https://lanternlane.example/about, and https://lanternlane.example/menu. Also https://third.example/', [], []);
  ok('each address is read, two at most, without the punctuation after it', c.length === 2 && c[0].name === 'fetch_url' && c[0].arguments.url === 'https://lanternlane.example/about' && c[1].arguments.url === 'https://lanternlane.example/menu');
}

console.log('\nWho does the looking up:');
ok('a model given web_search and fetch_url does its own', L.callsFor('look up Orchard Crumb', ['web_search', 'fetch_url', 'read_file']).length === 0);
ok('a model given neither, or only one, has it done', L.callsFor('look up Orchard Crumb', ['read_file']).length === 1 && L.callsFor('look up Orchard Crumb', ['web_search']).length === 1 && L.callsFor('look up Orchard Crumb', []).length === 1);
{
  const turn = L.turnFor([{ role: 'system', content: 'x' }, { role: 'user', content: 'the bakery called Orchard Crumb' }, { role: 'user', content: 'note', note: true }, { role: 'user', content: 'search on the internet' }], 'search on the internet', [{ function: { name: 'read_file' } }]);
  ok('the turn it takes has the calls with ids of their own, and reads the earlier request, not the app\'s notes', turn && turn.content === '' && turn.tool_calls.length === 1 && /^look_\d+_0$/.test(turn.tool_calls[0].id) && turn.tool_calls[0].arguments.query === 'Orchard Crumb');
  ok('no lookup, no turn', L.turnFor([], 'fix the bug', []) === null);
}

console.log('\nLight mode shows the results as words:');
{
  const LT = sandbox.HCCodeLight;
  const msgs = [
    { role: 'user', content: 'look up Orchard Crumb' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'web_search', arguments: JSON.stringify({ query: 'Orchard Crumb' }) } }, { id: 'b', function: { name: 'fetch_url', arguments: JSON.stringify({ url: 'https://orchard.example/' }) } }] },
    { role: 'tool', tool_call_id: 'a', content: JSON.stringify({ query: 'Orchard Crumb', source: 'duckduckgo', results: [{ title: 'Orchard Crumb Bakery', url: 'https://orchard.example/', snippet: 'Bread since 1990.' }] }) },
    { role: 'tool', tool_call_id: 'b', content: JSON.stringify({ url: 'https://orchard.example/', title: 'Orchard Crumb', contact: { phones: ['020 7946 0456'], emails: [], addresses: ['3 Mill Road'], hours: [], social: [] }, logos: [{ url: 'https://orchard.example/logo.png' }], colours: ['#7a4b2a'], images: [{ url: 'https://orchard.example/loaf.jpg', alt: 'A loaf' }], links: [{ text: 'About', url: 'https://orchard.example/about' }], text: 'We bake every morning.' }) },
  ];
  const out = LT.callMessages(msgs).map((m) => m.content).join('\n---\n');
  ok('the search is the app\'s, not a line the model wrote', !/^web_search$|^fetch_url$/m.test(out));
  ok('results as a list with their addresses and snippets', /HashCortX searched the web for "Orchard Crumb":[\s\S]*- Orchard Crumb Bakery \(https:\/\/orchard\.example\/\): Bread since 1990\./.test(out), out);
  ok('a page as its details, logo, colours, pictures, other pages and text', /HashCortX read https:\/\/orchard\.example\/:[\s\S]*Phones: 020 7946 0456[\s\S]*Addresses: 3 Mill Road[\s\S]*Logo: https:\/\/orchard\.example\/logo\.png[\s\S]*Colours: #7a4b2a[\s\S]*- https:\/\/orchard\.example\/loaf\.jpg \(A loaf\)[\s\S]*About \(https:\/\/orchard\.example\/about\)[\s\S]*We bake every morning\./.test(out), out);
  const none = LT.callMessages([{ role: 'assistant', content: '', tool_calls: [{ id: 'c', function: { name: 'web_search', arguments: JSON.stringify({ query: 'zz' }) } }] }, { role: 'tool', tool_call_id: 'c', content: JSON.stringify({ query: 'zz', results: [] }) }]).map((m) => m.content).join('\n');
  ok('nothing found says so, and says not to write what a search would have found', /found nothing\. Do not write what a search would have found/.test(none));
}

console.log('\nThe loop:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('the calls are made before the model\'s first turn, for a model with no web tools, not for a greeting', /if \(!bare && \(forced = window\.HCCodeLookup\?\.turnFor\(messages, window\.HCCodeVerify\.requestIn\(messages\), tools\) \|\| null\)\) cdrTraceAdd\(/.test(mode)
    && mode.indexOf('window.HCCodeLookup?.turnFor') < mode.indexOf('for (;;) {', mode.indexOf('async function agentLoop')));
  ok('they go through the tools themselves, so the person is asked as for any fetch or search', /turn = forced \|\| await callWithRouter\(/.test(mode));
  const boot = src('boot.js');
  ok('it loads before the Coder', boot.indexOf("'/js/code/lookup.js'") > 0);
  ok('this check is part of npm run check', /npm run check:code-lookup\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/lookup.js)`);
process.exit(fail ? 1 : 0);
