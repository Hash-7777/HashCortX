// ==============================================================
// Forge model capability — checks
//
// Loads the REAL src/js/forge/capability.js. These judgements used to sit
// inside the mode, where nothing could read them: the router quietly preferred
// some models over others and a person never saw why, and neither did a check.
//
// Everything here is a guess made from a model's NAME. What is checked is that
// the guess is the one intended, that it has three answers rather than two —
// a model whose name says nothing is UNKNOWN, not bad — and that the wording
// shown to a person never claims more than a name can support.
//
// Run with: npm run check:forge-capability
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'forge', 'capability.js'), 'utf8'), sandbox, { filename: 'capability.js' });
const C = sandbox.window.HCForgeCapability;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

console.log('\nA size is read from a name, and nothing is read as small:');
{
  ok('a plain size is read', C.sizeOf('llama-3.3-70b', '') === 70);
  ok('a decimal one too', C.sizeOf('qwen-1.5b', '') === 1.5);
  ok('the largest claim in a name wins', C.sizeOf('mix-8x22b-141b', '') === 141);
  ok('a name that spells its size out is still read', C.sizeOf('gpt-oss-120b', '') === 120);
  // Zero has to mean UNKNOWN. Reading it as small would judge a model on its
  // name being uninformative.
  ok('a name that says nothing reads as nothing, not as small', C.sizeOf('my-local-model', '') === 0);
  ok('a label is read as well as an identifier', C.sizeOf('x', 'Something 405B') === 405);
}

console.log('\nA free tier is spotted however a provider spells it:');
{
  ok('the suffix form', C.isFree('vendor/model:free', ''));
  ok('the word on its own', C.isFree('x', 'Model (free)'));
  ok('and a paid model is not called free', !C.isFree('vendor/model', 'Model Pro'));
  // The trap: "freedom", "freeform" and the like are not free tiers.
  ok('a word merely beginning that way is not a free tier', !C.isFree('freeform-writer-70b', ''));
}

console.log('\nGeometry gets three answers, not two:');
{
  ok('a big paid model is a yes', C.geometryVerdict('llama-3.3-70b', 'Llama 70B').verdict === 'yes');
  ok('a very big one too', C.geometryVerdict('deepseek-v3-671b', '').verdict === 'yes');
  // Big enough and rate-limited is a different problem from too small.
  ok('a big free one is a maybe', C.geometryVerdict('vendor/llama-70b:free', '').verdict === 'maybe');
  ok('and says which problem it is',
    /free tier/.test(C.geometryVerdict('vendor/llama-70b:free', '').why));
  ok('a small one is a no', C.geometryVerdict('gemma-2b', '').verdict === 'no');
  ok('so is one named for being quick', C.geometryVerdict('gemini-flash', '').verdict === 'no');
  ok('and one named mini', C.geometryVerdict('gpt-4o-mini', '').verdict === 'no');
  ok('a middling one is a maybe, with the number said',
    C.geometryVerdict('mistral-24b', '').verdict === 'maybe'
    && /24B is under the 70B/.test(C.geometryVerdict('mistral-24b', '').why));
  // The important one: silence is not a verdict.
  ok('a name that says nothing is unknown, not bad',
    C.geometryVerdict('my-local-model', '').verdict === 'unknown');
  ok('and says that is why', /name says nothing/.test(C.geometryVerdict('my-local-model', '').why));
  ok('every verdict comes with a reason a person can read',
    ['llama-3.3-70b', 'gemma-2b', 'my-local-model', 'vendor/x:free']
      .every((m) => C.geometryVerdict(m, '').why.length > 20));
}

console.log('\nThe ordering prefers what a design call actually needs:');
{
  const big = (m) => C.strengthOf(m, '', true);
  ok('a large model beats a small one', big('llama-3.3-70b') > big('llama-3b'));
  ok('a paid model beats the same model free',
    big('vendor/llama-70b') > big('vendor/llama-70b:free'));
  // A design call is one long answer that has to be right all the way
  // through, so size is weighed harder than it is for a paragraph.
  ok('and size counts for more on a design than on a chat',
    big('llama-3.3-70b') - big('gemini-flash')
    > C.strengthOf('llama-3.3-70b', '', false) - C.strengthOf('gemini-flash', '', false));
}

console.log('\nThe survey says what a person has, in a sentence:');
{
  const survey = C.surveyOf([
    { value: 'vendor/llama-3.3-70b', label: 'Llama 70B' },
    { value: 'gemini-flash', label: 'Flash' },
    { value: 'vendor/big:free', label: 'Big (free)' },
  ]);
  ok('every model is judged', survey.total === 3);
  ok('the able ones are counted', survey.able === 1);
  ok('and the doubtful ones separately', survey.maybe === 1);
  ok('the best is the one a run would reach for', survey.best.value === 'vendor/llama-3.3-70b');
  ok('the sentence says how many of how many', /1 of your 3 models/.test(survey.note));

  const none = C.surveyOf([{ value: 'gemini-flash', label: 'Flash' }]);
  ok('with nothing able it says so plainly', /expect plain boxes/.test(none.note));
  ok('and does not pretend otherwise', none.able === 0);

  const empty = C.surveyOf([]);
  ok('with no models at all it says that instead', /No models are set up/.test(empty.note));
  ok('and offers no best', empty.best === null);
  ok('anything that is not a list is survivable', C.surveyOf(null).total === 0);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/forge/capability.js)\n`);
process.exit(fail === 0 ? 0 : 1);
