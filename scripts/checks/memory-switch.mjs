// ==============================================================
// The switch for long-term memory — checks
//
// Long-term memory is facts about the person, saved from what they write and
// sent with their requests, to cloud models too. Two switches govern it: the
// one in Settings > Memory, for the whole app, and HashCoder's own, which is
// off until it is turned on. These load the REAL src/core/memory/store.js and
// platform/tauri/hashcoder.js and hold that, while a switch is off, nothing is
// saved from what is written, nothing remembered reaches a model, and the
// facts already kept stay where the person can see them.
//
// Run with: npm run check:memory-switch
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function store() {
  const items = new Map();
  const localStorage = { getItem: (k) => (items.has(k) ? items.get(k) : null), setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k) };
  const sandbox = { window: {}, localStorage, console };
  sandbox.window.localStorage = localStorage;
  vm.createContext(sandbox);
  vm.runInContext(src('js', 'memory.js'), sandbox, { filename: 'memory.js' });
  sandbox.HCMemory = sandbox.window.HCMemory;
  vm.runInContext(src('core', 'memory', 'store.js'), sandbox, { filename: 'store.js' });
  return sandbox.window.HCMemoryStore;
}

console.log('The switch for the whole app:');
{
  const S = store();
  ok('on until it is switched off', S.memOn() === true);
  S.memAutoExtract('My name is Rowan and I work at a bakery.');
  const kept = S.memLoad().length;
  ok('on, what is written is remembered and found again', kept > 0 && S.memRecall('name', 4).length > 0 && S.memRecent(5).length > 0);
  S.setMemOn(false);
  ok('off, it says so', S.memOn() === false);
  ok('off, nothing remembered is handed out for a model', S.memRecall('name', 4).length === 0 && S.memRecent(12).length === 0 && S.lastRecalledIds().length === 0);
  ok('off, nothing is saved from what the person writes, or from a reply', S.memAutoExtract('My name is Elin and I live in Lisbon.').length === 0 && S.memAutoExtractFromAssistant('Got it, I will remember you live in Oslo.').length === 0 && S.memLoad().length === kept);
  ok('off, the facts already kept stay, for the person to read or delete', S.memLoad().length === kept);
  ok('off, the person can still add one by hand in Settings', S.memAdd('favourite_editor', 'a plain one').ok === true);
  S.setMemOn(true);
  ok('on again, it is used again', S.memRecall('name', 4).length > 0);
}

console.log('\nEverything that hands memory to a model goes through it:');
{
  const app = src('js', 'app.js');
  ok('the recent facts chat adds are the store\'s, which gives none while it is off', !/memLoad\(\)\.slice\(/.test(app) && (app.match(/window\.HCMemoryStore\.memRecent\(\d+\)/g) || []).length === 3);
  ok('the agents\' tool that saves a fact refuses while it is off', /return window\.HCMemoryStore\.memOn\(\) \? memAdd\(key, value\) : \{ ok: false, error: "Long-term memory is switched off in Settings, so nothing was saved\." \};/.test(app));
  const panel = src('core', 'settings', 'panel.html');
  const pane = src('core', 'settings', 'memory-pane.js');
  ok('Settings > Memory has the switch, and it reads and writes the store\'s', /id="memOnToggle"/.test(panel) && /onToggle\.checked = memOn\(\);/.test(pane) && /setMemOn\(onToggle\.checked\)/.test(pane));
  ok('the page says where memory goes: chats and agents, cloud models too, and HashCoder only by its own switch', /to local and cloud models alike\. HashCoder uses it only when its own switch is on\./.test(panel));
}

console.log('\nHashCoder\'s own switch, off until it is turned on:');
{
  const sandbox = { window: {}, console, setTimeout, clearTimeout };
  sandbox.HC = sandbox.window.HC = {};
  sandbox.window._H = { memAdd: () => ({ ok: true }), memRecall: () => [{ key: 'name', value: 'x', ts: 0 }] };
  vm.createContext(sandbox);
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), sandbox, { filename: 'hashcoder.js' });
  const HC = sandbox.window.HC;
  const tool = (n) => HC.code.TOOL_DEFINITIONS.find((t) => t.name === n);
  ok('with it off, the tools refuse to save or recall', tool('remember_fact').fn({ key: 'a', value: 'b' }).ok === false && tool('recall_facts').fn({ query: '' }).ok === false);
  HC.code.memoryOn = true;
  ok('with it on, they work', tool('remember_fact').fn({ key: 'a', value: 'b' }).ok === true && tool('recall_facts').fn({ query: '' }).facts.length === 1);
  ok('the instructions mention memory only while it is on', !/remember_fact/.test(HC.code.promptFor('full', false)) && /remember_fact/.test(HC.code.promptFor('full', true)));
  const mode = src('modes', 'code', 'mode.js');
  ok('a request saves nothing to memory and carries no remembered facts unless it is on', /if \(cdrPrefs\(\)\.memory === true\) \{ try \{ window\._H\?\.memAutoExtract\?\.\(task\); \} catch \{\} \}/.test(mode) && /facts: cdrPrefs\(\)\.memory !== true \? \[\] :/.test(mode));
  ok('the run knows the switch, and is not offered the memory tools without it', /HC\.code\.memoryOn = cdrPrefs\(\)\.memory === true;/.test(mode) && /\(HC\.code\.memoryOn \|\| !\/\^\(remember_fact\|recall_facts\)\$\/\.test\(t\.function\.name\)\)/.test(mode));
  ok('the switch is in Settings under HashCoder, off by default, and changing it rewrites the instructions', /id="cdrSetMemory" class="check-box" \/>/.test(src('core', 'settings', 'panel.html')) && /memEl\.checked = prefs\.memory === true;/.test(mode) && /cdrSavePrefs\(\{ memory: memEl\.checked \}\); if \(conversationMsgs\[0\]\?\.role === 'system'\) conversationMsgs\[0\] = systemTurn\(\);/.test(mode));
  ok('this check is part of npm run check', /npm run check:memory-switch/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (long-term memory switches)`);
process.exit(fail ? 1 : 0);
