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
