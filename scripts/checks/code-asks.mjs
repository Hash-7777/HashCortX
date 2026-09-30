// ============================================================
// The asks in a request, as a checklist — src/js/code/asks.js, the
// note that goes through them (js/code/verify.js asksCheck), what is left
// of a plan (js/code/plan.js leftLine), and where the Coder uses them.
// Run with: npm run check:code-asks
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
vm.runInContext(src('js', 'fences.js'), box, { filename: 'fences.js' });
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'asks.js'), box, { filename: 'asks.js' });
for (const f of ['verify.js', 'plan.js', 'context.js']) vm.runInContext(src('js', 'code', f), box, { filename: f });
const A = box.window.HCCodeAsks, V = box.window.HCCodeVerify, P = box.window.HCCodePlan, C = box.window.HCCodeContext;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const same = (text, want) => { const got = A.split(text); return [JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got)]; };
const check = (label, text, want) => { const [good, got] = same(text, want); ok(label, good, got); };

console.log('A request split into its asks:');
check('asks joined with "also", "and I want" and a new sentence', 'fix the spacing in the header , also make the logo smaller and I want a dark mode switch. and remove the old footer',
  ['fix the spacing in the header', 'make the logo smaller', 'I want a dark mode switch', 'remove the old footer']);
check('a list, one ask a line', '- add a login page\n- make the button blue\n* delete test.js', ['add a login page', 'make the button blue', 'delete test.js']);
check('items numbered on one line', '1. fix x in the nav 2. add y to the page 3. remove z from the list', ['fix x in the nav', 'add y to the page', 'remove z from the list']);
check('two asks joined by "and" when each is a full ask', 'make the header red and make it round and add a shadow under it', ['make the header red', 'make it round', 'add a shadow under it']);
check('a sentence that only describes the situation is left out', 'the site looks bad on phones. make it responsive, also fix the menu and add a footer', ['make it responsive', 'fix the menu', 'add a footer']);
check('a question is an ask: it wants an answer', 'I want all the tabs the same size , and tell me how the settings highlight that letter , and does the app look at the memory?',
  ['I want all the tabs the same size', 'tell me how the settings highlight that letter', 'does the app look at the memory?']);
check('a question with no verb of change is an ask too', 'fix the menu, also add a footer, and why is the header blue?', ['fix the menu', 'add a footer', 'why is the header blue?']);
check('code is never split into asks', 'add this function:\n```js\nfunction a(){ x.also = 1; fix(); }\n```\nand also fix the css, also add tests', ['add this function', 'fix the css', 'add tests']);
check('an address with a stop in it is not a sentence break', 'look at https://example.org/a.b and tell me, also rename the file and make it faster; and delete the old one',
  ['look at https://example.org/a.b and tell me', 'rename the file', 'make it faster', 'delete the old one']);

console.log('\nWhat is one request, not a list:');
ok('a single ask', A.split('fix the bug in app.js').length === 0);
ok('two asks: a request of two parts is its own checklist', A.split('fix the menu, also add a footer').length === 0);
ok('a list of qualities, not of asks', A.split('make it faster, cleaner and nicer').length === 0 && A.split('red, green, and blue buttons please').length === 0);
ok('"and" inside a short phrase is not a join', A.split('use search and replace to rename getUser everywhere').length === 0);
ok('a request longer than pasted material allows is not split', A.split(`fix a, also fix b, also fix c. ${'x'.repeat(A.LONGEST_REQUEST)}`).length === 0);
ok('nothing, nothing', A.split('').length === 0 && A.split(null).length === 0);
ok('the same ask twice is listed once', JSON.stringify(A.split('fix the menu, also add a footer, also fix the menu, also remove the banner')) === JSON.stringify(['fix the menu', 'add a footer', 'remove the banner']));
ok(`no more than ${A.MOST_ASKS} asks`, A.split(Array.from({ length: 20 }, (_, i) => `- fix item number ${i}`).join('\n')).length === A.MOST_ASKS);

console.log('\nThe checklist, with the request:');
const asks = ['fix the menu', 'add a footer', 'remove the banner'];
ok('numbered, in the person\'s words, asking for every one', A.checklist(asks) === "The request has 3 separate asks, in the person's words. Do every one of them:\n1. fix the menu\n2. add a footer\n3. remove the banner");
ok('none for fewer than three', A.checklist(['a b', 'c d']) === '' && A.checklist(null) === '');
const context = C.forRequest({ site: 'SITE BAR', activeFile: '/p/a.js', asks: A.checklist(asks) });
ok('it goes first in what the app adds to the request, from the app and not the person', context.startsWith(`${C.FROM_APP}\nThe request has 3 separate asks`) && context.indexOf('SITE BAR') > context.indexOf('3. remove the banner'));

console.log('\nBefore finishing, ask by ask:');
const log = () => { const l = V.proofLog(); l.edited('/p/index.html'); return l; };
const note = V.asksCheck(log(), asks, 'Done.', 0);
ok('the agent is sent back to go through each ask, do what is missing, and say done or not for each',
  note && note.kind === 'asks' && note.message.startsWith(V.APP_NOTE) && /\n1\. fix the menu\n2\. add a footer\n3\. remove the banner\n/.test(note.message) && /one short line per ask: done, or not done and why/.test(note.message), note && note.message);
ok('once', V.asksCheck(log(), asks, 'Done.', 1) === null);
ok('not before any file changed, and not for a reply asking the person something', V.asksCheck(V.proofLog(), asks, 'Done.', 0) === null && V.asksCheck(log(), asks, 'Which footer did you mean?', 0) === null);
ok('not for fewer than three asks', V.asksCheck(log(), ['a b', 'c d'], 'Done.', 0) === null);
ok('a saved conversation shows it as the step it was', V.noteStep(note.message) === 'Sent back to go through each ask of the request');
const request = [{ role: 'user', content: 'fix the menu, also add a footer, also remove the banner' }];
const back = (size, prove, list) => V.sendBack(log(), request, 'Done.', { size, prove, asks: list, sent: {} });
ok('it takes the place of the check against the whole request for a small model', back('small', true, asks).kind === 'asks' && back('small', true, []).kind === 'review');
ok('and runs for a larger model too, and not while proving is switched off', back('full', true, asks).kind === 'asks' && back('full', false, asks) === null && back('full', true, []) === null);

console.log('\nWhat is left, said:');
const plan = { steps: [{ step: 'page', status: 'done' }, { step: 'styles', status: 'doing' }, { step: 'menu', status: 'todo' }] };
ok('the open steps of its plan, in a line', P.leftLine(plan) === 'Not done from its plan: styles; menu.');
ok('nothing left, nothing said', P.leftLine({ steps: [{ step: 'page', status: 'done' }] }) === '' && P.leftLine(null) === '');

console.log('\nHashCoder:');
const mode = src('modes', 'code', 'mode.js');
ok('splits each request, and sends the list with it', /const asks = window\.HCCodeAsks\?\.split\(task\) \|\| \[\];/.test(mode) && /asks: window\.HCCodeAsks\?\.checklist\(asks\) \}\)/.test(mode));
ok('keeps them for that request only, as it does the plan', /HC\.code\.plan = null; HC\.code\.asks = asks; \}/.test(mode));
ok('gives them to the checks before finishing, and counts how often it sent the run back for them', /plan: HC\?\.code\?\.plan, asks: HC\?\.code\?\.asks \}\)/.test(mode) && /review: 0, asks: 0,/.test(mode));
ok('says what is left of its plan under the answer, and when it stops early',
  /const proven = \[proof && window\.HCCodeVerify\.proofLine\(proof\), window\.HCCodePlan\?\.leftLine\(HC\?\.code\?\.plan\)\]\.filter\(Boolean\)\.join\(' '\);/.test(mode)
  && /\[stop\.message, window\.HCCodePlan\?\.leftLine\(HC\?\.code\?\.plan\)\]\.filter\(Boolean\)\.join\(' '\)/.test(mode));
const boot = src('boot.js');
ok('it is loaded before the modes', boot.indexOf("'/js/code/asks.js'") > 0 && boot.indexOf("'/js/code/asks.js'") < boot.indexOf("'/modes/boot.js'"));
ok('Settings says so under proving changes', /A request of several asks is gone through ask by ask\./.test(src('core', 'settings', 'panel.html')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/asks.js)`);
process.exit(fail ? 1 : 0);
