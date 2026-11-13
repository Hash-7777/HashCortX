// ==============================================================
// The env_names tool — checks
//
// Loads the real src/platform/tauri/hashcoder.js and src/js/code/git.js and
// holds the tool that tells a model the settings a project's environment
// file names: it asks the native side, which reads the file and keeps every
// value (src-tauri/src/commands/env_names.rs, with its own Rust tests); it
// writes the names with which are empty; and it is offered only where the
// person spoke of the project's settings or secrets.
//
// Run with: npm run check:code-env
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

const sandbox = { console, JSON, Object, Array, String, Number, Math, Promise, Error, Map, Set, RegExp };
sandbox.window = sandbox;
sandbox.HC = {};
vm.createContext(sandbox);
for (const f of [['js', 'model-profile.js'], ['js', 'code', 'paths.js'], ['js', 'code', 'git.js'], ['platform', 'tauri', 'hashcoder.js']]) vm.runInContext(src(...f), sandbox, { filename: f.at(-1) });
const code = sandbox.HC.code;
const ROOT = '/work/harbour-shop';
const asked = [];
sandbox.HC.guard = { projectRoot: () => ROOT };
sandbox.HC.invoke = async (cmd, a) => { asked.push({ cmd, ...a }); return a.path.endsWith('/empty.env') ? [] : [{ name: 'SHOP_TOKEN', empty: false }, { name: 'MAIL_FROM', empty: true }]; };

console.log('The names, never the values:');
{
  const tool = code.TOOL_DEFINITIONS.find((t) => t.name === 'env_names');
  const out = tool ? await tool.fn({}) : '';
  ok('it asks the native side for the project\'s .env, by its place in the project, and nothing else', json(asked) === json([{ cmd: 'env_names', path: `${ROOT}/.env` }]), json(asked));
  ok('...and says each name, which are empty, and that values are never shown', out === '.env names 2 settings; their values are never shown:\nSHOP_TOKEN\nMAIL_FROM (empty)', out);
  asked.length = 0;
  const other = tool ? await tool.fn({ path: 'config/empty.env' }) : '';
  ok('another file, written from the project folder; a file naming none says so', asked[0]?.path === `${ROOT}/config/empty.env` && other === 'empty.env names no setting.', other);
  ok('every value stays in Rust: the tool has no way to read the file itself', !/fs_read_file|readFile\(/.test(String(code.envNames)));
}

console.log('\nOffered only where the person spoke of settings or secrets:');
{
  const list = code.toolList();
  const conv = (...t) => t.map((x) => ({ role: 'user', content: x }));
  const has = (size, c) => code.toolsFor(size, list, '', c).some((t) => t.function.name === 'env_names');
  ok('a request about a page: not offered, at any size', ['small', 'mid', 'full'].every((s) => !has(s, conv('Make a landing page for a bakery'))));
  ok('a request about the .env file or the project\'s secrets: offered, at every size', ['small', 'mid', 'full'].every((s) => has(s, conv('Write a .env.example for this project'))) && has('full', conv('Which environment variables does the mail code need?')) && has('small', conv('Keep the secrets out of the code')));
  ok('its argument is optional', !list.find((t) => t.function.name === 'env_names').function.parameters.required.includes('path'));
  ok('this check is part of npm run check', /npm run check:code-env\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (env_names, platform/tauri/hashcoder.js)`);
process.exit(fail ? 1 : 0);
