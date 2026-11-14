// ==============================================================
// A notice the app puts under an agent's answer — checks
//
// Loads the real src/js/chat/notice.js and holds how an agent's notice is
// added: by the app, under the finished answer, once, and only under an
// answer that has something in it. A model is never asked to write it, so
// the rule that keeps a model from repeating its instructions cannot take
// it away. Also pins Medical Lexi-Check's notice in app.js, its instructions
// no longer asking for it, a duplicated agent keeping it, and the chat
// adding it after every agent's run.
//
// Run with: npm run check:chat-notice
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

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(src('js', 'chat', 'notice.js'), sandbox, { filename: 'notice.js' }); } catch (e) { ok('notice.js loads', false, String(e && e.message)); }
const N = sandbox.HCAgentNotice || {};
const add = (agent, assistant) => (typeof N.add === 'function' ? N.add(agent, assistant) : null);

console.log('\nAdded under the answer, by the app:');
{
  const agent = { id: 'a', notice: 'Check this with a professional before acting on it.' };
  const a = { content: 'The answer.\n\n' };
  ok('it goes under the answer, in italics, apart from it', add(agent, a) === true && a.content === 'The answer.\n\n*Check this with a professional before acting on it.*', JSON.stringify(a.content));
  ok('once: asked again, it is not added twice', add(agent, a) === false && a.content.split('Check this').length === 2);
  const empty = { content: '   ' };
  ok('not under an answer with nothing in it', add(agent, empty) === false && empty.content === '   ');
  const plain = { content: 'The answer.' };
  ok('an agent with no notice adds nothing', add({ id: 'b' }, plain) === false && add(null, plain) === false && plain.content === 'The answer.');
  ok('nothing to add to is no error', add(agent, null) === false);
}

console.log('\nA copy saved before agents carried a notice:');
{
  const OLD = '*This report is for informational purposes only. Verify with a licensed pharmacist or physician and the usual references before making any medication decisions.*';
  const prompt = `You are a drug check.\n\n**Sources consulted:** [list]\n\n${OLD}`;
  const copy = { id: 'agent_x', builtin: false, name: 'Drug check (copy)', systemPrompt: prompt, tools: ['web_search'] };
  const fixed = typeof N.repair === 'function' ? N.repair(copy) : null;
  ok('its closing sentence leaves its instructions, so nothing strips it from an answer', !!fixed && !/for informational purposes only/.test(fixed.systemPrompt) && /\*\*Sources consulted:\*\* \[list\]$/.test(fixed.systemPrompt), fixed && JSON.stringify(fixed.systemPrompt));
  ok('...and it is given the pharmacist notice instead', !!fixed && fixed.notice === N.PHARMACIST && /licensed pharmacist or physician/.test(N.PHARMACIST || ''));
  ok('...keeping everything else it holds', !!fixed && fixed.id === 'agent_x' && fixed.name === copy.name && JSON.stringify(fixed.tools) === '["web_search"]' && copy.systemPrompt === prompt);
  ok('repairing it again changes nothing', !!fixed && JSON.stringify(N.repair(fixed)) === JSON.stringify(fixed));
  const own = { id: 'agent_y', builtin: false, systemPrompt: 'You check drugs.', notice: 'My own words.' };
  ok('an agent without that sentence is left as it is, notice and all', N.repair?.(own) === own);
  const edited = { id: 'agent_z', builtin: false, systemPrompt: `${prompt}\nAlso check dosages.` };
  ok('a sentence the person reworded is left to them', N.repair?.({ id: 'agent_w', systemPrompt: prompt.replace('informational', 'general') })?.notice === undefined);
  const more = N.repair?.(edited);
  ok('...but one still there word for word, with a line added after it, is repaired and the line kept', !!more && more.notice === N.PHARMACIST && /Also check dosages\.$/.test(more.systemPrompt) && !/for informational purposes only/.test(more.systemPrompt), more && JSON.stringify(more.systemPrompt));
  ok('a copy that already has a notice of its own keeps it', N.repair?.({ ...copy, notice: 'My own words.' })?.notice === 'My own words.');
  ok('a sentence much longer in the middle than the old one is not taken for it', N.repair?.({ id: 'agent_v', systemPrompt: OLD.replace('the usual references', 'x'.repeat(200)) })?.notice === undefined);
  ok('a built-in agent, or nothing, is left as it is', N.repair?.({ builtin: true, systemPrompt: prompt })?.notice === undefined && N.repair?.(null) === null);
  const app = src('js', 'app.js');
  ok('the chat repairs the agents it loads', /arr\.filter\(a => a && typeof a === "object"\)\.map\(\(a\) => window\.HCAgentNotice\?\.repair\(a\) \|\| a\)/.test(app));
  ok('the sentence is matched by its shape: no product is named in the code', !/lexicomp|drugs\.com/i.test(src('js', 'chat', 'notice.js')));
}

console.log('\nMedical Lexi-Check (app.js):');
{
  const app = src('js', 'app.js');
  const at = app.indexOf('id: "builtin_medical_lexi"');
  const def = at > 0 ? app.slice(at, app.indexOf('id: "builtin_ats_auditor"')) : '';
  const notice = (/notice: "([^"]+)"/.exec(def) || [])[1] || '';
  ok('its definition carries a notice telling the person to check with a pharmacist or physician', /licensed pharmacist or physician/.test(notice), notice);
  ok('...which names no product', !!notice && !/lexicomp|drugs\.com/i.test(notice), notice);
  ok('...and is the module\'s, word for word, so a repaired copy gets the same', !!notice && notice === N.PHARMACIST);
  const prompt = (/systemPrompt: `([\s\S]*?)`/.exec(def) || [])[1] || '';
  ok('its instructions no longer ask the model to write it', prompt.length > 500 && !/for informational purposes only/i.test(prompt) && !prompt.includes(notice) && /CRITICAL ALERTS/.test(prompt), String(prompt.length));
  ok('a duplicated built-in agent keeps its notice', /systemPrompt: source\.systemPrompt, tools: \[\.\.\.\(source\.tools \|\| \[\]\)\], \.\.\.\(source\.notice \? \{ notice: source\.notice \} : \{\}\)/.test(app));
  ok('...and keeps it when saved', /tools, \.\.\.\(editingAgent\.notice \? \{ notice: editingAgent\.notice \} : \{\}\)/.test(app));
  ok('the chat adds an agent\'s notice after its run, on every way an agent runs', /window\.HCAgentNotice\?\.add\(activeAgent, assistant\); finishAgentRun\(assistant\);/.test(app));
  const boot = src('boot.js');
  ok('notice.js is loaded before app.js', boot.indexOf('/js/chat/notice.js') > 0 && boot.indexOf('/js/chat/notice.js') < boot.indexOf('/js/app.js'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/notice.js)`);
process.exit(fail ? 1 : 0);
