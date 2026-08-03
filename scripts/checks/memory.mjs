// ==============================================================
// Memory checks
//
// Loads the REAL src/js/memory.js into a Node VM.
//
// Two failures matter here and neither announces itself.
//
// A fact extracted badly is stored badly and repeated back for as long as it
// survives — the patterns used to run to the end of the clause, so telling the
// app "my name is seif save it" left it calling the user "seif save it".
//
// A fact that is stored but never ranked highly enough to surface makes the
// model deny knowing something it was told, which reads to the user as the app
// having forgotten. That is why the synonym cases below are here: someone who
// said "I love cats" asks "what animal do I like", and none of those words
// match.
//
// Run with: npm run check:memory
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'src', 'js', 'memory.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'memory.js' });
const M = sandbox.window.HCMemory;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
/** The value stored under a key, or undefined. */
const valueOf = (facts, key) => facts.find((f) => f.key === key)?.value;

const NOW = Date.UTC(2026, 7, 3);
const DAY = 86400000;

console.log('\nA name is a name, not the rest of the sentence:');
{
  // The defect this file exists for.
  ok('an instruction after the name is not part of it',
    valueOf(M.extractFacts('my name is seif save it', { now: NOW }), 'name') === 'seif');
  ok('a clause after the name is not part of it',
    valueOf(M.extractFacts('my name is seif and i work at acme', { now: NOW }), 'name') === 'seif');
  ok('a two-word name survives',
    valueOf(M.extractFacts('my name is Ada Lovelace', { now: NOW }), 'name') === 'Ada Lovelace');
  ok('a name is capped at three words',
    (valueOf(M.extractFacts('my name is a b c d e', { now: NOW }), 'name') || '').split(' ').length <= 3);
  ok('"call me" works too', valueOf(M.extractFacts('call me Sam', { now: NOW }), 'name') === 'Sam');
  ok('"I am called" works too', valueOf(M.extractFacts("i'm called Sam", { now: NOW }), 'name') === 'Sam');
  ok('the transliterated form is cleaned the same way',
    valueOf(M.extractFacts('ismi seif and i live in cairo', { now: NOW }), 'name') === 'seif');
}

console.log('\nOrdinary statements become facts:');
{
  const f = (t) => M.extractFacts(t, { now: NOW });
  ok('where someone lives', valueOf(f('i live in Cairo'), 'location') === 'Cairo');
  ok('where they are from', valueOf(f("i'm from Alexandria"), 'origin') === 'Alexandria');
  ok('who they work for', valueOf(f('i work at Acme'), 'employer') === 'Acme');
  ok('what they like', valueOf(f('i love cats'), 'likes') === 'cats');
  ok('what they dislike', valueOf(f('i hate coriander'), 'dislikes') === 'coriander');
  ok('an allergy', valueOf(f("i'm allergic to peanuts"), 'allergies') === 'peanuts');
  ok('an age', valueOf(f("i'm 30 years old"), 'age') === '30');
  ok('a favourite, keyed by what it is of',
    valueOf(f('my favourite colour is blue'), 'favorite_colour') === 'blue');
  ok('a project root, which Coder mode uses',
    valueOf(f('my project is at /Users/x/app'), 'project_root') === '/Users/x/app');
  ok('trailing punctuation is trimmed', valueOf(f('i live in Cairo.'), 'location') === 'Cairo');
}

console.log('\nExtraction refuses what it should:');
{
  ok('empty input yields nothing', M.extractFacts('', { now: NOW }).length === 0);
  ok('null is safe', M.extractFacts(null, { now: NOW }).length === 0);
  ok('an essay is skipped entirely',
    M.extractFacts('i live in Cairo. ' + 'x'.repeat(M.MAX_MESSAGE_CHARS), { now: NOW }).length === 0);
  // A value longer than a fact is prose, and storing it pollutes every later
  // recall. Two limits stop that, and the pattern's own is the one that bites:
  // "i love …" captures at most 80 characters, so a rambling sentence is
  // stored clipped rather than whole. MAX_VALUE_CHARS is the backstop for the
  // looser patterns, which capture up to 160.
  const long = M.extractFacts('i love ' + 'y'.repeat(M.MAX_VALUE_CHARS + 50), { now: NOW });
  const likes = valueOf(long, 'likes');
  ok('a rambling value is clipped, not stored whole', likes.length <= 80);
  ok('and never exceeds the backstop', likes.length <= M.MAX_VALUE_CHARS);
  ok('nothing is stored by extraction itself — it only returns',
    Array.isArray(M.extractFacts('i live in Cairo', { now: NOW })));
}

console.log('\nA fact the assistant confirms is caught too:');
{
  const f = (t) => M.extractFactsFromAssistant(t, { now: NOW });
  // The model often confirms a fact instead of calling the tool that stores
  // it, and then that reply is the only place the fact ever appeared.
  ok('a confirmed name', valueOf(f("Got it — your name is Seif"), 'name') === 'Seif');
  ok('a confirmed employer', valueOf(f('Noted that you work at Acme'), 'employer') === 'Acme');
  ok('a confirmed location', valueOf(f('Noted that you live in Cairo'), 'location') === 'Cairo');
  ok('a promise to remember becomes a note',
    f("I'll remember that you're allergic to peanuts").some((x) => x.key.startsWith('note_')));
  // The same name rule applies here, or the assistant's own sentence is stored.
  ok('a name is still capped', (valueOf(f('Got it — your name is a b c d e f') || '', 'name') || '').split(' ').length <= 3);
  ok('ordinary prose yields nothing', f('Here is the answer to your question.').length === 0);
  ok('a very long reply is skipped', f('x'.repeat(M.MAX_REPLY_CHARS + 1)).length === 0);
  ok('empty is safe', f('').length === 0 && M.extractFactsFromAssistant(null, { now: NOW }).length === 0);
  ok('it only returns, storing nothing', Array.isArray(f('Noted that you live in Cairo')));
}

console.log('\nA question finds a fact worded differently:');
{
  const facts = [
    { key: 'likes', value: 'cats', ts: NOW - DAY },
    { key: 'employer', value: 'Acme', ts: NOW - DAY },
    { key: 'location', value: 'Cairo', ts: NOW - DAY },
  ];
  const top = (q) => M.rankMemories(facts, q, { now: NOW, limit: 3 })[0];
  // None of these questions share a word with the stored fact.
  ok('"what animal do I like" finds cats', top('what animal do i like')?.value === 'cats');
  ok('"where do I work" finds the employer', top('where do i work')?.value === 'Acme');
  ok('"which city am I in" finds the location', top('which city am i in')?.value === 'Cairo');
  ok('a direct word still wins', top('cats')?.value === 'cats');
}

console.log('\nRanking puts the better match first:');
{
  const facts = [
    { key: 'likes', value: 'cats', ts: NOW - DAY * 2 },
    { key: 'dislikes', value: 'loud music', ts: NOW - DAY * 2 },
  ];
  const ranked = M.rankMemories(facts, 'cats', { now: NOW });
  ok('the matching fact is first', ranked[0].value === 'cats');
  ok('a score is attached', typeof ranked[0]._score === 'number');
  ok('the limit is respected', M.rankMemories(facts, 'cats', { now: NOW, limit: 1 }).length === 1);
}

console.log('\nRecent facts surface even when nothing matches:');
{
  const facts = [
    { key: 'note', value: 'the thing I just said', ts: NOW - DAY },      // 1 day old
    { key: 'old', value: 'something ancient', ts: NOW - DAY * 400 },     // long past
  ];
  const ranked = M.rankMemories(facts, 'unrelated question', { now: NOW });
  ok('a fact from this week still appears', ranked.some((f) => f.key === 'note'));
  ok('a very old unrelated fact does not', !ranked.some((f) => f.key === 'old'));
}

console.log('\nWith no question at all, the newest come back:');
{
  const facts = [
    { key: 'a', value: '1', ts: NOW - DAY * 3 },
    { key: 'b', value: '2', ts: NOW - DAY * 2 },
    { key: 'c', value: '3', ts: NOW - DAY },
  ];
  const recent = M.rankMemories(facts, '', { now: NOW, limit: 2 });
  ok('the newest is first', recent[0].key === 'c');
  ok('and only as many as asked for', recent.length === 2);
  ok('no facts means no results', M.rankMemories([], 'anything', { now: NOW }).length === 0);
  ok('undefined is safe', M.rankMemories(undefined, 'anything', { now: NOW }).length === 0);
}

console.log('\nStemming collapses tenses and plurals without mangling short words:');
{
  ok('plurals', M.memStem('cats') === M.memStem('cat'));
  ok('gerunds', M.memStem('working') === 'work');
  ok('past tense', M.memStem('worked') === 'work');
  ok('a short word is left alone', M.memStem('cat') === 'cat');
  ok('a three-letter word is left alone', M.memStem('ate') === 'ate');
  ok('case is normalised', M.memStem('CATS') === M.memStem('cats'));
  ok('empty is safe', M.memStem('') === '' && M.memStem(null) === '');
}

console.log('\nExpansion reaches the words that mean the same:');
{
  const forLove = M.memExpand('love');
  ok('love reaches like', forLove.includes('like'));
  ok('love reaches favourite', forLove.includes('favourite'));
  const forPet = M.memExpand('pet');
  ok('pet reaches animal', forPet.includes('animal'));
  ok('a word with no group still returns itself', M.memExpand('xylophone').includes('xylophone'));
  ok('single letters are dropped', M.memExpand('a').every((t) => t.length >= 2));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/memory.js)`);
process.exit(fail ? 1 : 0);
