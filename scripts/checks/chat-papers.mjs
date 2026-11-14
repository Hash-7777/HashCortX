// ==============================================================
// Papers as a PubMed search hands them to an agent — checks
//
// Loads the real src/js/chat/papers.js and holds how Europe PMC's answer
// becomes the papers an agent reads: the fields it is given, a link for
// each, the papers with no title or abstract left out, and the two marks
// an agent must not miss: a paper that has been retracted, and a preprint
// that has not been peer reviewed. Also pins the PubMed tool in app.js to
// the module and to what its description tells the model.
//
// Run with: npm run check:chat-papers
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
try { vm.runInContext(src('js', 'chat', 'papers.js'), sandbox, { filename: 'papers.js' }); } catch (e) { ok('papers.js loads', false, String(e && e.message)); }
const P = sandbox.HCPapers || {};
const read = (rows) => (typeof P.fromEuropePmc === 'function' ? P.fromEuropePmc({ resultList: { result: rows } }) : []);

// Invented records, in the shape Europe PMC answers in.
const base = { title: 'Tidal breathing in older adults', authorString: 'Okafor N, Lind P', journalTitle: 'J Invented Resp', pubYear: '2019', abstractText: 'A cohort of adults followed for two years.', pmid: '31234567', doi: '10.5555/tb.2019.04', source: 'MED', citedByCount: 42, pubTypeList: { pubType: ['Journal Article'] } };

console.log('\nWhat an agent is given for each paper:');
{
  const [p] = read([base]);
  ok('title, authors, journal, year, abstract, PMID, DOI, source and citations', !!p && p.title === base.title && p.authors === base.authorString && p.journal === base.journalTitle && p.year === '2019' && p.abstract === base.abstractText && p.pmid === '31234567' && p.doi === '10.5555/tb.2019.04' && p.source === 'MED' && p.citations === 42, json(p));
  ok('a link to PubMed when it has a PMID', !!p && p.url === 'https://pubmed.ncbi.nlm.nih.gov/31234567/');
  ok('...to the DOI when it has none', read([{ ...base, pmid: '' }])[0]?.url === 'https://doi.org/10.5555/tb.2019.04');
  ok('...and to Europe PMC when it has neither', read([{ ...base, pmid: '', doi: '', id: 'PPR123' , source: 'PPR' }])[0]?.url === 'https://europepmc.org/article/PPR/PPR123');
  ok('an abstract is cut to a set length', read([{ ...base, abstractText: 'x'.repeat(2000) }])[0]?.abstract.length === P.ABSTRACT);
  ok('a review is marked as one', read([{ ...base, pubTypeList: { pubType: ['Review', 'Journal Article'] } }])[0]?.isReview === true && p.isReview === false);
  ok('a paper with no title or no abstract is left out', read([{ ...base, title: '' }, { ...base, abstractText: '' }, base]).length === 1);
  ok('an answer with no results, or not the expected shape, is no papers', json(read([])) === '[]' && json(P.fromEuropePmc?.(null)) === '[]' && json(P.fromEuropePmc?.({ resultList: {} })) === '[]');
}

console.log('\nThe marks an agent must not miss:');
{
  const [r] = read([{ ...base, pubTypeList: { pubType: ['Journal Article', 'Retracted Publication'] } }]);
  ok('a retracted paper is marked retracted', r?.retracted === true, json(r));
  ok('...also when the list is a single word, as some records send it', read([{ ...base, pubTypeList: { pubType: 'Retracted Publication' } }])[0]?.retracted === true);
  ok('the notice of a retraction is not itself a retracted paper', read([{ ...base, pubTypeList: { pubType: ['Retraction of Publication'] } }])[0]?.retracted === undefined);
  ok('a preprint is marked, by its source or its type', read([{ ...base, source: 'PPR' }])[0]?.preprint === true && read([{ ...base, pubTypeList: { pubType: ['Preprint'] } }])[0]?.preprint === true);
  const [plain] = read([base]);
  ok('an ordinary paper carries neither mark, so the result stays short', plain && !('retracted' in plain) && !('preprint' in plain), json(plain));
}

console.log('\nThe PubMed tool (app.js):');
{
  const app = src('js', 'app.js');
  ok('reads its answer through the module', /return window\.HCPapers\.fromEuropePmc\(await r\.json\(\)\);/.test(app));
  const desc = (/pubmed_search: \{\s*description: "([^"]*)"/.exec(app) || [])[1] || '';
  ok('its description does not say every paper is peer reviewed', !!desc && !/^PubMed \/ Europe PMC search\. Peer-reviewed/.test(desc), desc);
  ok('...and tells the model a retracted paper is not evidence, and to say when one is a preprint', /retracted/i.test(desc) && /never cite it as evidence/i.test(desc) && /preprint/i.test(desc) && /peer review/i.test(desc), desc);
  const boot = src('boot.js');
  ok('papers.js is loaded before app.js', boot.indexOf('/js/chat/papers.js') > 0 && boot.indexOf('/js/chat/papers.js') < boot.indexOf('/js/app.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/papers.js)`);
process.exit(fail ? 1 : 0);
