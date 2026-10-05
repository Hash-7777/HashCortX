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
  const optional = ['reason', 'cwd', 'file_ext', 'start_line', 'end_line', 'edits', 'replace_whole', 'count', 'all', 'replaces'];
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
  const list = HC.code.toolList();
  ok('the Coder gives it only those tools and those instructions',
    HC.code.toolsFor('small', list, 'a site').map((t) => t.function.name).sort().join() === [...HC.code.SMALL_MODEL_TOOLS].sort().join() && HC.code.promptFor('small') === HC.code.SMALL_MODEL_PROMPT
    && /const own = HC\.code\.toolsFor\(sharedState\.size, buildTools\(\), conversationMsgs\.some\(\(m\) => m\.site\)\)/.test(mode) && /HC\?\.code\?\.promptFor\?\.\(sharedState\.size, cdrPrefs\(\)\.memory === true\)/.test(mode));
  ok('a cloud model is never treated as small', /\/\^cloud:\/\.test\(model\) \? null/.test(mode) && /const size = HC\?\.code\?\.sizeOf\?\.\(info\?\.billions \?\? window\.HCCodeLight\?\.billionsInName\(model\)\) \|\| 'full', light = /.test(mode));
}

console.log('\nThe size of a model decides how HashCoder is set up for it:');
{
  const sizes = [[null, 'full'], [undefined, 'full'], [0, 'full'], [1.5, 'small'], [3.1, 'small'], [4.9, 'small'], [5, 'mid'], [7.6, 'mid'], [14.8, 'mid'], [15, 'full'], [32, 'full']];
  ok('under 5 billion small, under 15 mid-sized, larger or unknown given everything', sizes.every(([b, want]) => HC.code.sizeOf(b) === want),
    sizes.filter(([b, want]) => HC.code.sizeOf(b) !== want).map(([b]) => b).join());
  const list = HC.code.toolList();
  ok('a larger model is offered every tool and the full instructions', HC.code.toolsFor('full', list, '') === list && HC.code.promptFor('full', true) === HC.code.SYSTEM_PROMPT);
  ok('...which mention long-term memory only while HashCoder may use it', !/remember_fact/.test(HC.code.promptFor('full')) && /remember_fact \/ recall_facts/.test(HC.code.promptFor('full', true)) && /REASONING:/.test(HC.code.promptFor('full')));
}

console.log('\nA mid-sized local model:');
{
  const names = HC.code.TOOL_DEFINITIONS.map((t) => t.name);
  const list = HC.code.toolList();
  const offered = (site) => HC.code.toolsFor('mid', list, site).map((t) => t.function.name);
  ok('every tool it is offered exists', HC.code.MID_MODEL_TOOLS.every((n) => names.includes(n)));
  ok('it has a small model\'s tools, and pictures', HC.code.SMALL_MODEL_TOOLS.every((n) => offered('').includes(n)) && offered('').includes('view_image'));
  ok('photographs only when it builds a site', !offered('').includes('find_photos') && offered('BUILDING THIS SITE').includes('find_photos'));
  const prompt = HC.code.promptFor('mid');
  const named = [...prompt.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]).filter((n) => names.includes(n));
  ok('its instructions name no tool it is not given', named.length > 0 && named.every((n) => offered('').includes(n)), named.join());
  ok('its instructions carry the rule about text from tools', prompt.includes(HC.code.TOOL_TEXT_RULE));
  ok('its steps end by checking the request before finishing', /Before you finish, read the request again and make sure every thing it asks for is done/.test(prompt));
  // What it is sent before the request fits the smallest window a local model
  // is given (js/local-context.js) with room to work, as the full set did not.
  const est = (size) => Math.ceil((HC.code.promptFor(size).length + JSON.stringify(HC.code.toolsFor(size, list, '')).length) / 3.2);
  ok('its instructions and tools take under half the smallest window, and under half what a larger model is sent', est('mid') < 4096 && est('mid') < est('full') * 0.5, `${est('mid')} of ${est('full')}`);
}

console.log('\nSmall and mid-sized models write paths from the project folder:');
{
  // A model under about fifteen billion parameters copies a long path from the
  // top of the disk wrongly; "src/app.js" it gets right, and js/code/paths.js
  // writes it out in full before any tool runs.
  const list = HC.code.toolList();
  const places = (tools) => tools.flatMap((t) => Object.entries(t.function.parameters.properties).filter(([k]) => ['path', 'dir', 'from', 'to', 'cwd'].includes(k)).map(([k, v]) => [`${t.function.name}.${k}`, v.description || '']));
  for (const size of ['small', 'mid']) {
    const prompt = HC.code.promptFor(size);
    ok(`the ${size} instructions say to write paths from the project folder`, /Write paths from the project folder: src\/app\.js/.test(prompt) && !/full paths/i.test(prompt));
    const given = HC.code.toolsFor(size, list, 'a site');
    const shown = places(given);
    ok(`no tool offered to a ${size} model describes a place as absolute`, shown.length > 0 && shown.every(([, d]) => !/absolute/i.test(d)), shown.filter(([, d]) => /absolute/i.test(d)).map(([n]) => n).join());
    ok(`and each says where a path starts`, shown.filter(([n]) => !/^(grep_code|fuzzy_find)\./.test(n)).every(([, d]) => /^Project (path|folder)/.test(d)), shown.filter(([, d]) => !/^Project (path|folder)/.test(d)).map(([n]) => n).join());
  }
  const full = HC.code.toolsFor('full', list, '');
  ok('a larger model is left to describe places as they were', full === list && places(full).some(([, d]) => /^Absolute/.test(d)));
  const small = HC.code.toolsFor('small', list, '');
  const byName = new Map(list.map((t) => [t.function.name, t]));
  ok('only the wording changes: every tool keeps its name, arguments, types and which are required',
    small.every((t) => { const o = byName.get(t.function.name); const a = t.function.parameters, b = o.function.parameters;
      return JSON.stringify(Object.keys(a.properties)) === JSON.stringify(Object.keys(b.properties)) && JSON.stringify(a.required) === JSON.stringify(b.required)
        && Object.keys(a.properties).every((k) => a.properties[k].type === b.properties[k].type) && t.function.description === o.function.description; }));
  ok('the tools the app holds are not changed in place', places(list).some(([, d]) => /^Absolute/.test(d)));
  const fetchTool = list.find((t) => t.function.name === 'fetch_url');
  ok('an address is not a path: it is described as it was', !fetchTool || HC.code.shortPlaces([fetchTool])[0].function.parameters.properties.url.description === fetchTool.function.parameters.properties.url.description);
}

console.log('\nThe temperature the agent loop asks for:');
{
  const T = HC.code.temperatureFor;
  ok('a small model is held lowest, a larger one highest', T('small', 1) === 0.1 && T('mid', 1) === 0.2 && T('full', 1) === 0.35);
  ok('the slider is a ceiling and not a wish for more: a lower setting is obeyed', T('small', 0.05) === 0.05 && T('mid', 0.15) === 0.15 && T('full', 0) === 0);
  ok('it is never below nothing', T('small', -3) === 0);
  ok('without a figure the loop asks for 0.15, or the ceiling when that is lower', T('full', undefined) === 0.15 && T('mid', NaN) === 0.15 && T('small', null) === 0.1);
  ok('a size it does not know is held like a larger model', T('huge', 2) === 0.35 && T(undefined, 2) === 0.35);
  const mode = src('modes', 'code', 'mode.js');
  ok('the agent loop asks it, with the size the run was set up for', /const temperature = window\.HC\.code\.temperatureFor\(sharedState\.size, H\?\.selectedTemperature\?\.\(\)\);/.test(mode) && !/Math\.min\(H\.selectedTemperature\(\), 0\.35\)/.test(mode));
}

console.log('\nWhat a search by file name tells the model:');
{
  const found = HC.code.namesFound([{ path: '/p/stats.py', name: 'stats.py', score: 0 }, { path: '/p/tests/test_stats.py', name: 'test_stats.py', score: 2 }, { path: '/p/stat.py', name: 'stat.py', score: 10 }], 'stats.py');
  ok('each file with how its name matches, in words, closest first', found.files.map((f) => f.match).join() === 'the exact name,contains it,a close spelling' && found.files[0].path === '/p/stats.py' && /Closest first/.test(found.note));
  ok('no number a model could read as no match', !JSON.stringify(found).includes('score'));
  const none = HC.code.namesFound([], 'getUsr');
  ok('nothing found: it says the search is by name, and which tool looks inside files', none.files.length === 0 && /No file is named like "getUsr"/.test(none.note) && /grep_code/.test(none.note));
  ok('the tool uses it, and says so in its description', /HC\.code\.namesFound\(await HC\.invoke\('fs_fuzzy_find'/.test(src('platform', 'tauri', 'hashcoder.js'))
    && /names only: to find text inside files, use grep_code/.test(HC.code.TOOL_DEFINITIONS.find((t) => t.name === 'fuzzy_find').description));
}

console.log('\nWhat a search inside the files tells the model:');
{
  const lines = [{ path: '/p/src/billing/tax.js', line_no: 3, line: 'const RATE = 0.14;' }];
  ok('the lines it found, as they came', HC.code.linesFound(lines, 'RATE') === lines);
  const none = HC.code.linesFound([], 'calculateTax');
  ok('nothing found: nothing is known yet, and a shorter word from it to try', none.matches.length === 0
    && /No line in these files contains "calculateTax", so nothing is known about it yet\. Search a shorter word from it, such as "tax" or "calculate", or list_dir the project, before you answer or change anything\./.test(none.note), none.note);
  ok('... or a different word, for a word with no parts', /Search a different word, or list_dir/.test(HC.code.linesFound([], 'tax').note));
  ok('an answer that is not a list is passed on as it is', HC.code.linesFound('error', 'x') === 'error');
  ok('the tool uses it', /return HC\.code\.linesFound\(await HC\.invoke\('fs_grep', \{ dir, pattern, fileExt \}\), pattern\);/.test(src('platform', 'tauri', 'hashcoder.js')));
}

console.log('\nWhich files named in an answer are not there:');
{
  const folders = { '/p/src': [{ name: 'Tax.js' }, { name: 'billing' }], '/p/src/billing': [{ name: 'order.js' }] };
  HC.guard = { allowedWithoutAsking: async (action, target) => target !== '/p/private' };
  HC.invoke = async (cmd, { path }) => { if (!(path in folders)) throw new Error(`No such file or directory: ${path}`); return folders[path]; };
  const missing = await HC.code.notThereOf(['/p/src/tax.js', '/p/src/billing/order.js', '/p/src/calculateTax.js', '/p/lib/x.js', '/p/private/a.js']);
  ok('a file whose folder does not have it, or whose folder is not there', JSON.stringify(missing) === '["/p/src/calculateTax.js","/p/lib/x.js"]', JSON.stringify(missing));
  ok('... names compared without case, as the disk does, and one that cannot be listed without asking left out', !missing.includes('/p/src/tax.js') && !missing.includes('/p/private/a.js'));
}

console.log('\nA path just outside the project:');
{
  const top = { '/work/runs/r3/project': [{ name: 'src', is_dir: true }, { name: 'package.json' }] };
  HC.guard = { projectRoot: () => '/work/runs/r3/project', allowedWithoutAsking: async () => true };
  HC.invoke = async (cmd, { path }) => { if (!(path in top)) throw new Error('No such folder'); return top[path]; };
  ok('the place inside the project it most likely meant, from the first part naming something at the top',
    await HC.code.meant('/work/runs-x/r3/project/src/text.js') === '/work/runs/r3/project/src/text.js' && await HC.code.meant('/tmp/elsewhere/package.json') === '/work/runs/r3/project/package.json');
  ok('none for a path already inside, or one naming nothing the project has', await HC.code.meant('/work/runs/r3/project/src/a.js') === '' && await HC.code.meant('/etc/hosts') === '' && await HC.code.meant('') === '');
  const refusal = await HC.code.refused('write', '/work/runs-x/r3/project/src/text.js');
  ok('a refusal says so, and which path to use', refusal.message === 'Permission denied: write /work/runs-x/r3/project/src/text.js. That is outside the open project. The same place inside it is /work/runs/r3/project/src/text.js: use that path.', refusal.message);
  ok('and is plain when there is nothing to say', (await HC.code.refused('read', '/etc/hosts')).message === 'Permission denied: read /etc/hosts');
  const tools = src('platform', 'tauri', 'hashcoder.js');
  ok('every read, write, listing and search refused says it', (tools.match(/if \(!ok\) throw await HC\.code\.refused\('(?:read|write|list|search)', (?:path|dir)\);/g) || []).length === 8 && !/throw new Error\(`Permission denied: (?:read|write|list|search) /.test(tools));
}

console.log('\nA read of a path with no file:');
{
  const missing = HC.code.notThere(new Error("ENOENT: no such file or directory, stat '/p/range.js'"));
  ok('says how to find the file meant', /no such file[\s\S]*find it by name with fuzzy_find, or list_dir the folder/.test(missing.message));
  ok('... in the words the native side uses too', /fuzzy_find/.test(HC.code.notThere(new Error('No such file or directory (os error 2)')).message));
  const other = new Error('Permission denied: read /p/a.js');
  ok('any other error is passed on as it is', HC.code.notThere(other) === other);
  ok('read_file uses it', /HC\.code\.readFile\(p\.path, p\.start_line \?\? null, p\.end_line \?\? null\)\.catch\(\(e\) => \{ throw HC\.code\.notThere\(e\); \}\)/.test(src('platform', 'tauri', 'hashcoder.js')));
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
  await HC.code.shellRun('mkdir -p', ['/work/factory eyes']);
  ok('a program written with a flag, its other arguments given apart, is split and the flag goes first', sent[5].command === 'mkdir' && JSON.stringify(sent[5].args) === '["-p","/work/factory eyes"]', JSON.stringify(sent[5]));
  await HC.code.shellRun('/Applications/My Tool/bin/tool', ['--version']);
  ok('...while a program named by a path that holds a space is left whole', sent[6].command === '/Applications/My Tool/bin/tool' && JSON.stringify(sent[6].args) === '["--version"]', JSON.stringify(sent[6]));
  sent.splice(5);
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
  const questions = [];
  let allow = true;
  let working = 0;
  box.HC.guard = { request: async (action, target, reason) => { questions.push({ action, target, reason }); return allow; }, busy: () => { working++; return { done: () => { working--; } }; } };
  box.fetch = async (url) => { asked.push(String(url)); return { ok: true, json: async () => ({ results: answer }) }; };
  vm.createContext(box);
  vm.runInContext(src('js', 'swarm', 'photos.js'), box, { filename: 'photos.js' });
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), box, { filename: 'hashcoder.js' });
  const tool = box.window.HC.code.TOOL_DEFINITIONS.find((t) => t.name === 'find_photos');
  ok('HashCoder has a tool for them', !!tool && /Openverse/.test(tool.description) && /credit/.test(tool.description));
  ok('...that asks for the thing itself, never pictures taken with it', /naming the thing itself the page shows or sells: for a shop that sells drones, "quadcopter drone", not pictures taken with one/.test(tool.description));
  const photo = (n) => ({ url: `https://live.example.org/p${n}.jpg`, title: `Diamond ring ${n}`, creator: 'A. Maker', license: 'by', license_version: '2.0', width: 1600, height: 1000, foreign_landing_url: `https://example.org/photo/${n}` });
  answer = [photo(1), photo(2), photo(3)];
  box.window.HCSwarmPhotos.allowed = () => true;
  const found = JSON.parse(await tool.fn({ subject: 'diamond ring', count: 2 }));
  ok('it searches for the subject alone, and returns the photos asked for with their credit and page',
    asked.length === 1 && /q=diamond%20ring/.test(asked[0]) && found.photos.length === 2
    && found.photos[0].url === 'https://live.example.org/p1.jpg' && /by A\. Maker \(CC BY 2\.0\)/.test(found.photos[0].credit) && found.photos[0].page === 'https://example.org/photo/1');
  ok('and says they are to be used exactly and credited', /exactly/.test(found.note) && /Credit each one/.test(found.note));
  ok('the person is asked first, as for a web page, with the words and the host, and the wait shows while it runs',
    questions.length === 1 && questions[0].action === 'fetch' && /^https:\/\/api\.openverse\.org\/v1\/images\/\?q=diamond%20ring/.test(questions[0].target) && /diamond ring/.test(questions[0].reason) && working === 0);
  allow = false; asked = [];
  let refused = '';
  try { await tool.fn({ subject: 'diamond ring' }); } catch (e) { refused = String(e.message); }
  ok('when the person says no, nothing is searched and the model is told so', asked.length === 0 && /^Permission denied: photo search/.test(refused) && working === 0);
  allow = true;
  answer = [];
  const none = JSON.parse(await tool.fn({ subject: 'xyzzy plugh' }));
  ok('with none found, it says to draw the imagery and write no address', none.photos.length === 0 && /write no image address/.test(none.note));
  box.window.HCSwarmPhotos.allowed = () => false;
  asked = [];
  const off = JSON.parse(await tool.fn({ subject: 'diamond ring' }));
  const askedBefore = questions.length;
  ok('with the setting off or Local only on, nothing is searched, and nobody is asked', asked.length === 0 && questions.length === askedBefore && off.photos.length === 0 && /off in Settings/.test(off.note));
  box.window.HCSwarmPhotos.allowed = () => true;
  ok('words that cannot be a search are not asked about or sent', (await tool.fn({ subject: '!!' }), questions.length === askedBefore && asked.length === 0));
  box.window.HCSwarmPhotos.allowed = () => false;
  const prompt = box.window.HC.code.SYSTEM_PROMPT;
  ok('the instructions send a site that shows its subject to it, and name the image hosts that are gone', /find_photos\(subject\)/.test(prompt) && /via\.placeholder\.com and source\.unsplash\.com no longer serve images/.test(prompt));
  ok('a small model is not offered it', !box.window.HC.code.SMALL_MODEL_TOOLS.includes('find_photos'));
}

console.log('\nA web search asks first, for each service it would reach:');
{
  const box = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, setTimeout, clearTimeout, AbortController, encodeURIComponent };
  box.HC = box.window.HC = {};
  const questions = [];
  let allow = true;
  let working = 0;
  box.HC.guard = { request: async (action, target, reason) => { questions.push({ action, target, reason }); return allow; }, busy: () => { working++; return { done: () => { working--; } }; } };
  const sent = [];
  box.fetch = async (url) => { sent.push(String(url)); return { ok: true, json: async () => ({ AbstractText: 'A capybara is a rodent.', Heading: 'Capybara', AbstractURL: 'https://example.org/capybara', RelatedTopics: [] }) }; };
  let keyed = false;
  let tavilyAnswer = [{ title: 'Doc', snippet: 'text', url: 'https://example.org/d' }];
  box.window._H = { tavilyReady: () => keyed, tavilySearch: async () => { sent.push('tavily'); return tavilyAnswer; } };
  vm.createContext(box);
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), box, { filename: 'hashcoder.js' });
  const tool = box.window.HC.code.TOOL_DEFINITIONS.find((t) => t.name === 'web_search');
  const reset = () => { questions.length = 0; sent.length = 0; allow = true; };

  reset();
  const free = JSON.parse(await tool.fn({ query: 'capybara facts' }));
  ok('with no search key, the person is asked about DuckDuckGo, with the words, before anything is sent',
    questions.length === 1 && questions[0].action === 'fetch' && /^https:\/\/api\.duckduckgo\.com\/\?q=capybara%20facts/.test(questions[0].target) && /capybara facts/.test(questions[0].reason) && sent.length === 1 && free.source === 'duckduckgo-instant-answer' && working === 0);

  reset(); keyed = true;
  const viaKey = JSON.parse(await tool.fn({ query: 'rust lifetimes' }));
  ok('with a key set, the question is about Tavily, and the free service is not reached when Tavily answers',
    questions.length === 1 && questions[0].target === 'https://api.tavily.com/search' && /rust lifetimes/.test(questions[0].reason) && viaKey.source === 'tavily' && !sent.some((u) => /duckduckgo/.test(u)) && working === 0);

  reset(); tavilyAnswer = null;
  await tool.fn({ query: 'rust lifetimes' });
  ok('if Tavily gives nothing, DuckDuckGo is a second service and is asked about separately',
    questions.length === 2 && questions[1].target.startsWith('https://api.duckduckgo.com/') && sent.some((u) => /duckduckgo/.test(u)) && working === 0);
  tavilyAnswer = [{ title: 'Doc', snippet: 'text', url: 'https://example.org/d' }];

  reset(); allow = false;
  let refused = '';
  try { await tool.fn({ query: 'rust lifetimes' }); } catch (e) { refused = String(e.message); }
  ok('when the person says no to Tavily, nothing is sent anywhere and the model is told so, not that search is unavailable',
    /^Permission denied: web search/.test(refused) && sent.length === 0 && questions.length === 1 && working === 0);

  reset(); keyed = false; allow = false;
  refused = '';
  try { await tool.fn({ query: 'capybara facts' }); } catch (e) { refused = String(e.message); }
  ok('...and the same for DuckDuckGo', /^Permission denied: web search/.test(refused) && sent.length === 0 && working === 0);

  reset();
  const none = JSON.parse(await tool.fn({ query: '   ' }));
  ok('an empty query asks nothing and sends nothing', !!none.error && questions.length === 0 && sent.length === 0);

  reset();
  const long = 'x'.repeat(300);
  await tool.fn({ query: long });
  ok('a long query is shown cut short in the question but sent whole', questions[0].reason.length < 120 && sent[0].includes('x'.repeat(300)));
  ok('the page says whether a search key is set, so the question names the right service', /tavilyReady: \(\) => !!\(tavilyKeyEl\.value/.test(src('js', 'app.js')));
}

console.log('\nA site HashCoder builds is held to the bar the Swarm\'s are:');
{
  const box = { window: {}, console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set };
  box.HC = box.window.HC = {};
  vm.createContext(box);
  vm.runInContext(src('js', 'swarm', 'web-brief.js'), box, { filename: 'web-brief.js' });
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), box, { filename: 'hashcoder.js' });
  const W = box.window.HCSwarmWebBrief;
  const site = box.window.HC.code.siteBrief('make a website in this folder for a diamond store called luis diamond');
  ok('a request to build a site gets the bar', /^BUILDING THIS SITE/.test(site)
    && ['content', 'identity', 'logo', 'firstScreen', 'works', 'motion', 'scriptClasses'].every((k) => site.includes(W.BAR[k])));
  ok('with photographs from find_photos, credited, and files written with the file tools', /find_photos/.test(site) && /credit each one/.test(site) && /write_file/.test(site) && /patch_file/.test(site));
  ok('and nothing of the Swarm\'s own: no fenced files, no other agents', !/fenced block/.test(site) && !/agent/i.test(site));
  ok('a request that is not for the web gets nothing', box.window.HC.code.siteBrief('rename the helper in utils.py') === '');
  ok('the Swarm\'s brief is built from the same lines', ['content', 'identity', 'logo', 'firstScreen', 'works', 'motion', 'scriptClasses'].every((k) => W.brief({ task: 'a landing page', siteFiles: [] }).includes(W.BAR[k])));
  const mode = src('modes', 'code', 'mode.js');
  ok('HashCoder gives it with such a request, never to a small model',
    /const site = size === 'small' \? '' : \(HC\?\.code\?\.siteBrief\?\.\(task\) \|\| ''\);/.test(mode) && /if \(site\) lines\.push\(String\(site\)\);/.test(src('js', 'code', 'context.js'))
    && /const context = window\.HCCodeTalk\?\.isSmallTalk\(task\) \? null : window\.HCCodeContext\?\.forRequest\(\{ site, activeFile: root && sharedState\.activeFile, facts:/.test(mode) && /\.\.\.\(context \? \{ context \} : \{\}\), \.\.\.\(site \? \{ site: true \} : \{\}\)/.test(mode));
}

console.log('\nThe instructions stay the same from one request to the next:');
{
  const mode = src('modes', 'code', 'mode.js');
  const at = mode.indexOf('    function sysPrompt(extra) {');
  const sys = mode.slice(at, mode.indexOf('\n    }\n', at));
  ok('nothing that belongs to one request is in them', sys.length > 500 && !/memRecall|activeFile|siteBrief|Date\.now|new Date/.test(sys));
  ok('the file open goes with the request, and remembered facts only while HashCoder may use memory', /activeFile: root && sharedState\.activeFile, facts: cdrPrefs\(\)\.memory !== true \? \[\] : \(\(\) => \{ try \{ return window\._H\?\.memRecall\?\.\(task, 4\)/.test(mode));
  ok('a site\'s tools, once offered in a conversation, stay offered', /conversationMsgs\.some\(\(m\) => m\.site\)/.test(mode));
  ok('every model call says the conversation will be sent again', /router\.turn\(\{[^}]*cache: true[^}]*\}\)/.test(mode) && (mode.match(/cache: true/g) || []).length === 1);
}

console.log('\nThe project is known from the start of a conversation:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('its top folder and its notes are read once a project, with its checks', /sharedState\.projectChecks = \{ root, checks, \.\.\.\(await window\.HCCodeContext\?\.readProject\(root, io\)\) \}/.test(mode));
  ok('the top folder is named in the instructions, sized to the model', /window\.HCCodeContext\?\.projectPicture\(known\.entries, sharedState\.size\)/.test(mode));
  ok('the notes go with the instructions for the first request to carry, marked as any material is', /window\.HCCodeContext\.systemTurn\(sysPrompt\(\), sharedState\.projectChecks\?\.root === sharedState\.projectRoot \? sharedState\.projectChecks : null, sharedState\.size, window\.HCSources\?\.mark,/.test(mode));
  ok('every place the instructions are set sets both', !/conversationMsgs\[0\]\.content = sysPrompt\(\)/.test(mode) && (mode.match(/conversationMsgs\[0\] = systemTurn\(\)/g) || []).length === 4 && /conversationMsgs = \[systemTurn\(\)\]/.test(mode));
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/hashcoder.js toolList)`);
process.exit(fail ? 1 : 0);
