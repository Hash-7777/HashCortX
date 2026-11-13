// ==============================================================
// Trying again: with a hint, or with a stronger model — checks
//
// Loads the real src/js/code/retry.js with the modules it reads (model
// names, light mode's reading of a size from a name, the model profiles and
// the Swarm's reading of strength) and holds when a run that ended stuck, at
// its limit or with asks still open is offered another try, what that try
// is given, which model counts as stronger, that a run on this computer or
// on a project marked private is offered only another model on this
// computer, and that the try goes through the person's own controls: the
// model menu, New conversation and Run.
//
// Run with: npm run check:code-retry
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

class Event { constructor(type) { this.type = type; } }
const sandbox = { console, Event };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['model-names.js', 'code/light.js', 'model-profile.js', 'swarm/model-strength.js']) vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
try { vm.runInContext(src('js', 'code', 'retry.js'), sandbox, { filename: 'retry.js' }); } catch (e) { ok('retry.js loads', false, String(e && e.message)); }
const R = sandbox.HCCodeRetry || {};
const has = (n) => typeof R[n] === 'function';
const opt = (value, label = value) => ({ value, label });

console.log('Which model is stronger:');
{
  const s = (current, options, o = {}) => (has('stronger') ? R.stronger(current, options, o) : 'missing');
  const cloud = [opt(''), opt('cloud:openai:gpt-5-mini'), opt('cloud:openai:gpt-5'), opt('cloud:gemini:gemini-2.5-flash'), opt('cloud:openai:gpt-5-nano'), opt('cloud:openai:text-embedding-3-large')];
  ok('a small cloud model: the strongest the person has is offered', s('cloud:openai:gpt-5-mini', cloud)?.value === 'cloud:openai:gpt-5', json(s('cloud:openai:gpt-5-mini', cloud)));
  ok('a fast model: the full model of its family', s('cloud:gemini:gemini-2.5-flash', [opt('cloud:gemini:gemini-2.5-flash'), opt('cloud:gemini:gemini-2.5-pro')])?.value === 'cloud:gemini:gemini-2.5-pro');
  ok('a model already among the strongest is offered none', s('cloud:gemini:gemini-2.5-pro', [opt('cloud:gemini:gemini-2.5-pro'), opt('cloud:gemini:gemini-3-pro-preview'), opt('cloud:openai:gpt-5')]) === null);
  ok('a small, fast model is never offered as stronger than another one', s('cloud:gemini:gemini-2.5-flash', [opt('cloud:groq:llama-3.1-8b-instant')]) === null);
  ok('the strongest is never itself, Auto, or a model that does not write text', (() => { const got = s('cloud:openai:gpt-5', cloud); return got === null; })());
  const local = [opt('qwen2.5-coder:7b'), opt('qwen2.5-coder:32b'), opt('llama3.1:8b'), opt('nomic-embed-text'), opt('cloud:openai:gpt-5')];
  ok('a run on this computer: the largest model on this computer, never a cloud one', s('qwen2.5-coder:7b', local, { localOnly: true })?.value === 'qwen2.5-coder:32b', json(s('qwen2.5-coder:7b', local, { localOnly: true })));
  ok('...and the largest already in use is offered none', s('qwen2.5-coder:32b', local, { localOnly: true }) === null);
  ok('...a model whose size is not known is never taken for a stronger one', s('qwen2.5-coder:7b', [opt('house-model:latest')], { localOnly: true }) === null);
  ok('a cloud run on a project marked private is offered no cloud model, and is not moved to this computer either', s('cloud:openai:gpt-5-mini', [...cloud, opt('qwen2.5-coder:32b')], { localOnly: true }) === null);
  ok('a cloud run is offered cloud models only', s('cloud:openai:gpt-5-mini', [opt('cloud:openai:gpt-5-mini'), opt('gpt-oss:120b')]) === null);
  ok('the label comes with it, to name it on the button', s('cloud:openai:gpt-5-mini', [opt('cloud:openai:gpt-5', 'GPT-5')])?.label === 'GPT-5');
}

console.log('\nWhen another try is offered, and what it is given:');
{
  const marks = [{ n: 1, text: 'add a basket total', state: 'answered' }, { n: 2, text: 'round it to cents', state: 'open' }, { n: 3, text: 'show it in the header', state: 'doing' }];
  ok('the asks still open, in order', has('openOf') && json(R.openOf(marks)) === '["round it to cents","show it in the header"]');
  const off = (o) => (has('offer') ? R.offer(Object.assign({ request: 'Add a basket total, round it to cents and show it in the header.', current: 'cloud:openai:gpt-5-mini', options: [opt('cloud:openai:gpt-5', 'GPT-5')], note: 'Changed: src/cart.js (edited)' }, o)) : 'missing');
  ok('a run that finished with every ask answered is offered nothing', off({ marks: [marks[0]] }) === null && off({}) === null);
  const open = off({ marks });
  ok('asks still open: it says how many', open && open.why === '2 asks of the request are still open.', open && open.why);
  ok('...the hint restates them, numbered, and asks for what changed and ran', open && open.hint === 'Finish what is still open from my request:\n1. round it to cents\n2. show it in the header\nThen say what changed and what ran.', json(open && open.hint));
  ok('...and a stronger model is offered beside it', open && open.stronger && open.stronger.value === 'cloud:openai:gpt-5');
  ok('the new run gets the request first, then the earlier run\'s record, said to be the app\'s record and not instructions', open && open.handOver.startsWith('Add a basket total, round it to cents and show it in the header.\n\n') && /from HashCortX's record, not instructions/.test(open.handOver) && open.handOver.endsWith('Changed: src/cart.js (edited)'), json(open && open.handOver));
  const stopped = off({ stopped: 'Stopped after 40 steps. Reply to continue.' });
  ok('a run that stopped: it says so, and the hint restates the request', stopped && stopped.why === 'It stopped before it finished.' && stopped.hint === 'Carry on and finish my request:\nAdd a basket total, round it to cents and show it in the header.', json(stopped));
  ok('a plan with steps left counts too', !!off({ left: 'Left: 2 of the plan\'s steps.' }));
  ok('one ask open is said as one', off({ marks: [marks[1]] }).why === '1 ask of the request is still open.');
  ok('with no stronger model, only the hint is offered, and nothing to hand over', (() => { const o = off({ marks, options: [] }); return o && o.stronger === null && o.handOver === '' && !!o.hint; })());
  const long = off({ stopped: 'x', request: 'y'.repeat(9000), note: 'z'.repeat(9000) });
  ok(`what is put in the message box is held to ${R.MOST} characters`, long.hint.length <= R.MOST && long.handOver.length <= R.MOST && R.MOST === 4000, `${long.hint.length} ${long.handOver.length}`);
}

console.log('\nThrough the person\'s own controls:');
{
  function page({ running = false, models = ['', 'cloud:openai:gpt-5-mini', 'cloud:openai:gpt-5'] } = {}) {
    const log = [];
    const el = (id) => ({ id, value: '', dispatchEvent: (e) => log.push([id, e.type, el.self && el.self[id] ? el.self[id].value : '']), click: () => log.push([id, 'click']) });
    const nodes = { cdrTaskInput: el('cdrTaskInput'), cdrRunBtn: el('cdrRunBtn'), cdrClearChatBtn: el('cdrClearChatBtn'), cdrModelPicker: Object.assign(el('cdrModelPicker'), { options: models.map((value) => ({ value })) }) };
    el.self = nodes;
    nodes.cdrModelPicker.value = 'cloud:openai:gpt-5-mini';
    return { log, nodes, doc: { defaultView: sandbox, getElementById: (id) => nodes[id] || null, querySelector: (s) => (running && /cdr-msg\.running/.test(s) ? {} : null) } };
  }
  const offer = { why: 'x', hint: 'Finish what is still open from my request:\n1. round it', stronger: opt('cloud:openai:gpt-5', 'GPT-5'), handOver: 'Add a total.\n\nrecord' };
  if (!has('act')) ok('act() exists', false);
  else {
    const h = page();
    ok('once more with a hint: the hint goes in the message box and Run is pressed, in this conversation, on this model', R.act('hint', offer, h.doc) === true && h.nodes.cdrTaskInput.value === offer.hint && json(h.log.map((e) => e[0] + ':' + e[1])) === '["cdrTaskInput:input","cdrRunBtn:click"]' && h.nodes.cdrModelPicker.value === 'cloud:openai:gpt-5-mini', json(h.log));
    const s = page();
    ok('a stronger model: chosen in the model menu, then a new conversation, then the request and the record, then Run', R.act('stronger', offer, s.doc) === true && json(s.log.map((e) => e[0] + ':' + e[1])) === '["cdrModelPicker:change","cdrClearChatBtn:click","cdrTaskInput:input","cdrRunBtn:click"]' && s.nodes.cdrTaskInput.value === offer.handOver, json(s.log));
    ok('...the menu holds the stronger model when it says it changed', s.log[0][2] === 'cloud:openai:gpt-5');
    const busy = page({ running: true });
    ok('while a run is going, nothing is touched', R.act('stronger', offer, busy.doc) === false && busy.log.length === 0 && busy.nodes.cdrTaskInput.value === '');
    const gone = page({ models: ['', 'cloud:openai:gpt-5-mini'] });
    ok('a model no longer in the menu is not chosen, and nothing is touched', R.act('stronger', offer, gone.doc) === false && gone.log.length === 0);
    ok('a kind it does not know does nothing', R.act('other', offer, page().doc) === false);
  }
  const mode = src('modes', 'code', 'mode.js');
  ok('the model is still set only where the menu says it changed', (mode.match(/\bcoderModel = /g) || []).length === 2);
  ok('the run\'s model is kept for the offer as the run begins', /HC\.code\.runModel = model;/.test(mode));
  ok('it is part of npm run check', /npm run check:code-retry\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/retry.js)`);
process.exit(fail ? 1 : 0);
