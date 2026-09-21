// ==============================================================
// Photograph checks
//
// Loads the REAL src/js/swarm/photos.js with a stand-in fetch built on the
// shape Openverse answers with, so the search, the licence filter, the brief
// and the credit rule are all exercised with no network.
//
// Run with: npm run check:swarm-photos
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const memory = new Map();
const sandbox = {
  window: {}, setTimeout, clearTimeout, AbortController, encodeURIComponent,
  localStorage: { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)) },
};
vm.createContext(sandbox);
vm.runInContext(src('js', 'swarm', 'photos.js'), sandbox, { filename: 'photos.js' });
vm.runInContext(src('js', 'swarm', 'project-check.js'), sandbox, { filename: 'project-check.js' });
const P = sandbox.window.HCSwarmPhotos;
const C = sandbox.window.HCSwarmProjectCheck;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const result = (over) => ({
  url: 'https://live.staticflickr.com/8097/8476801743_393abb9f2d_b.jpg', title: 'Diamond Ring', creator: 'Jeffrey Beall',
  license: 'by-sa', license_version: '2.0', width: 1024, height: 750, foreign_landing_url: 'https://www.flickr.com/photos/x/1', ...over,
});
const asked = [];
const fakeFetch = (answers) => async (url) => {
  asked.push(url);
  const q = new URL(url).searchParams.get('q');
  return { ok: true, json: async () => ({ results: answers[q] || [] }) };
};

console.log('What is searched for:');
ok('a plain search is kept, in lower case', P.searchesOf(['Diamond Engagement Ring'])[0] === 'diamond engagement ring');
ok('punctuation and anything like code is taken out', P.searchesOf(['rings <script>'])[0] === 'rings script');
ok('a sentence is not a search', P.searchesOf(['a very long sentence about the whole business and its plans']).length === 0);
ok('at most three searches, no repeats', P.searchesOf(['a ring', 'a ring', 'b ring', 'c ring', 'd ring']).join('|') === 'a ring|b ring|c ring');
ok('nothing to search is nothing', P.searchesOf(undefined).length === 0);

console.log('\nWhat comes back, and what is used:');
{
  const found = await P.find({
    searches: ['diamond ring', 'jewelry store'],
    fetch: fakeFetch({
      'diamond ring': [
        result(),
        result({ url: 'https://live.staticflickr.com/1/2_b.jpg', title: 'Diamond Ring' }),                 // same title
        result({ url: 'https://live.staticflickr.com/3/4_b.jpg', title: 'Ring in a box', license: 'by-nd' }),  // no derivatives
        result({ url: 'https://live.staticflickr.com/5/6_b.jpg', title: 'Ring, sold', license: 'by-nc' }),     // non-commercial
        result({ url: 'http://insecure.example/a.jpg', title: 'Insecure' }),
        result({ url: 'https://live.staticflickr.com/7/8_t.jpg', title: 'Tiny', width: 100, height: 75 }),
        result({ url: 'https://live.staticflickr.com/9/9_b.jpg', title: 'Public ring', license: 'cc0', license_version: '1.0' }),
        result({ url: 'https://live.staticflickr.com/13/14_b.jpg', title: "Clements & Holmes Ltd. - 'Diamond engagement ring catalogue'", license: 'by' }),
      ],
      'jewelry store': [result({ url: 'https://live.staticflickr.com/11/12_b.jpg', title: 'Shop window', license: 'by', width: 700, height: 1000 })],
    }),
  });
  const titles = found.photos.map((p) => p.title);
  ok('only licences a business may use: no "no derivatives", no "non-commercial"', !titles.includes('Ring in a box') && !titles.includes('Ring, sold'));
  ok('only https image addresses, and nothing too small to show', !titles.includes('Insecure') && !titles.includes('Tiny'));
  ok('one photograph per title', titles.filter((t) => t === 'Diamond Ring').length === 1);
  ok('a scanned catalogue page is not a photograph of the subject', !titles.some((t) => /catalogue/.test(t)));
  ok('every search is asked, in order', found.searched.join('|') === 'diamond ring|jewelry store' && titles.includes('Shop window'));
  ok('the request asks only for the licences allowed, and for nothing mature', /license=cc0%2Cpdm%2Cby%2Cby-sa|license=cc0,pdm,by,by-sa/.test(asked[0]) && /mature=false/.test(asked[0]));
  ok('the licence is named as a person reads it', found.photos[0].licence === 'CC BY-SA 2.0' && found.photos.find((p) => p.title === 'Public ring').licence === 'CC0');
  ok('the shape is known, so a portrait is not put in a wide slot', found.photos.find((p) => p.title === 'Shop window').shape === 'portrait');
}
{
  const down = await P.find({ searches: ['diamond ring'], fetch: async () => { throw new Error('offline'); } });
  ok('a search that fails leaves no photographs, and no error', down.photos.length === 0 && down.searched.length === 1);
  const refused = await P.find({ searches: ['diamond ring'], fetch: async () => ({ ok: false }) });
  ok('a refusal leaves none either', refused.photos.length === 0);
}

console.log('\nWhat the team is told:');
{
  const photos = [P.photoOf(result())];
  const brief = P.briefOf(photos);
  ok('the exact address is given', brief.includes('https://live.staticflickr.com/8097/8476801743_393abb9f2d_b.jpg'));
  ok('... with the credit its licence asks for', brief.includes('"Diamond Ring" by Jeffrey Beall (CC BY-SA 2.0)') && /must be credited where a visitor can read it/.test(brief));
  ok('no other image address may be written', /never write any other image address/.test(brief));
  const none = P.briefOf([]);
  ok('without photographs the team draws, and writes no image address at all', /Do not write any image address at all/.test(none) && /inline SVG/.test(none));
}

console.log('\nA photograph shown without its credit is found:');
{
  const photos = [P.photoOf(result())];
  const page = (footer) => new Map([['index.html', { content: `<!doctype html><img src="https://live.staticflickr.com/8097/8476801743_393abb9f2d_b.jpg" alt="ring"><footer>${footer}</footer>` }]]);
  ok('uncredited', P.uncredited(page('© Luis Diamond'), photos).length === 1);
  ok('credited', P.uncredited(page('Photo: "Diamond Ring" by Jeffrey Beall, CC BY-SA 2.0'), photos).length === 0);
  ok('a photograph not used needs no credit', P.uncredited(new Map([['index.html', { content: '<p>no images</p>' }]]), photos).length === 0);
  sandbox.window.HCSwarmPhotos = P;
  const found = C.inspect(page('© Luis Diamond'), { photos });
  ok('the site check names it as broken, so it is sent to be put right', found.some((f) => f.level === 'broken' && /without crediting it/.test(f.what)));
}

console.log('\nThe setting:');
{
  ok('on unless turned off', P.allowed({ getElementById: () => null }) === true);
  memory.set(P.PREF_KEY, 'off');
  ok('off when turned off', P.allowed({ getElementById: () => null }) === false);
  memory.set(P.PREF_KEY, 'on');
  ok('off whenever "Local only" is on', P.allowed({ getElementById: (id) => (id === 'privacyLocal' ? { checked: true } : null) }) === false);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/photos.js)`);
process.exit(fail ? 1 : 0);
