// ==============================================================
// Reference picking checks
//
// Loads the REAL src/js/reference-pick.js into a Node VM and puts search
// results through it — including the shape of results a real run acted on.
//
// The defect this exists to stop is a quiet one: the step succeeds, the trace
// says references are ready, and the design call is handed measurements from
// an article about something else entirely. Nothing fails, and the model comes
// out wrong for a reason nobody can see.
//
// Run with: npm run check:reference-pick
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'reference-pick.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'reference-pick.js' });
const R = sandbox.window.HCReferencePick;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const res = (title, url, snippet = '') => ({ title, url, snippet });

console.log('\nThe module is there:');
ok('HCReferencePick is published', !!R);
ok('pickReferences is callable', typeof R.pickReferences === 'function');

console.log('\nWhat names the subject:');
{
  ok('a bare noun is the subject', R.subjectTerms('plane').join() === 'plane');
  ok('an article is not part of it', R.subjectTerms('a fish').join() === 'fish');
  ok('instructions to the app are not the subject',
    R.subjectTerms('make a detailed 3d model of a coffee mug').join() === 'coffee,mug');
  ok('an empty prompt names nothing', R.subjectTerms('').length === 0);
  ok('a word is matched in the plural', R.variantsOf('plane').includes('planes'));
  ok('and in the singular', R.variantsOf('wings').includes('wing'));
}

console.log('\nA page about a different sense of the word is not a reference:');
{
  // An ordinary short noun has senses in optics, in masonry and in geology.
  // Each of these is a real encyclopaedia article, and each was read by a run
  // asked for an aircraft.
  const terms = R.subjectTerms('plane');
  ok('an article on an unrelated subject is off-subject',
    !R.isOnSubject(res('Circle of confusion', 'https://en.wikipedia.org/wiki/Circle_of_confusion'), terms));
  ok('so is one that only shares a domain',
    !R.isOnSubject(res('Brickwork', 'https://en.wikipedia.org/wiki/Brickwork'), terms));
  ok('an article naming the subject is on-subject',
    R.isOnSubject(res('Airplane', 'https://en.wikipedia.org/wiki/Airplane'), terms));

  // A snippet is chosen for containing the query word. It is not the subject.
  ok('a mention inside a snippet does not make a page relevant',
    !R.isOnSubject(res('Circle of confusion', 'https://en.wikipedia.org/wiki/Circle_of_confusion',
      'the image plane is where the lens forms a sharp image'), terms));
}

console.log('\nRanking puts the subject above the domain:');
{
  const terms = R.subjectTerms('fish');
  const encyclopaediaOffSubject = res('Granite', 'https://en.wikipedia.org/wiki/Granite');
  const plainOnSubject = res('Fish body proportions', 'https://example.org/fish-proportions');
  ok('a page about the subject outranks an encyclopaedia page that is not',
    R.scoreResult(plainOnSubject, terms) > R.scoreResult(encyclopaediaOffSubject, terms));
  ok('a marketplace listing still scores below nothing',
    R.scoreResult(res('Fish 3D model', 'https://sketchfab.com/3d-models/fish-123'), terms) < 0);
}

console.log('\nWhat a run would actually have read:');
{
  const results = [
    res('Circle of confusion', 'https://en.wikipedia.org/wiki/Circle_of_confusion'),
    res('Brickwork', 'https://en.wikipedia.org/wiki/Brickwork'),
    res('Granite', 'https://en.wikipedia.org/wiki/Granite'),
    res('Airplane', 'https://en.wikipedia.org/wiki/Airplane'),
    res('Free 3D plane models — top 10 sites', 'https://example.com/top-10-download-free-3d-models'),
  ];
  const picked = R.pickReferences(results, 'plane');
  ok('the off-subject encyclopaedia pages are gone',
    !picked.some((r) => /Circle_of_confusion|Brickwork|Granite/.test(r.url)));
  ok('the page about the subject is kept',
    picked.some((r) => r.url.endsWith('/Airplane')));
  ok('and it is first', picked[0]?.url.endsWith('/Airplane'));

  const toRead = R.pickPagesToRead(results, 'plane');
  ok('only the subject page is opened', toRead.length === 1 && toRead[0].url.endsWith('/Airplane'));

  // Nothing on-subject: read nothing rather than something wrong.
  const noneRelevant = R.pickPagesToRead([
    res('Circle of confusion', 'https://en.wikipedia.org/wiki/Circle_of_confusion'),
    res('Brickwork', 'https://en.wikipedia.org/wiki/Brickwork'),
  ], 'plane');
  ok('when nothing is about the subject, nothing is opened', noneRelevant.length === 0);
}

console.log('\nIt holds up on ordinary input:');
{
  ok('no results is not fatal', R.pickReferences(null, 'plane').length === 0);
  ok('a result with no url is dropped', R.pickReferences([{ title: 'x' }], 'plane').length === 0);
  ok('duplicates are collapsed',
    R.pickReferences([res('Airplane', 'https://en.wikipedia.org/wiki/Airplane'),
                      res('Airplane', 'https://en.wikipedia.org/wiki/Airplane')], 'plane').length === 1);
  ok('an empty prompt keeps whatever came back',
    R.pickReferences([res('Anything', 'https://example.org/anything')], '').length === 1);
  ok('the limit is honoured',
    R.pickReferences([
      res('Plane one', 'https://a.org/plane-1'),
      res('Plane two', 'https://a.org/plane-2'),
      res('Plane three', 'https://a.org/plane-3'),
    ], 'plane', { limit: 2 }).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/reference-pick.js)\n`);
process.exit(fail ? 1 : 0);
