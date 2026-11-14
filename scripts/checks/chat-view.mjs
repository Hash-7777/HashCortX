// ==============================================================
// A chat agent's thinking view, drawn — checks
//
// Loads the real src/js/chat/view.js and holds its pure parts: which
// stations the journey draws, in order; the thinking line with the part
// it names in a strong weight and everything escaped; the map's lines from
// which sources served which part; and which rows a finished reply's foot
// has. Also holds that every mark it draws is drawn on currentColor, that
// its stylesheet uses the shared tokens only and is linked, and that the
// script is loaded. The drawing itself is seen in the real app.
//
// Run with: npm run check:chat-view
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
for (const f of ['fences.js', 'code/asks.js', 'code/verify.js', 'code/facts.js', 'chat/finish.js', 'chat/view-model.js']) vm.runInContext(src('js', ...f.split('/')), sandbox, { filename: f });
try { vm.runInContext(src('js', 'chat', 'view.js'), sandbox, { filename: 'view.js' }); } catch (e) { ok('view.js loads', false, String(e && e.message)); }
const V = sandbox.HCChatView || {};

console.log('\nThe journey:');
{
  const st = (stations) => (typeof V.stationsOf === 'function' ? json(V.stationsOf({ stations })) : null);
  ok('understanding first, writing after what it did', st(['understand', 'search', 'read']) === '["understand","search","read","write"]', st(['understand', 'search', 'read']));
  ok('...checking last, once it happened', st(['understand', 'search', 'check', 'write']) === '["understand","search","write","check"]');
  ok('...whatever order write and check were reached in, and only known stations', st(['understand', 'write', 'work', 'nonsense', 'memory']) === '["understand","work","memory","write"]');
  ok('an answer with no steps is understood, then written', st(['understand']) === '["understand","write"]' && json(V.stationsOf?.(null)) === '["understand","write"]');
}

console.log('\nThe thinking line:');
{
  ok('the part it names is set in a strong weight', V.sayText?.({ say: ['Reading ', { b: 'en.wikipedia.org' }] }) === 'Reading <b>en.wikipedia.org</b>');
  ok('...and everything is escaped, what it names included', V.sayText?.({ say: ['A <i>', { b: '<img src=x onerror=alert(1)>' }] }) === 'A &lt;i&gt;<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  ok('nothing to say is empty', V.sayText?.({}) === '' && V.sayText?.(null) === '');
}

console.log('\nThe map\'s lines:');
{
  ok('each part to each source that served it', json(V.linksOf?.({ parts: [{ by: [0] }, { by: [0, 1] }, { by: [] }] })) === '[[0,0],[1,0],[1,1]]');
  ok('...none when nothing served anything', json(V.linksOf?.({ parts: [{}] })) === '[]' && json(V.linksOf?.(null)) === '[]');
}

console.log('\nThe foot of a finished reply:');
{
  const done = { done: true, stations: ['understand', 'search'], glance: [{}, {}], grounding: { sourced: 2, total: 3 }, sources: [{ n: 1 }], caution: ['020 7946 0555'] };
  ok('at a glance, grounding, sources, caution, and the way back to how it got there, in that order', json(V.footRows?.(done)) === '["glance","grounding","sources","caution","how"]', json(V.footRows?.(done)));
  ok('a reply still working has no foot', json(V.footRows?.({ ...done, done: false })) === '[]');
  ok('one part at a glance is not a panel; no sources numbered, no sources row', json(V.footRows?.({ ...done, glance: [{}], sources: [{}] })) === '["grounding","caution","how"]');
  ok('an answer from what it knows, with no steps, has no foot at all', json(V.footRows?.({ done: true, stations: ['understand'], glance: [], grounding: null, sources: [], caution: [] })) === '[]');
}

console.log('\nA reply\'s steps, as the chat records them:');
{
  const VM = sandbox.HCChatViewModel;
  const a = { view: VM.start('When was it first lit? Who built it? Is it open to visitors?', 0) };
  const note = (type, label, data) => V.note?.(a, type, label, data);
  note('start', 'Agent Researcher started', {});
  note('tool_call', 'wikipedia', { query: 'Larkfield Lighthouse' });
  ok('a tool called is a step', a.view.now === 'search' && /Larkfield Lighthouse/.test(V.sayText(a.view)));
  note('tool_result', 'wikipedia', { results: [{ title: 'L', snippet: 'It was first lit in 1874 and built by the harbour board.', url: 'https://en.wikipedia.org/wiki/L' }] });
  ok('...and what it returned a source', a.view.sources.length === 1);
  note('thinking', 'Step 2'); note('running', 'Reading page: x');
  ok('the chat\'s own status lines are not steps', a.view.now === 'search' && a.view.checks.length === 0);
  note('thinking', 'Sent back: details nothing given or read says');
  ok('an app check-in is', a.view.now === 'check' && a.view.checks.length === 1);
  note('warn', 'Sent back: details nothing given or read says');
  ok('...once, though the chat records it twice', a.view.checks.length === 1);
  V.writing?.(a);
  ok('the answer arriving is writing', a.view.now === 'write');
  a.content = 'It was first lit in 1874 and built by the harbour board.';
  a.viewFacts = { unsourced: [], checked: true };
  V.finish?.(a);
  ok('the run done, the record is finished from the answer and what the checks found', a.view.done === true && a.view.chips.length === 1 && /checked against what it read/.test(V.sayText(a.view)));
  const none = {}; V.note?.(none, 'tool_call', 'wikipedia', {}); V.writing?.(none); V.finish?.(none);
  ok('a reply with no record is left alone', !('view' in none));
}

console.log('\nWhat is said to check, on a model on this computer and in the cloud:');
{
  const VM = sandbox.HCChatViewModel;
  const ASK = 'When was the Eiffel Tower completed, and how tall is it?';
  const WIKI = { results: [{ title: 'Eiffel Tower', snippet: 'The company built the tower from 1887 to 1889. The tower is 330 metres (1,083 ft) tall.', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }] };
  const run = (answer, { result = WIKI, before = [], facts } = {}) => {
    const a = { role: 'assistant', view: VM.start(ASK, 0) };
    V.note?.(a, 'tool_call', 'wikipedia', { query: 'Eiffel Tower' });
    if (result) V.note?.(a, 'tool_result', 'wikipedia', result);
    if (facts) a.viewFacts = facts;
    a.content = answer;
    V.finish?.(a, [...before, { role: 'user', content: ASK }, a]);
    return a;
  };
  const wrong = run('The Eiffel Tower was completed in 1889. It is 324 meters (1,063 feet) tall.');
  ok('with no finishing checks of its own, a figure nothing it read gives is listed to check', json(wrong.view.caution) === json(['324 meters', '1,063 feet']), json(wrong.view.caution));
  ok('...its sentence marked, the other backed', json(wrong.view.chips.map((c) => c.n)) === '[1,"?"]', json(wrong.view.chips));
  ok('...and the answer said to be checked against what it read', /checked against what it read/.test(V.sayText(wrong.view)));
  ok('...what was read is not kept with the reply', !('_read' in wrong));
  const phone = run('It was completed in 1889; call 020 7946 0555 to visit.');
  ok('...and a detail of the kinds the cloud checks hold (a phone number) is listed too', phone.view.caution.includes('020 7946 0555'), json(phone.view.caution));
  ok('an answer whose figures are all in what it read has nothing to check', run('It was completed in 1889 and is 330 metres (1,083 ft) tall.').view.caution.length === 0);
  ok('a figure the person gave, earlier in the conversation, is given', run('Your guide is right: it is 324 metres to the tip.', { before: [{ role: 'user', content: 'My guide says it is 324 metres.' }] }).view.caution.length === 0);
  ok('...but not an app note in the conversation', run('It is 324 metres.', { before: [{ role: 'user', note: true, content: 'Note: 324 metres.' }] }).view.caution.length === 1);
  const none = run('It is 324 metres tall.', { result: null });
  ok('nothing read: nothing is held against the answer, and it is not said to be checked', none.view.caution.length === 0 && !/checked/.test(V.sayText(none.view)));
  const failed = run('It was completed in 1889 and is 324 metres tall.');
  {
    const a = { role: 'assistant', view: VM.start(ASK, 0) };
    V.note?.(a, 'tool_call', 'wikipedia', { query: 'Eiffel Tower' });
    V.note?.(a, 'tool_result', 'wikipedia', WIKI);
    V.note?.(a, 'tool_call', 'fetch_url', { url: 'https://example.org/tower' });
    V.note?.(a, 'tool_result', 'fetch_url', { error: 'Could not read the page about the 324 metres tower.' });
    a.content = 'It was completed in 1889 and is 324 metres tall.';
    V.finish?.(a, [{ role: 'user', content: ASK }, a]);
    ok('an error from a tool is not something read', json(a.view.caution) === json(['324 metres']) && json(failed.view.caution) === json(['324 metres']), json(a.view.caution));
  }
  const APP_NOTE = (sandbox.HCCodeVerify && sandbox.HCCodeVerify.APP_NOTE) || 'Note from HashCortX, not from the person:';
  ok('...nor a message of the app\'s own, told by its words', run('It is 324 metres.', { before: [{ role: 'user', content: `${APP_NOTE} the tower is 324 metres.` }] }).view.caution.length === 1);
  ok('a detail of those kinds that what it read gives is not listed', run('It was completed in 1889; call 020 7946 0555 to visit.', { result: { results: [{ title: 'Eiffel Tower', snippet: 'Completed in 1889. Visits: 020 7946 0555.', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }] } }).view.caution.length === 0);
  const cloud = run('It was completed in 1889. It is 324 meters tall; call 020 7946 0555.', { facts: { unsourced: [{ shown: '020 7946 0555' }], checked: true } });
  ok('in the cloud, what the finishing checks found is kept, and the figures join it once', json(cloud.view.caution) === json(['020 7946 0555', '324 meters']), json(cloud.view.caution));
  const kept = run('It was completed in 1889. It is 324 meters tall; call 020 7946 0555.', { facts: { unsourced: [], checked: true } });
  ok('...and what they did not find is not looked for again here', json(kept.view.caution) === json(['324 meters']), json(kept.view.caution));
}

console.log('\nWhere the chat uses it (app.js):');
{
  const app = src('js', 'app.js');
  ok('an agent\'s reply gets its record when the agent starts, from the request', /assistant\.view = window\.HCChatViewModel\?\.start\(seedText\); recordAgentEvent\(assistant, "start",/.test(app));
  ok('every step the chat records reaches it', /assistant\.runEvents\.push\(\{ ts: Date\.now\(\), type, label: String\(label \|\| ""\), data \}\); window\.HCChatView\?\.note\(assistant, type, label, data\);/.test(app));
  ok('a reply with a view says nothing in its bubble about each step: the view does', /if \(!assistant\.view\) pulse\(label, agentToolNames\(activeAgent\)\.join\(" · "\)\);/.test(app));
  ok('the first word of the answer is writing', /if \(!assistant\.firstTokenAt\) \{ assistant\.firstTokenAt = Date\.now\(\); window\.HCChatView\?\.writing\(assistant\); \}/.test(app));
  ok('the run done, the record is finished, with the conversation, before anything is added under the answer', /window\.HCChatView\?\.finish\(assistant, state\.messages\); window\.HCChatTrim\?\.tell\(assistant\); window\.HCAgentNotice\?\.add\(activeAgent, assistant\);/.test(app));
  ok('a reply drawn gets its chips, its head and its foot, live or saved', /bubble\.appendChild\(body\); if \(m\.view\) window\.HCChatView\?\.chips\(body, m\.view\);/.test(app) && /wrap\.appendChild\(av\); wrap\.appendChild\(bubble\); window\.HCChatView\?\.mount\(wrap, bubble, m\);\n\s*if \(pendingFoot\)/.test(app));
  ok('the record is kept when the conversation is saved', /view: m\.view \|\| undefined,/.test(app));
}

console.log('\nIts marks and styles:');
{
  const icons = V.ICONS || {};
  ok('every station, and every mark the view uses, is drawn', ['understand', 'search', 'read', 'work', 'memory', 'write', 'check', 'done', 'clock', 'globe', 'unsure', 'glance', 'ground', 'down', 'ring'].every((k) => typeof icons[k] === 'string' && icons[k].includes('<')));
  ok('...as lines on currentColor, never a fill or a colour of its own', Object.values(icons).every((d) => !/fill="|stroke="#|#[0-9a-f]{3,6}\b|rgb/i.test(d)));
  const css = src('css', 'chat-view.css');
  ok('its stylesheet uses the shared tokens, no colour of its own', !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css));
  ok('...moves only by opacity, transform and a line drawing, and stops when less motion is asked for', !/filter|backdrop|box-shadow[^;]*animation/i.test(css) && /prefers-reduced-motion: reduce/.test(css));
  ok('it is linked, and the script loaded after its record', /<link rel="stylesheet" href="\/css\/chat-view\.css"\/>/.test(src('index.html')) && src('boot.js').indexOf('/js/chat/view.js') > src('boot.js').indexOf('/js/chat/view-model.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/view.js)`);
process.exit(fail ? 1 : 0);
