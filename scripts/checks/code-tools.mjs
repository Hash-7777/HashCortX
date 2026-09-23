// ============================================================
// The Coder's tools as a model is offered them —
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
  const optional = ['reason', 'cwd', 'file_ext'];
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

console.log(`\n${pass} passed, ${fail} failed  (src/platform/tauri/hashcoder.js toolList)`);
process.exit(fail ? 1 : 0);
