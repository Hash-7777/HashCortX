// ==============================================================
// What a chat agent's answer is held to before it is shown — checks
//
// Loads the real src/js/chat/finish.js with the modules it reads (the
// request's asks, the run's ledger test of an answered ask, the check of a
// search the answer says it made, the details nothing read says) and holds
// the three finishing checks a chat agent's run gets on the shared loop:
// every part of a request of several asks covered; no search said to have
// happened that did not; no address, number or hours that nothing the
// person gave or the agent read says. Each sends the answer back once, and
// what is still unconfirmed is said under it in the chat's own words.
//
// Run with: npm run check:chat-finish
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
for (const f of ['fences.js', 'code/asks.js', 'code/verify.js', 'code/facts.js']) vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
try { vm.runInContext(src('js', 'chat', 'finish.js'), sandbox, { filename: 'finish.js' }); } catch (e) { ok('finish.js loads', false, String(e && e.message)); }
const F = sandbox.HCChatFinish || {};

const sent = () => ({ asks: 0, claim: 0, facts: 0 });
const ask = (q) => [{ role: 'system', content: 'You are a research agent.' }, { role: 'user', content: q }];
const searched = (q, result) => [...ask(q), { role: 'assistant', content: '', tool_calls: [{ id: 's1', name: 'web_search', arguments: { query: 'x' } }] }, { role: 'tool', tool_call_id: 's1', name: 'web_search', content: result }];
const first = async (checks, reply) => { for (const c of checks.finish) { const back = await c.run(reply); if (back) return back; } return null; };

console.log('The checks a chat answer gets, in order:');
{
  const c = typeof F.checks === 'function' ? F.checks({ messages: ask('x'), sent: sent(), request: 'x' }) : { finish: [] };
  ok('the asks of the request, a search it says it made, and details nothing read says, in that order, each on an answer in words', json(c.finish.map((x) => x.id)) === '["asks","claim","facts"]' && c.finish.every((x) => x.words === true), json(c.finish.map((x) => x.id)));
  ok('nothing about files, tests, plans or sites: a chat answer changes none', !c.finish.some((x) => /prove|site|plan|kept|second|named|example/.test(x.id)));
  ok('the shared loop\'s other two hooks are there', typeof c.left === 'function' && typeof c.wrap === 'function');
}

console.log('\nEvery part of a request of several asks:');
await (async () => {
  if (typeof F.checks !== 'function') return;
  const request = 'When was the harbour museum founded? Which architect designed the building? What does a family ticket cost?';
  const s = sent();
  const c = F.checks({ messages: ask(request), sent: s, request });
  const back = await first(c, 'The harbour museum was founded in 1921 and is popular with families.');
  ok('an answer that leaves parts out is sent back, each part restated', !!back && back.kind === 'asks' && /architect/.test(back.message) && /ticket/.test(back.message) && /^Note from HashCortX, not from the person:/.test(back.message), back && back.message);
  ok('...the part it covered is not asked again', back && !/founded/.test(back.message.split('\n').slice(1).join('\n')), back && back.message);
  s.asks = 1;
  ok('...once only', (await c.finish[0].run('The museum was founded in 1921.')) === null);
  const c2 = F.checks({ messages: ask(request), sent: sent(), request });
  ok('an answer covering every part is not sent back for it', (await c2.finish[0].run('The harbour museum was founded in 1921; the architect who designed the building was Ada Vale; a family ticket costs twelve pounds.')) === null);
  ok('an answer that asks the person something is not sent back', (await F.checks({ messages: ask(request), sent: sent(), request }).finish[0].run('Which museum do you mean, the old harbour one or the new one?')) === null);
  ok('questions run together in one sentence are not split: the same rule as HashCoder\'s checklist', (await F.checks({ messages: ask('x'), sent: sent(), request: 'When was it founded, who designed it, and what does a ticket cost?' }).finish[0].run('It is old.')) === null);
  ok('a request of one or two asks is not gone through part by part', (await F.checks({ messages: ask('What year was it founded?'), sent: sent(), request: 'What year was it founded?' }).finish[0].run('It is a museum.')) === null);
})();

{
  const c = (r, a) => (typeof F.covers === 'function' ? F.covers(r, a) : 'missing');
  ok('an ask is covered by its words in the answer, in any form', c('A family ticket costs twelve pounds.', 'What does a family ticket cost?') === true && c('Ada Vale designed the building.', 'Which architect designed the building?') === true);
  ok('...not by a word or two of a longer ask', c('The building is old.', 'Which architect designed the harbour building?') === false);
  ok('...and a short ask needs every one of its words', c('The ticket is cheap.', 'What does a family ticket cost?') === false);
}
console.log('\nA search it says it made:');
await (async () => {
  if (typeof F.checks !== 'function') return;
  const s = sent();
  const c = F.checks({ messages: ask('When does the bakery open?'), sent: s, request: 'When does the bakery open?' });
  const back = await c.finish[1].run('I searched online and it opens at seven.');
  ok('an answer saying it searched, when nothing was searched, is sent back', !!back && back.kind === 'claim', back && back.message);
  const fine = F.checks({ messages: searched('When does the bakery open?', 'Opens 07:00.'), sent: sent(), request: 'When does the bakery open?' });
  ok('...not when a search ran', (await fine.finish[1].run('I searched online and it opens at seven.')) === null);
})();

console.log('\nDetails nothing given or read says:');
await (async () => {
  if (typeof F.checks !== 'function') return;
  const s = sent();
  const msgs = searched('How do I reach the bakery?', 'Rosewood Bakery, open daily.');
  const c = F.checks({ messages: msgs, sent: s, request: 'How do I reach the bakery?' });
  const reply = 'Call Rosewood Bakery on 020 7946 0321 or email hello@rosewood-bakery.example.';
  const back = await c.finish[2].run(reply);
  ok('a phone number and an email no source gives are sent back once, named', !!back && back.kind === 'facts' && /020 7946 0321/.test(back.message) && /hello@rosewood-bakery\.example/.test(back.message), back && back.message);
  ok('...and are said under the answer, in the chat\'s words', typeof F.leftLine === 'function' && /^Not confirmed by anything you gave or the agent read: /.test(F.leftLine(c.left().found)) && !/goes live|page/.test(F.leftLine(c.left().found)), typeof F.leftLine === 'function' ? F.leftLine(c.left().found) : '');
  s.facts = 1;
  ok('...sent back once only', (await c.finish[2].run(reply)) === null);
  const sourced = F.checks({ messages: searched('How do I reach the bakery?', 'Rosewood Bakery. Phone 020 7946 0321. hello@rosewood-bakery.example'), sent: sent(), request: 'x' });
  ok('a detail a source gives is not held against it', (await sourced.finish[2].run(reply)) === null && F.leftLine(sourced.left().found) === '');
  const plain = F.checks({ messages: ask('Explain recursion.'), sent: sent(), request: 'Explain recursion.' });
  ok('an answer with no such details is left alone, and a markdown link is not taken for unfinished text', (await plain.finish[2].run('Recursion is when a function calls itself. See [the guide](https://docs.example/recursion).')) === null && F.leftLine(plain.left().found) === '');
  ok('the loop\'s own line for a page is not used: the chat says its own', plain.left().unconfirmed === null);
})();

console.log('\nA paper it cites that nothing found:');
await (async () => {
  if (typeof F.checks !== 'function') return;
  const paper = JSON.stringify({ papers: [{ title: 'Tidal breathing in older adults', authors: 'Okafor N, Lind P', year: '2019', pmid: '31234567', doi: '10.5555/tb.2019.04', abstract: 'A cohort of adults.' }] });
  const papers = (q) => [...ask(q), { role: 'assistant', content: '', tool_calls: [{ id: 'p1', function: { name: 'pubmed_search', arguments: '{"query":"tidal breathing"}' } }] }, { role: 'tool', tool_call_id: 'p1', name: 'pubmed_search', content: paper }];
  const ids = (t) => (typeof F.citesIn === 'function' ? F.citesIn(t).map((x) => x.shown) : null);
  ok('the ways a paper is named are read: PMID, a PubMed link, DOI, a DOI link, PMC and arXiv', json(ids('PMID: 31234567; https://pubmed.ncbi.nlm.nih.gov/33445566/ doi 10.5555/tb.2019.04. https://doi.org/10.5555/ZZ.2020.11, PMC7654321, arXiv:2101.01234v2')) === json(['PMID 31234567', 'PMID 33445566', 'DOI 10.5555/tb.2019.04', 'DOI 10.5555/zz.2020.11', 'PMC7654321', 'arXiv 2101.01234']), json(ids('PMID: 31234567; https://pubmed.ncbi.nlm.nih.gov/33445566/ doi 10.5555/tb.2019.04. https://doi.org/10.5555/ZZ.2020.11, PMC7654321, arXiv:2101.01234v2')));
  ok('...each once, and none in a plain number, a year or a version', json(ids('PMID 31234567 and again PMID 31234567')) === json(['PMID 31234567']) && json(ids('In 2019, 310 adults; version 10.5 of the tool.')) === json([]));
  ok('...nor in a code block', json(ids('```\nconst doi = "10.5555/x.1";\n```')) === json([]));
  const c = F.checks({ messages: papers('Find papers on tidal breathing'), sent: sent(), request: 'Find papers on tidal breathing' });
  ok('a paper the search returned, by PMID or DOI, is not held against it', (await c.finish[2].run('Okafor and Lind followed adults (Okafor, 2019, PMID 31234567; doi:10.5555/TB.2019.04).')) === null);
  const back = await c.finish[2].run('Okafor (2019, PMID 31234567) agrees with Varga (2021, PMID 33445566, doi 10.5555/zz.2020.11).');
  ok('a PMID and a DOI nothing found are sent back once, named, and the one found is not', !!back && back.kind === 'facts' && /PMID 33445566/.test(back.message) && /DOI 10\.5555\/zz\.2020\.11/.test(back.message) && !/31234567/.test(back.message), back && back.message);
  ok('...and are said under the answer', /PMID 33445566/.test(F.leftLine(c.left().found)));
  const withNote = papers('Find papers on tidal breathing');
  withNote.push({ role: 'assistant', content: 'Varga (PMID 33445566).' }, { role: 'user', content: back ? back.message : '', note: true });
  const again = F.checks({ messages: withNote, sent: sent(), request: 'x' });
  ok('the app\'s own note naming it, and the answer that made it up, are not where it was found', !!(await again.finish[2].run('Varga (PMID 33445566).')));
  const longer = F.checks({ messages: searched('x', 'PMID 133445566, PMID 334455667 and PMC 76543210'), sent: sent(), request: 'x' });
  ok('a number found only inside a longer one, either end, is not found', !!(await longer.finish[2].run('See PMID 33445566 and PMC7654321.')) && json(longer.left().found.unsourced.map((u) => u.shown)) === json(['PMID 33445566', 'PMC7654321']), json(longer.left().found));
  ok('a DOI closed by a bracket keeps its own brackets', json(ids('(see doi 10.5555/ab(12)cd.3).')) === json(['DOI 10.5555/ab(12)cd.3']) && json(ids('(doi 10.5555/ab(12))')) === json(['DOI 10.5555/ab(12)']) && json(ids('[https://arxiv.org/abs/2101.01234]')) === json(['arXiv 2101.01234']));
  const given = F.checks({ messages: ask('Summarise PMID 33445566 for me'), sent: sent(), request: 'x' });
  ok('one the person gave is theirs to cite', (await given.finish[2].run('PMID 33445566 reports a cohort study.')) === null);
  const read = F.checks({ messages: searched('Is there a trial?', 'The trial is described at https://doi.org/10.5555/zz.2020.11 in full.'), sent: sent(), request: 'x' });
  ok('one a page or a search the agent read gives is found there', (await read.finish[2].run('Yes: doi 10.5555/zz.2020.11.')) === null);
  const mixed = F.checks({ messages: papers('x'), sent: sent(), request: 'x' });
  const both = await mixed.finish[2].run('Call 020 7946 0321. See PMID 33445566.');
  ok('with a detail of another kind, both are named in one note', !!both && /020 7946 0321/.test(both.message) && /PMID 33445566/.test(both.message), both && both.message);
})();

ok('it is part of npm run check', /npm run check:chat-finish\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/finish.js)`);
process.exit(fail ? 1 : 0);
