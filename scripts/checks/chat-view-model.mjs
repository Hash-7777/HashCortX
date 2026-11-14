// ==============================================================
// What a chat agent's thinking view shows, from its own steps — checks
//
// Loads the real src/js/chat/view-model.js with what it reads (the asks of
// a request, the chat's test of an answer covering an ask, code blocks)
// and holds the record a chat reply's view is drawn from: the sentence
// for each step, written by the app from the step itself; the journey's
// stations, in the order they were reached; the parts of the question and
// what served and answered them; the sources and their previews; and,
// once the answer is in, which sentence each source backs, the parts at a
// glance, how much of it came from what was read, and what is not
// confirmed. Nothing is taken from the model's account of itself.
//
// Run with: npm run check:chat-view-model
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['fences.js', 'code/asks.js', 'code/verify.js', 'code/facts.js', 'chat/finish.js']) vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
try { vm.runInContext(src('js', 'chat', 'view-model.js'), sandbox, { filename: 'view-model.js' }); } catch (e) { ok('view-model.js loads', false, String(e && e.message)); }
const V = sandbox.HCChatViewModel || {};
const said = (m) => (m && Array.isArray(m.say) ? m.say.map((p) => (typeof p === 'string' ? p : p.b)).join('') : '');

const ASK = 'When was Larkfield Lighthouse first lit? Who built it? Is it open to visitors?';
const WIKI = { results: [{ title: 'Larkfield Lighthouse', snippet: 'Larkfield Lighthouse stands on the headland. It was first lit in 1874 and built by the harbour board.', url: 'https://en.wikipedia.org/wiki/Larkfield_Lighthouse' }] };
const PAGE = { url: 'https://larkfield-harbour.example/visit', text: 'Visit the lighthouse. The gallery is open to visitors on summer weekends, from ten until four. Tickets at the harbour office.', offset: 0, total: 120, nextOffset: null };

console.log('\nIt begins with the question:');
let m = typeof V.start === 'function' ? V.start(ASK, 1000) : null;
{
  ok('the parts of a question of several asks, each open', !!m && m.parts.length === 3 && m.parts.every((p) => !p.served && !p.found && p.by.length === 0) && m.parts[0].text === 'When was Larkfield Lighthouse first lit', json(m && m.parts));
  ok('the journey starts at understanding, and says how many things there are to find out', !!m && m.now === 'understand' && json(m.stations) === '["understand"]' && said(m) === 'Reading your question: three things to find out', said(m));
  ok('...and a question of one ask is just read', said(V.start('What is a tide?', 0)) === 'Reading your question' && V.start('What is a tide?', 0).parts.length === 0);
  ok('it is plain data, kept with the reply', !!m && json(JSON.parse(json(m))) === json(m) && m.v === 1 && m.startedAt === 1000);
}

console.log('\nEach step, said by the app from the step itself:');
{
  const c = (name, args) => { const x = V.start(ASK, 0); V.toolCall(x, name, args); return x; };
  ok('a web search', said(c('web_search', { query: 'Larkfield Lighthouse history' })) === 'Searching the web for Larkfield Lighthouse history' && c('web_search', {}).now === 'search');
  ok('Wikipedia', said(c('wikipedia', { query: 'Larkfield Lighthouse' })) === 'Looking up Larkfield Lighthouse on Wikipedia');
  ok('PubMed', said(c('pubmed_search', { query: 'tidal breathing' })) === 'Searching PubMed for tidal breathing');
  ok('a page, by its site', said(c('fetch_url', { url: 'https://www.larkfield-harbour.example/visit?x=1' })) === 'Reading larkfield-harbour.example' && c('fetch_url', { url: 'https://x.example' }).now === 'read');
  ok('Python, a sum, the date', said(c('execute_python', { code: 'print(1)' })) === 'Working it out in Python' && said(c('calculate', { expression: '2+2' })) === 'Calculating' && said(c('current_datetime', {})) === 'Checking the date and time' && c('calculate', {}).now === 'work');
  ok('memory', said(c('remember_fact', { key: 'a', value: 'b' })) === 'Saving to memory' && said(c('recall_facts', {})) === 'Recalling what you told it before' && c('recall_facts', {}).now === 'memory');
  ok('any other tool, by its name', said(c('sys_books_search', { q: 'x' })) === 'Using sys_books_search');
  ok('the part it names is set apart, for the view to show strongly', json(c('web_search', { query: 'tides' }).say) === json(['Searching the web for ', { b: 'tides' }]));
  ok('what a search is for is cut short when long', said(c('web_search', { query: 'x'.repeat(200) })).length < 110);
}

console.log('\nWhat it searched and read:');
{
  V.toolCall(m, 'wikipedia', { query: 'Larkfield Lighthouse' });
  V.toolResult(m, 'wikipedia', WIKI);
  ok('a search is a source, named by what it looked for', m.sources.length === 1 && m.sources[0].kind === 'search' && m.sources[0].label === 'Wikipedia · Larkfield Lighthouse', json(m.sources[0]));
  ok('...with a preview of its first result: site, title, its opening lines', m.sources[0].site === 'en.wikipedia.org' && m.sources[0].title === 'Larkfield Lighthouse' && /first lit in 1874/.test(m.sources[0].excerpt));
  ok('the parts whose words it gives are served by it, not yet answered', m.parts[0].served === true && m.parts[1].served === true && m.parts[2].served === false && m.parts.every((p) => !p.found), json(m.parts));
  ok('the journey has reached the search', json(m.stations) === '["understand","search"]');
  V.toolCall(m, 'fetch_url', { url: PAGE.url });
  V.toolResult(m, 'fetch_url', PAGE);
  ok('each part keeps which sources served it, for the map to draw its lines', json(m.parts.map((x) => x.by)) === '[[0],[0],[1]]', json(m.parts.map((x) => x.by)));
  ok('a page read is a source of its own, previewed by its site and first words', m.sources.length === 2 && m.sources[1].kind === 'page' && m.sources[1].site === 'larkfield-harbour.example' && /open to visitors on summer weekends/.test(m.sources[1].excerpt) && m.parts[2].served === true, json(m.sources[1]));
  ok('...and the journey has reached reading', json(m.stations) === '["understand","search","read"]' && m.now === 'read');
  const failed = V.start(ASK, 0); V.toolCall(failed, 'fetch_url', { url: 'https://x.example' }); V.toolResult(failed, 'fetch_url', { error: 'The user declined to read that page.' });
  ok('a page that could not be read is not a source', failed.sources.length === 0);
  const tool = V.start(ASK, 0); V.toolCall(tool, 'calculate', { expression: '2+2' }); V.toolResult(tool, 'calculate', { result: 4 });
  ok('a tool that reads nothing from outside is a step, not a source', tool.sources.length === 0 && json(tool.stations) === '["understand","work"]');
  const long = V.start(ASK, 0); V.toolCall(long, 'web_search', { query: 'x' }); V.toolResult(long, 'web_search', { results: [{ title: 'T', snippet: 'word '.repeat(200), url: 'https://a.example/b' }] });
  ok('a preview is kept short', long.sources[0].excerpt.length <= 240 && long.sources[0].excerpt.endsWith('…'), String(long.sources[0].excerpt.length));
  const twice = V.start(ASK, 0); V.toolCall(twice, 'web_search', { query: 'a' }); V.toolCall(twice, 'web_search', { query: 'b' }); V.toolCall(twice, 'fetch_url', { url: 'https://a.example' }); V.toolCall(twice, 'web_search', { query: 'c' });
  ok('a station reached again is not added again', json(twice.stations) === '["understand","search","read"]' && twice.now === 'search', json(twice.stations));
  const partial = V.start(ASK, 0); V.toolCall(partial, 'fetch_url', { url: 'https://a.example' }); V.toolResult(partial, 'fetch_url', { error: 'The page stopped part way.', text: 'It was first lit in 1874.' });
  ok('a read that failed is not a source, whatever text came with it', partial.sources.length === 0);
}

console.log('\nThe app checking in, and writing:');
{
  V.check(m, 'Sent back: details nothing given or read says');
  ok('a check-in is said as going back over the answer', said(m) === 'Checking the answer: details nothing given or read says' && m.now === 'check' && m.checks.length === 1, said(m));
  V.writing(m);
  ok('writing is said as such', said(m) === 'Writing the answer' && m.now === 'write' && m.stations.includes('write'));
}

console.log('\nOnce the answer is in:');
{
  const answer = 'Larkfield Lighthouse was first lit in 1874 and built by the harbour board. Its gallery is open to visitors on summer weekends, from ten until four. The harbour office can be reached on 020 7946 0555.';
  V.finish(m, answer, { unsourced: [{ shown: '020 7946 0555' }], ended: 9400, checked: true });
  ok('it is done, and how long it took is kept', m.done === true && m.took === 8400 && m.now === 'done');
  ok('the line says it was answered and checked against what it read, when the checks ran', said(m) === 'Answered · checked against what it read', said(m));
  const unchecked = V.start(ASK, 0); V.toolCall(unchecked, 'wikipedia', {}); V.toolResult(unchecked, 'wikipedia', WIKI); V.finish(unchecked, 'It was first lit in 1874 and built by the harbour board.', { ended: 1 });
  ok('...and only answered when they did not', said(unchecked) === 'Answered', said(unchecked));
  ok('each sentence a source backs carries that source\'s number, numbered in the order first cited', json(m.chips.map((c) => [c.n, c.warn])) === json([[1, false], [2, false], ['?', true]]), json(m.chips));
  ok('...found again by the last words of its sentence', m.chips[0].tail === 'by the harbour board.' && m.chips[2].tail === 'on 020 7946 0555.', json(m.chips.map((c) => c.tail)));
  ok('...and the sources carry the same numbers', m.sources[0].n === 1 && m.sources[1].n === 2);
  ok('every part is answered', m.parts.every((p) => p.found));
  ok('at a glance: each part with the part of the sentence that answers it, and its source', m.glance.length === 3 && m.glance[0].n === 1 && m.glance[0].answer === 'Larkfield Lighthouse was first lit in 1874' && m.glance[1].answer === 'built by the harbour board' && m.glance[1].n === 1 && m.glance[2].answer === 'Its gallery is open to visitors on summer weekends' && m.glance[2].n === 2, json(m.glance));
  ok('...the whole sentence when no shorter part of it holds the part\'s words', V.glanceOf?.('It was lit in 1874.', 'When was it first lit') === 'It was lit in 1874.');
  ok('...or when the part that holds them is too short to stand alone', V.glanceOf?.('The cafe is small, open daily.', 'Is the cafe open daily') === 'The cafe is small, open daily.', String(V.glanceOf?.('The cafe is small, open daily.', 'Is the cafe open daily')));
  ok('grounding: how many of its sentences come from what it read', json(m.grounding) === json({ sourced: 2, total: 3 }), json(m.grounding));
  ok('what is not confirmed is kept to be said', json(m.caution) === json(['020 7946 0555']));
  ok('what the sources were matched on is not kept', m.sources.every((s) => !('text' in s)));
  ok('it is still plain data', json(JSON.parse(json(m))) === json(m));
}

console.log('\nA source cited twice keeps its number:');
{
  const t = V.start(ASK, 0);
  V.toolCall(t, 'wikipedia', { query: 'Larkfield Lighthouse' }); V.toolResult(t, 'wikipedia', WIKI);
  V.toolCall(t, 'fetch_url', { url: PAGE.url }); V.toolResult(t, 'fetch_url', PAGE);
  V.finish(t, 'Larkfield Lighthouse was first lit in 1874. It was built by the harbour board, on the headland. The gallery is open to visitors on summer weekends.', { ended: 1 });
  ok('two sentences from the first source, one from the second: 1, 1, 2', json(t.chips.map((c) => c.n)) === '[1,1,2]', json(t.chips));
}

console.log('\nAn answer from what it knows, with nothing read:');
{
  const k = V.start('What is a tide?', 0);
  V.writing(k);
  V.finish(k, 'A tide is the rise and fall of the sea, caused mostly by the Moon.', { ended: 1500 });
  ok('no chips, no grounding, no glance: nothing was read to hold it to', k.chips.length === 0 && k.grounding === null && k.glance.length === 0);
  ok('the line says it was answered, and no more', said(k) === 'Answered');
  const fenced = V.start(ASK, 0); V.toolCall(fenced, 'wikipedia', {}); V.toolResult(fenced, 'wikipedia', WIKI);
  V.finish(fenced, 'Here:\n```\nIt was first lit in 1874 and built by the harbour board.\n```', { ended: 1 });
  ok('words inside a code block are not given a chip', fenced.chips.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/view-model.js)`);
process.exit(fail ? 1 : 0);
