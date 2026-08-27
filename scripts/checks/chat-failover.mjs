// ==============================================================
// Failover — checks
//
// Loads the REAL src/js/chat/failover.js. When a request fails the app moves
// on to another model, and two judgements decide what happens: whether the
// failure is worth moving on from, and which model to reach for.
//
// What is pinned here is the RULE, not the list of names. Model names change
// every few months and any list of them goes out of date; the rule that a
// variant is read before the family does not, and it is the rule that was
// broken — "gpt-4o-mini" matched "gpt-4o" and was ranked among the frontier
// models it is the cheap version of.
//
// Run with: npm run check:chat-failover
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sandbox = { window: {}, Map, Array, String, Number };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'src', 'js', 'chat', 'failover.js'), 'utf8'), sandbox, { filename: 'failover.js' });
const F = sandbox.window.HCChatFailover;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const model = (label, name) => ({ label, model: name });

// ── The rule ─────────────────────────────────────────────────────────────
console.log('\nThe cheap version of a model is not the model:');
{
  // The defect. A family name matched before the variant, so every small
  // variant was ranked alongside the frontier model it is named after — and a
  // failover reached for it ahead of a genuinely large model.
  const pairs = [
    ['gpt-4o', 'gpt-4o-mini'],
    ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    ['claude-opus-4', 'claude-opus-4-mini'],
    ['some-model-70b', 'some-model-70b-lite'],
  ];
  for (const [full, small] of pairs) {
    ok(`${small} ranks below ${full}`, F.rankOf(small) < F.rankOf(full),
      `${F.tierOf(small)} against ${F.tierOf(full)}`);
  }
  ok('and none of them is called frontier',
    pairs.every(([, small]) => F.tierOf(small) !== 'frontier'));
  // Stated as the rule rather than as a list, because the list goes stale.
  ok('any name carrying a small-variant word ranks below the same name without it',
    ['mini', 'lite', 'nano', 'tiny'].every((word) =>
      F.rankOf(`madeup-frontier-model-${word}`) < F.rankOf('gpt-4o')));
}

console.log('\nAnd a bigger model outranks a smaller one:');
{
  ok('frontier beats large', F.rankOf('gpt-4o') > F.rankOf('llama-3.3-70b'));
  ok('large beats medium', F.rankOf('llama-3.3-70b') > F.rankOf('claude-3-5-haiku'));
  ok('medium beats small', F.rankOf('claude-3-5-haiku') > F.rankOf('some-unknown-model'));
  // A name nobody has taught it about is ranked last rather than guessed high:
  // reaching for an unknown model ahead of a known good one is the worse
  // mistake of the two.
  ok('a name it knows nothing about ranks last', F.tierOf('totally-unheard-of') === 'small');
  ok('and nothing at all is survivable', F.tierOf('') === 'small' && F.tierOf(null) === 'small');
}

console.log('\nA failure is sorted into what to do about it:');
{
  ok('a cancelled request is the end of it',
    F.classifyError({ name: 'AbortError', message: 'aborted' }) === 'fatal');
  ok('and so is nothing at all', F.classifyError(null) === 'fatal');
  // The same model again might work.
  ok('a timeout is worth waiting out',
    F.classifyError(new Error('request timed out')) === 'transient');
  ok('so is a network drop', F.classifyError(new Error('fetch failed')) === 'transient');
  ok('and a server fault', F.classifyError(new Error('503 server error')) === 'transient');
  // This model will not do it; another might.
  ok('a rate limit means try somewhere else',
    F.classifyError(new Error('rate limit exceeded')) === 'routable');
  ok('so does a rejected key', F.classifyError(new Error('HTTP 401 invalid key')) === 'routable');
  ok('and a model that is not there', F.classifyError(new Error('model not found')) === 'routable');
  // Trying another model wastes a request; calling a recoverable failure fatal
  // ends somebody's work for no reason. The first is the cheaper mistake.
  ok('something it does not recognise is treated as worth trying elsewhere',
    F.classifyError(new Error('something nobody has seen before')) === 'routable');
  ok('and isRoutable agrees with the sorting',
    F.isRoutable(new Error('429')) && !F.isRoutable(new Error('timed out'))
    && !F.isRoutable({ name: 'AbortError' }));
}

console.log('\nThe model somebody chose stays the one that is tried first:');
{
  // Being quietly moved off the model you picked, because the app thinks it
  // knows better, is not a failover.
  const chain = [model('local', 'tiny-1b'), model('groq', 'gpt-4o'), model('gemini', 'gemini-2.5-pro')];
  const order = F.orderChain(chain);
  ok('the choice is first even when it ranks last', order[0].model === 'tiny-1b');
  ok('and the rest follow by how capable they are',
    order.slice(1).every((m, i, a) => i === 0 || F.rankOf(a[i - 1].model) >= F.rankOf(m.model)));
}

console.log('\nA model that keeps failing goes to the back:');
{
  const chain = [
    model('primary', 'tiny-1b'),
    model('a', 'gpt-4o'),
    model('b', 'llama-3.3-70b'),
  ];
  const streaks = new Map([['a:gpt-4o', 5]]);
  const order = F.orderChain(chain, streaks);
  ok('the choice is still first', order[0].model === 'tiny-1b');
  // A frontier model refusing every request is worth less right now than a
  // smaller one that answers.
  ok('the one that keeps failing is tried after the one that works',
    order[1].model === 'llama-3.3-70b', order.map((m) => m.model).join(' → '));
  ok('but it is still tried rather than dropped',
    order.some((m) => m.model === 'gpt-4o'));
  ok('a couple of failures is not enough to demote it',
    F.orderChain(chain, new Map([['a:gpt-4o', 2]]))[1].model === 'gpt-4o');
}

console.log('\nThe same chain always comes back in the same order:');
{
  // Two models of equal rank must not swap places between runs, or a failover
  // becomes something nobody can reproduce.
  const chain = [model('p', 'x'), model('a', 'llama-3.3-70b'), model('b', 'qwen2.5-72b')];
  const once = F.orderChain(chain).map((m) => m.label).join();
  const twice = F.orderChain(chain).map((m) => m.label).join();
  ok('two runs give the same order', once === twice, `${once} then ${twice}`);
  ok('and equal ranks keep the order they were offered in', once === 'p,a,b', once);
  ok('an empty chain is an empty chain',
    F.orderChain([]).length === 0 && F.orderChain(null).length === 0);
  ok('nothing is lost from the chain', F.orderChain(chain).length === chain.length);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/failover.js)\n`);
process.exit(fail === 0 ? 0 : 1);
