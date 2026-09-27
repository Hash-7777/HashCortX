// ============================================================
// The Coder's tools as a model is offered them, and where its commands run —
// src/platform/tauri/hashcoder.js toolList. Run with: npm run check:code-tools
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sandbox = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set };
sandbox.HC = sandbox.window.HC = {};
vm.createContext(sandbox);
vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), sandbox, { filename: 'hashcoder.js' });
const HC = sandbox.window.HC;

console.log('The tool list:');
{
  const list = HC.code.toolList();
  ok('one entry for each tool the Coder has, in order', list.length === HC.code.TOOL_DEFINITIONS.length && list.every((t, i) => t.type === 'function' && t.function.name === HC.code.TOOL_DEFINITIONS[i].name));
  const read = list.find((t) => t.function.name === 'read_file');
  ok('a tool keeps its own description', read.function.description === HC.code.TOOL_DEFINITIONS.find((t) => t.name === 'read_file').description);
  const withText = HC.code.TOOL_DEFINITIONS.find((t) => Object.values(t.parameters).some((v) => typeof v === 'string'));
  const [key, said] = Object.entries(withText.parameters).find(([, v]) => typeof v === 'string');
  ok('an argument given as a sentence is a string argument with that description', JSON.stringify(list.find((t) => t.function.name === withText.name).function.parameters.properties[key]) === JSON.stringify({ type: 'string', description: said }));
  const withSchema = HC.code.TOOL_DEFINITIONS.find((t) => Object.values(t.parameters).some((v) => v && typeof v === 'object' && v.type));
  if (withSchema) {
    const [k, v] = Object.entries(withSchema.parameters).find(([, x]) => x && typeof x === 'object' && x.type);
    ok('an argument given as a schema is kept as it is', JSON.stringify(list.find((t) => t.function.name === withSchema.name).function.parameters.properties[k]) === JSON.stringify(v));
  }
  const optional = ['reason', 'cwd', 'file_ext', 'start_line', 'end_line', 'edits', 'replace_whole', 'count'];
  ok('every argument is required but the ones optional by name', list.every((t) => {
    const def = HC.code.TOOL_DEFINITIONS.find((d) => d.name === t.function.name);
    return t.function.parameters.required.join() === Object.keys(def.parameters).filter((k) => !optional.includes(k)).join();
  }));
}

console.log('\nThe Coder uses it, in one place:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('both of its loops take the list from here', /const buildLegacyTools = \(\) => HC\?\.code\?\.toolList\?\.\(\) \|\| \[\];/.test(mode) && /const buildTools = buildLegacyTools;/.test(mode));
  ok('no copy of it is left in the Coder', !/Object\.entries\(t\.parameters\)/.test(mode));
}

console.log('\nA small local model:');
{
  const names = HC.code.TOOL_DEFINITIONS.map((t) => t.name);
  ok('every tool it is offered exists', HC.code.SMALL_MODEL_TOOLS.every((n) => names.includes(n)));
  ok('it can read, find, edit, create and run', ['read_file', 'grep_code', 'patch_file', 'write_file', 'shell_run'].every((n) => HC.code.SMALL_MODEL_TOOLS.includes(n)));
  const named = [...HC.code.SMALL_MODEL_PROMPT.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]).filter((n) => names.includes(n));
  ok('its instructions name no tool it is not given', named.length > 0 && named.every((n) => HC.code.SMALL_MODEL_TOOLS.includes(n)), named.join());
  ok('its instructions carry the rule about text from tools', HC.code.SMALL_MODEL_PROMPT.includes(HC.code.TOOL_TEXT_RULE));
  const mode = src('modes', 'code', 'mode.js');
  ok('the Coder gives it only those tools and those instructions', /HC\.code\.SMALL_MODEL_TOOLS\.includes/.test(mode) && /sharedState\.small \? HC\?\.code\?\.SMALL_MODEL_PROMPT/.test(mode));
  ok('a cloud model is never treated as small', /\/\^cloud:\/\.test\(model\) \? null/.test(mode));
}

console.log('\nWhere a command runs:');
{
  const asked = [];
  const sent = [];
  HC.guard = { request: async (action, target) => { asked.push(target); return true; }, projectRoot: () => '/work/app' };
  HC.invoke = async (cmd, args) => { sent.push(args); return { stdout: '', stderr: '', code: 0 }; };
  await HC.code.shellRun('npm', ['test']);
  ok('a command given no folder runs in the open project', sent[0].cwd === '/work/app', JSON.stringify(sent[0]));
  ok('and the question names that folder', asked[0] === 'npm test (in /work/app)', asked[0]);
  await HC.code.shellRun('npm', ['test'], '/work/app/pkg');
  ok('a folder the agent names is kept', sent[1].cwd === '/work/app/pkg');
  HC.guard.projectRoot = () => null;
  await HC.code.shellRun('ls', []);
  ok('with no project open, none is made up', sent[2].cwd === null && asked[2] === 'ls');
  await HC.code.shellRun('npm test', []);
  ok('a whole line written as the command is split into program and arguments', sent[3].command === 'npm' && JSON.stringify(sent[3].args) === '["test"]');
  await HC.code.shellRun('git commit -m "two words"');
  ok('quotes keep a spaced argument whole', JSON.stringify(sent[4].args) === '["commit","-m","two words"]');
  let refused = '';
  try { await HC.code.shellRun('cat a.txt | grep x', []); } catch (e) { refused = String(e.message); }
  ok('a line that needs a shell is refused, saying what to do', /not a shell line/.test(refused) && sent.length === 5);
  ok('a wildcard or a variable needs a shell too', HC.code.splitCommandLine('ls *.js') === null && HC.code.splitCommandLine('echo $HOME') === null);
  ok('on Windows a backslash separates folders', JSON.stringify(HC.code.splitCommandLine('python C:\\proj\\test.py', { windows: true })) === '["python","C:\\\\proj\\\\test.py"]');
  ok('elsewhere a backslash is an escape, which needs a shell', HC.code.splitCommandLine('python C:\\proj\\test.py') === null);
  ok('on Windows %NAME% is a variable, which needs a shell', HC.code.splitCommandLine('echo %PATH%', { windows: true }) === null);
  HC.code.platform = { os: 'windows' };
  HC.guard.projectRoot = () => 'C:\\work\\app';
  await HC.code.shellRun('node test\\run.js');
  ok('the app reads a Windows line as Windows does', sent[5].command === 'node' && JSON.stringify(sent[5].args) === '["test\\\\run.js"]', JSON.stringify(sent[5]));
  delete HC.code.platform;
}

console.log('\nReal photographs of a site\'s subject:');
{
  const box = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, setTimeout, clearTimeout, AbortController, encodeURIComponent };
  box.HC = box.window.HC = {};
  let asked = [];
  let answer = [];
  box.fetch = async (url) => { asked.push(String(url)); return { ok: true, json: async () => ({ results: answer }) }; };
  vm.createContext(box);
  vm.runInContext(src('js', 'swarm', 'photos.js'), box, { filename: 'photos.js' });
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), box, { filename: 'hashcoder.js' });
  const tool = box.window.HC.code.TOOL_DEFINITIONS.find((t) => t.name === 'find_photos');
  ok('HashCoder has a tool for them', !!tool && /Openverse/.test(tool.description) && /credit/.test(tool.description));
  const photo = (n) => ({ url: `https://live.example.org/p${n}.jpg`, title: `Diamond ring ${n}`, creator: 'A. Maker', license: 'by', license_version: '2.0', width: 1600, height: 1000, foreign_landing_url: `https://example.org/photo/${n}` });
  answer = [photo(1), photo(2), photo(3)];
  box.window.HCSwarmPhotos.allowed = () => true;
  const found = JSON.parse(await tool.fn({ subject: 'diamond ring', count: 2 }));
  ok('it searches for the subject alone, and returns the photos asked for with their credit and page',
    asked.length === 1 && /q=diamond%20ring/.test(asked[0]) && found.photos.length === 2
    && found.photos[0].url === 'https://live.example.org/p1.jpg' && /by A\. Maker \(CC BY 2\.0\)/.test(found.photos[0].credit) && found.photos[0].page === 'https://example.org/photo/1');
  ok('and says they are to be used exactly and credited', /exactly/.test(found.note) && /Credit each one/.test(found.note));
  answer = [];
  const none = JSON.parse(await tool.fn({ subject: 'xyzzy plugh' }));
  ok('with none found, it says to draw the imagery and write no address', none.photos.length === 0 && /write no image address/.test(none.note));
  box.window.HCSwarmPhotos.allowed = () => false;
  asked = [];
  const off = JSON.parse(await tool.fn({ subject: 'diamond ring' }));
  ok('with the setting off or Local only on, nothing is searched', asked.length === 0 && off.photos.length === 0 && /off in Settings/.test(off.note));
  const prompt = box.window.HC.code.SYSTEM_PROMPT;
  ok('the instructions send a site that shows its subject to it, and name the image hosts that are gone', /find_photos\(subject\)/.test(prompt) && /via\.placeholder\.com and source\.unsplash\.com no longer serve images/.test(prompt));
  ok('a small model is not offered it', !box.window.HC.code.SMALL_MODEL_TOOLS.includes('find_photos'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/hashcoder.js toolList)`);
process.exit(fail ? 1 : 0);
