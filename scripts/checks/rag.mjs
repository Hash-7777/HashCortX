// ==============================================================
// Knowledge-base retrieval checks
//
// Loads the real src/js/rag-search.js and asserts how results are ordered.
//
// Retrieval is the part of a knowledge base that fails quietly. Nothing
// crashes when ranking gets worse; the answers just start missing the point,
// and by the time anyone notices, the cause is several changes back. These
// checks pin the properties that make retrieval work at all.
//
// Run with: npm run check:rag
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(here, '..', '..', 'src', 'js', 'rag-search.js');

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(target, 'utf8'), sandbox, { filename: 'rag-search.js' });

const { extractKeywords, keywordScore, cosineSim, fuseByRank, RRF_K } = sandbox.window.HCRagSearch;

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const chunk = (title, text, keywords) => ({ title, text, keywords: keywords ?? extractKeywords(text) });

console.log('\nKeywords:');
check('drops stop words and short tokens',
  JSON.stringify(extractKeywords('the agent is in a shell')) === JSON.stringify(['agent', 'shell']),
  JSON.stringify(extractKeywords('the agent is in a shell')));
check('deduplicates', extractKeywords('audit audit audit log').length === 2);
check('survives empty input', extractKeywords('').length === 0 && extractKeywords(null).length === 0);

console.log('\nKeyword scoring:');
const q = extractKeywords('permission guard denied the shell command');
check('a matching chunk outscores a non-matching one',
  keywordScore(q, chunk('Guard', 'the permission guard denied a shell command')) >
  keywordScore(q, chunk('Pastry', 'fold the butter into the flour')));
check('a title match counts for more than the same match in the body',
  keywordScore(q, chunk('permission guard', 'unrelated body text entirely')) >
  keywordScore(q, chunk('unrelated title', 'permission guard mentioned here')));
// The defect this file was written to catch: the title used only to multiply a
// body match, so a chunk whose body never repeated its own title was invisible.
check('a term found ONLY in the title is still findable',
  keywordScore(extractKeywords('permission guard'),
               chunk('Permission Guard', 'it decides before anything runs')) > 0);
check('a chunk with no keywords scores zero',
  keywordScore(q, { title: 'x', text: 'y', keywords: [] }) === 0);
check('an empty query scores zero',
  keywordScore([], chunk('Guard', 'the permission guard denied a shell command')) === 0);

console.log('\nCosine similarity:');
check('identical unit vectors score 1', Math.abs(cosineSim([1, 0], [1, 0]) - 1) < 1e-9);
check('orthogonal vectors score 0', Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9);
check('MISMATCHED WIDTHS score 0 rather than throwing', cosineSim([1, 0, 0], [1, 0]) === 0);

console.log('\nRank fusion:');
// The failure the old concatenation had: the semantic list was pasted in
// first, so its third guess outranked the keyword list's perfect match.
const a = chunk('A', 'alpha'), b = chunk('B', 'bravo'), c = chunk('C', 'charlie'), d = chunk('D', 'delta');
const semantic = [b, c, d];   // d is semantic rank 3
const lexical  = [d, a];      // d is lexical rank 1
const fused = fuseByRank([semantic, lexical]);
check('a chunk both rankers found wins',
  fused[0].title === 'D', `got ${fused.map(x => x.title).join(',')}`);
check('every input chunk survives fusion', fused.length === 4);
check('no duplicates after fusion',
  new Set(fused.map(x => x.title)).size === fused.length);
check('scores descend', fused.every((x, i) => i === 0 || fused[i - 1]._rrf >= x._rrf));

// A single list must come back in its own order, untouched.
const single = fuseByRank([[a, b, c]]);
check('one list keeps its order',
  single.map(x => x.title).join('') === 'ABC', single.map(x => x.title).join(''));

check('an empty input fuses to nothing', fuseByRank([]).length === 0);
check('empty and missing lists are ignored, not fatal',
  fuseByRank([[], null, [a]]).length === 1);

// The reason K is large: it flattens the top of each list so one ranker's
// confident first guess cannot beat agreement between two rankers.
const topOfOne = fuseByRank([[a], [b, a]]);
check('agreement beats a lone first place',
  topOfOne[0].title === 'A', `got ${topOfOne.map(x => x.title).join(',')}`);
check('K matches the published constant', RRF_K === 60);

// ── Who can actually reach the knowledge base ────────────────────────────
//
// Retrieval that ranks perfectly is worth nothing to a mode that has no way to
// ask it. The Agent Swarm had none: the shared tool table held nine tools and
// not one of them searched the person's documents, while two of the nine wrote
// into that same store every time an agent searched the web. A swarm run
// filled a shelf it could never read from.
{
  const root = join(here, '..', '..');
  const app = readFileSync(join(root, 'src', 'js', 'app.js'), 'utf8');
  const shape = readFileSync(join(root, 'src', 'js', 'agent-shape.js'), 'utf8');
  const templates = readFileSync(join(root, 'src', 'data', 'swarm-templates.js'), 'utf8');
  const swarm = readFileSync(join(root, 'src', 'modes', 'agent-maker', 'mode.js'), 'utf8');
  const kb = readFileSync(join(root, 'src', 'core', 'rag', 'knowledge-base.js'), 'utf8');

  console.log('\nEvery agent can reach the knowledge base, not only the Coder:');
  check('the shared tool table has one for it', /^    search_knowledge: \{/m.test(app));
  check('it goes through the same retrieval chat uses', /const chunks = await queryRAGMerged\(q\);/.test(app));
  check('a team can be given it', /"knowledge"/.test(templates));
  check('and the id maps to the tool', /t === 'knowledge'\) out\.add\('search_knowledge'\)/.test(shape));
  check('the picker offers it', /id: "knowledge"/.test(swarm));
  check('the model is told it exists', /pick from: memory, knowledge, web_search/.test(swarm));

  // A model told "nothing found" invents a convention and states it. One told
  // the base is switched off says so instead. They must never read the same.
  check('switched off and holding nothing are different answers',
    /switched off, so nothing was searched/.test(app) && /held nothing matching this/.test(app));
  check('it asks for the source to be cited', /Cite the source and title/.test(app));

  console.log('\nThe switch means one thing — neither read nor written:');
  check('reading checks it', /function queryRAGVector[\s\S]{0,120}if \(!isRagEnabled\(\)\) return \[\];/.test(kb));
  check('merged reading checks it', /async function queryRAGMerged[\s\S]{0,80}if \(!isRagEnabled\(\)\) return \[\];/.test(kb));
  check('adding a document by hand checks it', /function ingestIntoRAG[\s\S]{0,120}if \(!isRagEnabled\(\)\) return 0;/.test(kb));
  check('and so does what the tools capture as they go',
    /function addToRAG\(title, text, source\) \{\s*if \(!isRagEnabled\(\)\) return;/.test(kb),
    'a person who switched it off still had every page their agents read written to disk');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/rag-search.js)`);
process.exit(fail ? 1 : 0);
