// ============================================================
// Details a page states as fact that nothing was given or read to say —
// src/js/code/facts.js, its note in js/code/verify.js, and where the Coder
// uses them.
//
// A page for a shop, written by a model that could not open the shop's own
// page, states an address, a year and opening hours of its own and leaves
// some lines in square brackets. These checks run the real rules against an
// invented page of that kind, and against the same page corrected from the
// shop's invented details. Every name, number and address here is made up.
//
// Run with: npm run check:code-facts
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

function load(factsSource) {
  const box = { window: {}, JSON, Math, Number, String, Array, Object, Map, Set, RegExp, Error, Date, parseInt };
  vm.createContext(box);
  vm.runInContext(src('js', 'code', 'verify.js'), box, { filename: 'verify.js' });
  vm.runInContext(factsSource, box, { filename: 'facts.js' });
  return box.window;
}
const original = src('js', 'code', 'facts.js');
const W = load(original);
const F = W.HCCodeFacts;
const V = W.HCCodeVerify;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

// The page the run wrote (the parts that matter), and what the shop's own page said.
const PAGE = `<!doctype html><html><head><title>Maple Finch | Fine Jewellery</title>
<meta name="description" content="Fine jewellery since 1988. Visit our shop at 9 Orchard Road, Easton.">
<style>.a { padding: 0 4px 30px 12px; margin: 0 0 24px 2000px }</style><script>const delay = [200, 400, 800]; const n = 20100000000;</script></head>
<body><!-- 9 Orchard Road, in a comment -->
<span>Private Appointments &amp; Inquiries: 9 Orchard Road, Easton</span>
<p>For over three decades, our jewellers have shaped rare gems.</p>
<div>Heritage: Fine Jewellery Since 1988</div>
<div>Boutique Hours: [11:00 AM – 10:00 PM Daily]</div>
<div>Contact / Concierge: [Boutique Telephone: Contact directly at 9 Orchard Road]</div>
<label>Phone <input type="tel" placeholder="e.g. +20 100 000 0000"></label>
<label>Choose a time <span>Afternoon (1:00 PM – 4:00 PM)</span></label>
<a href="https://www.instagram.com/maplefinchjewellers">Instagram</a>
<svg viewBox="0 0 24 24"><path d="M6 2 18 2 22 8 12 22 2 8 0 0 0 0"/></svg>
<p>&copy; 2026 Maple Finch.</p></body></html>`;
const SOURCE = [
  { role: 'user', content: 'make a website for a jewellery shop called maple finch' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'a1', name: 'web_search', arguments: { query: 'maple finch jewellers easton' } }] },
  { role: 'tool', tool_call_id: 'a1', name: 'web_search', content: 'Maple Finch Jewellers. Family jewellers since 1957. 14 Orchard Road, Easton. 020 7946 0958. instagram.com/maplefinchjewellers' },
];
const NOTHING = [{ role: 'user', content: 'make a website for a jewellery shop called maple finch' }];
const found = (messages, text = PAGE, path = '/p/index.html') => F.check({ files: [{ path, text }], messages });
const said = (r) => r.unsourced.map((i) => `${i.kind}:${i.shown}`);

console.log('What a visitor reads of a page:');
{
  const v = F.visibleText('/p/index.html', PAGE);
  ok('its text, its title, its description', /Private Appointments & Inquiries/.test(v) && /Maple Finch \| Fine Jewellery/.test(v) && /since 1988/.test(v));
  ok('not its comments, scripts, styles or drawings', !/in a comment/.test(v) && !/20100000000/.test(v) && !/padding/.test(v) && !/M6 2 18/.test(v));
  ok('not the grey example inside an empty field', !/100 000 0000/.test(v));
  ok('a phone link, a mail link, a link to another site', /tel:\+442079460958/.test(F.visibleText('/p/a.html', '<a href="tel:+442079460958">Call</a>')) && /mailto:shop@maplefinch\.test/.test(F.visibleText('/p/a.html', "<a href='mailto:shop@maplefinch.test'>x</a>")) && /instagram\.com\/x1y/.test(F.visibleText('/p/a.html', '<a href="https://instagram.com/x1y">x</a>')));
  ok('structured data for search engines', /"telephone": "\+44 20 7946 0958"/.test(F.visibleText('/p/a.html', '<script type="application/ld+json">{"telephone": "+44 20 7946 0958"}</script><script>var x = 1</script>')));
  ok('entities are read as the characters they stand for', /Q&A – “x”/.test(F.visibleText('/p/a.html', '<p>Q&amp;A &ndash; &#8220;x&#8221;</p>')) && F.visibleText('/p/a.html', '<p>a&nbsp;b &#xZZ; &bogus;</p>').includes('&bogus;'));
  ok('a text file is read as it is', F.visibleText('/p/README.md', 'call 020 7946 0958') === 'call 020 7946 0958');
  ok('nothing is a problem', F.visibleText('/p/a.html', null) === '' && F.visibleText('/p/a.html', undefined) === '');
}

console.log('\nWhat is a detail that can be checked:');
{
  const kinds = (t) => F.specifics(t).map((s) => s.kind);
  const one = (t, kind) => F.specifics(t).filter((s) => s.kind === kind);
  ok('a phone number, written either way', one('Call 020 7946 0958 now', 'phone').length === 1 && one('+44 20 7946 0958', 'phone').length === 1 && one('Tel: (02) 2418 3344', 'phone').length === 1 && one('call 0100-253-8467', 'phone').length === 1);
  ok('the same number written twice is one', one('020 7946 0958 or +44 20 7946 0958', 'phone').length === 1);
  ok('not a date, a run of years, a price or a measure', kinds('on 2026-10-02 in 2024 2025 2026 2027, EGP 1,250,000, 20100000000 and 3.14159265 and 100.50.200.300').filter((k) => k === 'phone').length === 0);
  ok('not an example number', kinds('+20 100 000 0000, 555-0100, 000 0000 000, 1111111111, 0123456789').filter((k) => k === 'phone').length === 0);
  ok('an address with a number and a street', one('Visit 9 Orchard Road, Easton', 'address').length === 1 && one('221B Baker Street', 'address').length === 1 && one('14 Nile Corniche Road', 'address').length === 1 && one('3 El Tahrir Square', 'address').length === 1);
  ok('and one in Arabic', one('٦ شارع النيل', 'address').length === 1 && one('6 شارع النيل، القاهرة', 'address').length === 1);
  ok('not an example street', one('123 Main Street', 'address').length === 0 && one('1234 Example Road', 'address').length === 0 && one('1 Your Street', 'address').length === 0);
  ok('not a sentence that happens to hold a number and a word', one('We have 3 Great rings on Street view', 'address').length === 0 && one('about 5 minutes from the Road', 'address').length === 0);
  ok('a year it began, with the word that says so', one('Since 1988', 'year').length === 1 && one('Est. 1969', 'year').length === 1 && one('Established in 1975', 'year').length === 1 && one('founded 2012', 'year').length === 1);
  ok('not a year with nothing saying it is when it began', one('Photo taken in 1988, copyright 2026', 'year').length === 0);
  ok('how long it has been open', one('For over three decades, we', 'years').length === 1 && one('more than 50 years', 'years').length === 1 && one('25 years of experience', 'years').length === 1 && one('nearly 4 generations', 'years').length === 1);
  ok('opening hours, where a word says they are', one('Boutique Hours: 11:00 AM – 10:00 PM Daily', 'hours').length === 1 && one('Open Sat-Thu 10am to 9pm', 'hours').length === 1 && one('Opening hours 09:00 - 17:00', 'hours').length === 1);
  ok('not a time range that is something else', one('Choose a slot: 1:00 PM – 4:00 PM', 'hours').length === 0 && one('The film runs 10:00 - 12:30', 'hours').length === 0);
  ok('an email, and not the name of an image or an example', one('write to shop@maplefinch.test', 'email').length === 1 && one('logo@2x.png', 'email').length === 0 && one('you@example.com', 'email').length === 0 && one('name@yourdomain.com', 'email').length === 0 && one('a@b.svg', 'email').length === 0);
  ok('a link to an account on a social network', one('https://www.instagram.com/maplefinchjewellers', 'link').length === 1 && one('https://facebook.com/maplefinch', 'link').length === 1 && one('https://wa.me/442079460958', 'link').length === 1 && one('https://www.tiktok.com/@maple_finch', 'link').length === 1);
  ok('not a link that names no account', one('https://www.instagram.com/yourhandle', 'link').length === 0 && one('https://facebook.com/sharer/sharer.php', 'link').length === 0 && one('https://twitter.com/intent/tweet', 'link').length === 0 && one('https://instagram.com/p/xyz', 'link').length === 0);
  ok('each is reported once however often it is written', F.specifics('9 Orchard Road. 9 Orchard Road. 9 Orchard Rd.').filter((s) => s.kind === 'address').length <= 2);
  ok('nothing is a problem', F.specifics(null).length === 0 && F.specifics(undefined).length === 0 && F.specifics('').length === 0);
  const brackets = F.placeholdersIn('Hours: [11:00 AM – 10:00 PM Daily] and [Boutique Telephone: Contact directly] but [1] [x] [ ] [link text](https://a.b) Lorem ipsum dolor, [A-Z]');
  ok('square brackets that show as text', brackets.join('|') === '[11:00 AM – 10:00 PM Daily]|[Boutique Telephone: Contact directly]|Lorem ipsum', brackets.join('|'));
  ok('not a link, a tick box or a number', !brackets.some((b) => /link text|\[x\]|\[ \]|\[1\]/.test(b)));
  ok('and a template\'s name for the business', F.placeholdersIn('Welcome to Your Business Name').length === 1 && F.placeholdersIn('call XXX-XXX-XXXX').length === 1);
}

console.log('\nWhat counts as something the run was told or read:');
{
  const check = (messages, text) => F.check({ files: [{ path: '/p/a.html', text }], messages });
  const addr = '<p>14 Orchard Road, Easton</p>';
  ok('the person\'s own words', check([{ role: 'user', content: 'the shop is at 14 Orchard Road, Easton' }], addr).total === 0);
  ok('a page or a search the agent opened', check(SOURCE, addr).total === 0 && check([{ role: 'assistant', tool_calls: [{ id: 'f', name: 'fetch_url', arguments: {} }] }, { role: 'tool', tool_call_id: 'f', name: 'fetch_url', content: 'Visit us: 14 Orchard Rd., Easton' }], addr).total === 0);
  ok('a note it was asked to recall, and a connected system', check([{ role: 'tool', name: 'recall_facts', content: 'shop: 14 Orchard Road' }], addr).total === 0 && check([{ role: 'tool', name: 'crm__lookup', content: '14 Orchard Road' }], addr).total === 0);
  ok('a file of the project it had not written', check([{ role: 'assistant', tool_calls: [{ id: 'r', name: 'read_file', arguments: { path: '/p/about.txt' } }] }, { role: 'tool', tool_call_id: 'r', name: 'read_file', content: 'Address: 14 Orchard Road' }], addr).total === 0);
  ok('the street written the other way round, or shortened', check([{ role: 'user', content: 'Orchard Rd, no. 14, Easton' }], addr).total === 0 && check([{ role: 'user', content: '14, Orchard Road' }], addr).total === 0);
  ok('but not the same street with another number', check([{ role: 'user', content: 'Orchard Road, Easton, building 14' }], '<p>9 Orchard Road</p>').total === 1 && check(SOURCE, '<p>9 Orchard Road</p>').total === 1);
  ok('not its own words: what it said is not a source', check([{ role: 'user', content: 'a site for a shop' }, { role: 'assistant', content: 'It is at 14 Orchard Road' }], addr).total === 1);
  ok('not a note the app wrote', check([{ role: 'user', content: 'a site for a shop' }, { role: 'user', note: true, content: 'it is at 14 Orchard Road' }], addr).total === 1);
  const laundered = [
    { role: 'user', content: 'a site for a shop' },
    { role: 'assistant', tool_calls: [{ id: 'w', name: 'write_file', arguments: { path: '/p/index.html', content: addr } }] },
    { role: 'tool', tool_call_id: 'w', name: 'write_file', content: '{"ok":true}' },
    { role: 'assistant', tool_calls: [{ id: 'r', name: 'read_file', arguments: { path: '/p/index.html' } }] },
    { role: 'tool', tool_call_id: 'r', name: 'read_file', content: addr },
  ];
  ok('not a file it wrote, read back: a made-up detail is not confirmed by being read', check(laundered, addr).total === 1);
  ok('not one it wrote in an earlier run of the same conversation, which the history holds', check(laundered.concat([{ role: 'user', content: 'now change the colours' }]), addr).total === 1);
  const moved = [{ role: 'assistant', tool_calls: [{ id: 'm', name: 'move_file', arguments: { from: '/p/old.txt', to: '/p/about.txt' } }] }, { role: 'tool', tool_call_id: 'm', name: 'move_file', content: 'ok' },
    { role: 'assistant', tool_calls: [{ id: 'r', name: 'read_file', arguments: { path: '/p/about.txt' } }] }, { role: 'tool', tool_call_id: 'r', name: 'read_file', content: '14 Orchard Road' }];
  ok('nor one it moved into place', check(moved, addr).total === 1);
  ok('a tool call in the other common shape is read too', check([{ role: 'assistant', tool_calls: [{ id: 'w', function: { name: 'write_file', arguments: '{"path":"/p/index.html"}' } }] }, { role: 'assistant', tool_calls: [{ id: 'r', function: { name: 'read_file', arguments: '{"path":"/p/index.html"}' } }] }, { role: 'tool', tool_call_id: 'r', content: addr }], addr).total === 1);
  ok('with a picture attached, a detail is not held against it for want of a source', check([{ role: 'user', content: 'see this', images: ['abc'] }], addr).total === 0);
  ok('but the brackets still are', check([{ role: 'user', content: 'see this', images: ['abc'] }], '<p>[Boutique Telephone]</p>').placeholders.length === 1);
  ok('and no conversation is a conversation with no source', check(undefined, addr).total === 1 && check([], addr).total === 1 && check(null, addr).total === 1);
}

console.log('\nThe page the run wrote for the shop:');
{
  const r = found(NOTHING);
  const s = said(r).join(' | ');
  ok('with nothing found, the made-up address, year and length of time are reported', /address:9 Orchard Road/.test(s) && /year:Since 1988/.test(s) && /years:For over three decades/.test(s), s);
  ok('and the opening hours it made up', /hours:11:00 AM – 10:00 PM/.test(s), s);
  ok('and the account it linked to that nothing says exists', /link:https:\/\/www\.instagram\.com\/maplefinchjewellers/.test(s), s);
  ok('and the lines of brackets a visitor would read', r.placeholders.length === 2 && /Daily\]/.test(r.placeholders[0].shown) && /Telephone/.test(r.placeholders[1].shown), JSON.stringify(r.placeholders));
  ok('not the example in the empty field, the time-of-day choice, the script or the drawing', !/100 000|1:00 PM|20100000000|M6 2/.test(s), s);
  const withSearch = found(SOURCE);
  ok('with the shop\'s own details found, the account is confirmed and the made-up details still are not', !/link:/.test(said(withSearch).join()) && /address:9 Orchard/.test(said(withSearch).join()) && /year:Since 1988/.test(said(withSearch).join()));
  const right = PAGE.replace(/9 Orchard/g, '14 Orchard').replace(/1988/g, '1957').replace('For over three decades', 'Since 1957').replace(/\[11:00 AM – 10:00 PM Daily\]/, '').replace(/\[Boutique Telephone: Contact directly at 14 Orchard Road\]/, '<a href="tel:+442079460958">020 7946 0958</a>');
  const clean = found(SOURCE, right);
  ok('the same page written from the details found has nothing to report', clean.total === 0, JSON.stringify([said(clean), clean.placeholders]));
  ok('a page that is only styles or scripts is not read', F.worth(['/p/a.css', '/p/b.js', '/p/c.json', '/p/d.py']).length === 0 && F.worth(['/p/a.html', '/p/b.md', '/p/c.txt', '/p/d.jsx']).length === 4);
  ok('at most eight files', F.worth(Array.from({ length: 20 }, (_, i) => `/p/${i}.html`)).length === 8);
  ok('the same detail in two files is told once', F.check({ files: [{ path: '/p/a.html', text: '<p>14 Orchard Road</p>' }, { path: '/p/b.html', text: '<p>14 Orchard Road</p>' }], messages: NOTHING }).unsourced.length === 1);
  ok('a file that is not text, or not a page, is passed over', F.check({ files: [{ path: '/p/a.png', text: '14 Orchard Road' }, { path: '/p/b.html', text: null }, null, undefined], messages: NOTHING }).total === 0);
}

console.log('\nThe pages as they are now:');
{
  const asked = [];
  const disk = { '/p/index.html': '<p>a</p>', '/p/sub/b.md': 'b', '/p/gone.html': null };
  const read = async (f) => { asked.push(f); if (disk[f] === undefined || disk[f] === null) throw new Error('not there'); return disk[f]; };
  const got = await F.gather(['/p/index.html', 'sub/b.md', '/p/style.css', '/p/gone.html', '/p/app.js'], '/p/', read);
  ok('each page the run changed, by its full place, and nothing else', got.map((f) => f.path).join() === '/p/index.html,/p/sub/b.md' && asked.join() === '/p/index.html,/p/sub/b.md,/p/gone.html', asked.join());
  ok('with the text as it was read', got[0].text === '<p>a</p>' && got[1].text === 'b');
  ok('a Windows project\'s full path is kept as it is', (await F.gather(['C:\\p\\a.html'], 'C:\\p', async (f) => `read ${f}`))[0].path === 'C:\\p\\a.html');
  ok('a file that cannot be read, or reads as something else, is left out', (await F.gather(['/p/a.html'], '/p', async () => ({ not: 'text' }))).length === 0 && (await F.gather(['/p/a.html'], '/p', () => { throw new Error('x'); })).length === 0);
  ok('no run, no files', (await F.gather(undefined, '/p', read)).length === 0 && (await F.gather([], '/p', read)).length === 0);
}

console.log('\nWhat the agent and the person are told:');
{
  const r = found(NOTHING);
  const note = V.factsNote(r, '/p');
  ok('a note, of its own kind, with a step the reply shows', note && note.kind === 'facts' && /confirm the details/.test(note.step));
  ok('it is the app speaking, and says what was done', V.isAppNote(note.message) && /read for details a visitor would take as fact/.test(note.message));
  ok('each detail is named with what it is and the file it is in, from the project\'s folder', /9 Orchard Road \(address, in index\.html\)/.test(note.message) && /Since 1988 \(year, in index\.html\)/.test(note.message), note.message);
  ok('the lines of brackets are named too', /\[11:00 AM – 10:00 PM Daily\] \(in index\.html\)/.test(note.message));
  ok('it says what to do: keep what a source says, search, or take it out; never leave a guess or brackets', /find that and keep it/.test(note.message) && /web_search or fetch_url/.test(note.message) && /take it out of the page/.test(note.message) && /square brackets must never be left/.test(note.message));
  ok('only what the person said in this conversation counts, and what the app remembers about them is no source for a page', /if the person gave it in this conversation/.test(note.message) && /What the app remembers about the person is not a source for a page/.test(note.message));
  ok('it asks for the name as the sources spell it, and for the answer to say what was not confirmed', /Spell the name as the sources spell it/.test(note.message) && /say in your answer which details you could not confirm/.test(note.message));
  ok('and when it comes back in a saved conversation it has the same step', V.noteStep(note.message) === note.step);
  ok('nothing found, no note', V.factsNote({ total: 0, unsourced: [], placeholders: [] }, '/p') === null && V.factsNote(null, '/p') === null);
  ok('a long list is cut', V.factsNote({ total: 12, unsourced: Array.from({ length: 12 }, (_, i) => ({ path: '/p/a.html', kind: 'phone', shown: `+20 1${i}` })), placeholders: [] }, '/p').message.split('\n').filter((l) => l.startsWith('- ')).length === 8);
  const line = F.leftLine(r);
  ok('what is left is said under the answer, as a line', /^Not confirmed from anything you gave me or I read: /.test(line) && /9 Orchard Road/.test(line) && /Check them before this goes live\./.test(line) && /Still on the page as unfinished text: \[11:00 AM/.test(line), line);
  ok('one detail is "it"', /Check it before/.test(F.leftLine({ total: 1, unsourced: [{ shown: 'x' }], placeholders: [] })));
  ok('a long list is shortened, with how many more', /and 2 more\./.test(F.leftLine({ total: 8, unsourced: Array.from({ length: 8 }, (_, i) => ({ shown: `d${i}` })), placeholders: [] }).split(' Check')[0] + '.'));
  ok('nothing left says nothing', F.leftLine({ total: 0 }) === '' && F.leftLine(null) === '');
}

console.log('\nWhere it is used:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('after the site check and before a second look, once', /\(await siteLook\(\)\) \|\| \(await factsLook\(\)\) \|\| \(await secondLook\(\)\)/.test(mode) && /found\.total && !sent\.facts \? window\.HCCodeVerify\.factsNote\(found, root\)/.test(mode));
  ok('counted by kind, like the others', /undone: 0, facts: 0/.test(mode));
  ok('the files are read as they are now, by the check that never asks, and against the whole conversation', /F\.check\(\{ files: await F\.gather\(proof\.changed, root, \(f\) => HC\.code\.readQuietly\(f\)\), messages \}\)/.test(mode));
  ok('what is left is said under the answer, with what was proven', /HCCodeFacts\?\.leftLine\(unconfirmed\)/.test(mode));
  ok('only while proving is on', /if \(!F \|\| !proof \|\| cdrPrefs\(\)\.prove === false \|\| !root\) return null;/.test(mode));
  ok('the module is loaded with the others the Coder uses, after the one whose notes it joins', src('boot.js').indexOf("'/js/code/facts.js'") > src('boot.js').indexOf("'/js/code/verify.js'") && src('boot.js').indexOf("'/js/code/verify.js'") > 0);
  ok('it does not touch the page, the network or the disk', !/\bdocument\b|fetch\(|XMLHttpRequest|invoke\(|localStorage/.test(original.replace(/\/\/.*$/gm, '')));
  ok('the check is part of npm run check', /npm run check:code-facts/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log('\nEach rule is what stops its mistake (remove it and the mistake gets through):');
{
  const without = (find, replace) => {
    if (original.split(find).length !== 2) return null;
    return load(original.replace(find, replace)).HCCodeFacts;
  };
  const proofs = [
    ['a file the agent wrote is not a source', "if (path && !wrote.has(path)) parts.push(m.content);", "if (path) parts.push(m.content);", (M) => M.check({ files: [{ path: '/p/a.html', text: '<p>14 Orchard Road</p>' }], messages: [
      { role: 'assistant', tool_calls: [{ id: 'w', name: 'write_file', arguments: { path: '/p/a.html' } }] }, { role: 'assistant', tool_calls: [{ id: 'r', name: 'read_file', arguments: { path: '/p/a.html' } }] }, { role: 'tool', tool_call_id: 'r', name: 'read_file', content: '14 Orchard Road' }] }).total === 0],
    ['what the agent said is not a source', "if (m.role === 'user' && !m.note) {", "if ((m.role === 'user' && !m.note) || m.role === 'assistant') {", (M) => M.check({ files: [{ path: '/p/a.html', text: '<p>14 Orchard Road</p>' }], messages: [{ role: 'assistant', content: 'It is at 14 Orchard Road' }] }).total === 0],
    ['a note the app wrote is not a source', "m.role === 'user' && !m.note", "m.role === 'user'", (M) => M.check({ files: [{ path: '/p/a.html', text: '<p>14 Orchard Road</p>' }], messages: [{ role: 'user', note: true, content: '14 Orchard Road' }] }).total === 0],
    ['another number is not the same address', "new RegExp(`(?:^|\\\\s)${num}(?:\\\\s|$)`).test(", "/./.test(", (M) => M.check({ files: [{ path: '/p/a.html', text: '<p>9 Orchard Road</p>' }], messages: [{ role: 'user', content: 'Orchard Road, building 14' }] }).total === 0],
    ['an example street is not a claim', "if (TEMPLATE_STREET.test(shown)) continue;", "", (M) => M.specifics('123 Main Street').length === 1],
    ['an example number is not a claim', "if (strict && (!/^(?:\\+|0|\\()/.test(raw) || /^\\d{4}-\\d{2}-\\d{2}/.test(raw) || fakeNumber(d))) continue;", "", (M) => M.specifics('+20 100 000 0000').some((s) => s.kind === 'phone')],
    ['a time that is not opening hours is not read as them', "if (!HOURS_CUE.test(t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 30))) continue;", "", (M) => M.specifics('Choose a slot: 1:00 PM – 4:00 PM').some((s) => s.kind === 'hours')],
    ['an empty field\'s example is not read', "t.replace(/<(script|style|svg)\\b[\\s\\S]*?<\\/\\1>/gi, ' ').replace(/<[^>]+>/g, ' ')", "t", (M) => /placeholder/.test(M.visibleText('/p/a.html', '<input placeholder="+20 100 000 0000">'))],
    ['a picture means a detail is not held against the run', "if (ev.pictures) continue;", "", (M) => M.check({ files: [{ path: '/p/a.html', text: '<p>14 Orchard Road</p>' }], messages: [{ role: 'user', content: 'see', images: ['x'] }] }).total === 1],
    ['a link or a tick box is not a line of brackets', "if (t[m.index + m[0].length] === '(' || !/\\p{L}{3}/u.test(m[1])) continue;", "", (M) => M.placeholdersIn('[link text](https://a.b) and [x]').length > 0],
  ];
  for (const [label, find, replace, passesWhenRemoved] of proofs) {
    const M = without(find, replace);
    ok(label, M !== null, 'the line this proof removes is not in the module any more');
    if (M) ok('  without it, the mistake gets through', passesWhenRemoved(M) === true);
  }
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/facts.js)`);
process.exit(fail ? 1 : 0);
