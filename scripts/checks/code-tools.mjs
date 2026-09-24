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
  const optional = ['reason', 'cwd', 'file_ext', 'start_line', 'end_line', 'edits'];
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
}

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/hashcoder.js toolList)`);
process.exit(fail ? 1 : 0);
