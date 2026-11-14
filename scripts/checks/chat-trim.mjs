// ==============================================================
// A chat agent's conversation fitted to its model's window — checks
//
// Loads the real src/js/chat/trim.js (with js/model-limits.js and
// js/local-context.js, whose room and count it uses) and holds how the
// conversation an agent on a model on this computer is shown is fitted to
// that model: a budget from the model's own window, room left for its tool
// steps and its answer; the oldest messages left out first, the
// instructions and the latest exchanges always kept; and the model told,
// in words, how many earlier messages it cannot see. Also pins the chat to
// it in place of the fixed trim.
//
// Run with: npm run check:chat-trim
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

const sandbox = { console, localStorage: { getItem: () => null, setItem: () => {} } };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['model-limits.js', 'local-context.js']) { try { vm.runInContext(src('js', f), sandbox, { filename: f }); } catch (e) { ok(`${f} loads`, false, String(e && e.message)); } }
try { vm.runInContext(src('js', 'chat', 'trim.js'), sandbox, { filename: 'trim.js' }); } catch (e) { ok('trim.js loads', false, String(e && e.message)); }
const T = sandbox.HCChatTrim || {};
const L = sandbox.HCLocalContext || {};

console.log('\nThe budget, from the model\'s own window:');
{
  const b = (w) => (typeof T.budgetFor === 'function' ? T.budgetFor(w) : null);
  ok('a window of 32,768 leaves room for the tool steps and the answer', b(32768) === 32768 - 4096 - 1024, String(b(32768)));
  ok('...as does one of 16,384', b(16384) === 16384 - 5120);
  ok('a small window keeps at least half for the conversation', b(4096) === 2048 && b(8192) === 4096, `${b(4096)} ${b(8192)}`);
  ok('a window not known is taken as the smallest a model is given', b(undefined) === b(4096) && b(0) === b(4096) && b(-5) === b(4096));
}

const sys = { role: 'system', content: 'You are a helpful agent.' };
const turn = (i, size) => [{ role: 'user', content: `Question ${i}: ${'q'.repeat(size)}` }, { role: 'assistant', content: `Answer ${i}: ${'a'.repeat(size)}` }];
const talk = (n, size) => [sys, ...Array.from({ length: n }, (_, i) => turn(i, size)).flat(), { role: 'user', content: 'The latest question.' }];

console.log('\nFitted, oldest first:');
{
  if (typeof T.fit === 'function') {
    const small = talk(2, 50);
    const before = json(small);
    const r0 = T.fit(small, { window: 32768, tokensOf: L.tokensOf });
    ok('a conversation that fits is left as it is', r0.dropped === 0 && json(small) === before);

    const long = talk(12, 3000);
    const r = T.fit(long, { window: 8192, tokensOf: L.tokensOf });
    const rest = long.filter((m) => m.role !== 'system');
    ok('a long one is cut until it fits the budget', r.dropped > 0 && L.tokensOf(long) <= r.budget, `${r.dropped} dropped, ${L.tokensOf(long)} of ${r.budget}`);
    ok('...the oldest messages going first, the latest question kept', !/Question 0:/.test(rest.map((m) => m.content).join('\n')) && rest.at(-1).content === 'The latest question.');
    ok('...and the instructions always kept, at the start', long[0].role === 'system' && long[0].content.startsWith('You are a helpful agent.'));
    ok('the model is told how many earlier messages it cannot see, and not to answer as if it had read them', r.dropped > 1 && new RegExp(`\\[${r.dropped} earlier messages of this conversation are not shown here`).test(long[0].content) && /do not answer as if you had read them/.test(long[0].content), long[0].content.slice(-220));

    const big = talk(12, 3000);
    const rBig = T.fit(big, { window: 32768, tokensOf: L.tokensOf });
    ok('a model with a larger window is shown more of the same conversation', rBig.dropped < r.dropped && big.length > long.length, `${rBig.dropped} vs ${r.dropped}`);

    const huge = [sys, { role: 'user', content: 'x'.repeat(200000) }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'y' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'Now?' }];
    const rH = T.fit(huge, { window: 4096, tokensOf: L.tokensOf });
    ok('the latest exchanges are never cut, even when they alone do not fit', huge.filter((m) => m.role !== 'system').length === 4 && rH.dropped === 1, `${rH.dropped}`);
    ok('...and one message left out is said as one', /\[One earlier message of this conversation is not shown here, to fit this model\. If the person refers to it, say you cannot see it; do not answer as if you had read it\.\]/.test(huge[0].content), huge[0].content.slice(-200));

    const heavy = [sys, ...Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:${'z'.repeat(20000)}` }))];
    const rHeavy = T.fit(heavy, { window: 4096, tokensOf: L.tokensOf });
    ok('...the latest four, however large', rHeavy.dropped === 2 && heavy.filter((m) => m.role !== 'system').map((m) => m.content.split(':')[0]).join(',') === '2,3,4,5', `${rHeavy.dropped}`);
    const told = talk(3, 10);
    const rTold = T.fit(told, { window: 32768, tokensOf: () => 1e9 });
    ok('it counts with the count it is handed', rTold.dropped === 3 && told.filter((m) => m.role !== 'system').length === 4, `${rTold.dropped}`);
    const none = [{ role: 'user', content: 'q'.repeat(9000) }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }, { role: 'assistant', content: 'e' }];
    T.fit(none, { window: 4096, tokensOf: L.tokensOf });
    ok('with no instructions to hold the line, it is given its own at the start', none[0].role === 'system' && /of this conversation (?:is|are) not shown here/.test(none[0].content));

    const counted = talk(12, 3000);
    const rDefault = T.fit(counted, { window: 8192 });
    ok('with no count handed in, it counts on the safe side itself', rDefault.dropped >= r.dropped, `${rDefault.dropped}`);
  } else ok('fit() exists', false);
}

console.log('\nThe chat (app.js):');
{
  const app = src('js', 'app.js');
  ok('the fixed trim is gone', !/trimBaseToContextBudget/.test(app) && !/const BUDGET = 8000;/.test(app));
  ok('an agent not on the shared loop is fitted to its model\'s window: this computer\'s model by what it says of itself, up to the ceiling', /window\.HCChatTrim\.fit\(baseMessages, \{ window: modelEl\.value\.startsWith\("cloud:"\) \? window\.HCModelLimits\?\.forContext\?\.\(modelEl\.value\)\?\.window : Math\.min\(\(await HCLocalContext\.infoOf\(safeHost\(\), modelEl\.value\)\)\.max, HCLocalContext\.CEILING\), tokensOf: HCLocalContext\.tokensOf \}\);/.test(app));
  ok('...before its steps are taken', app.indexOf('window.HCChatTrim.fit(baseMessages') > 0 && app.indexOf('window.HCChatTrim.fit(baseMessages') < app.indexOf('if (localSteps) return runLocalAgentSteps('));
  const boot = src('boot.js');
  ok('trim.js is loaded after what it counts with, and before app.js', boot.indexOf('/js/chat/trim.js') > boot.indexOf('/js/local-context.js') && boot.indexOf('/js/chat/trim.js') > boot.indexOf('/js/model-limits.js') && boot.indexOf('/js/chat/trim.js') < boot.indexOf('/js/app.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/trim.js)`);
process.exit(fail ? 1 : 0);
