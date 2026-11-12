// ==============================================================
// Which programs this computer has — checks
//
// Loads the real src/js/code/host-tools.js and holds the line a model is
// told for each size, that the names asked are the Rust command's own list,
// that only names on it come back, and where it is wired: asked once a
// session with the platform, said after the platform line, never to a small
// model or in light mode.
//
// Run with: npm run check:host-tools
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = (...p) => readFileSync(join(root, 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(src('js', 'code', 'host-tools.js'), box, { filename: 'host-tools.js' });
const T = box.HCCodeHostTools;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);

console.log('\nThe line a model is told:');
const found = ['python', 'npm', 'git', 'node', 'docker'];
ok('a mid-sized model: the programs here, in a fixed order', T.line(found, 'mid') === '\nPrograms here: git, node, npm, python, docker.', json(T.line(found, 'mid')));
ok('a large or cloud model: the same, and which of the ones models assume are not here', T.line(found, 'full') === '\nPrograms here: git, node, npm, python, docker. Not here: python3, pip, rg, make.', json(T.line(found, 'full')));
ok('a small model, or light mode, is told nothing: it is given no shell', T.line(found, 'small') === '' && T.line(found, 'light') === '');
ok('not known yet, nothing said rather than "nothing here"', T.line(null, 'full') === '' && T.line(undefined, 'mid') === '');
ok('nothing found: said plainly to a large model', T.line([], 'full') === '\nNone of the usual programs was found here. Not here: git, node, npm, python, python3, pip, rg, make.' && T.line([], 'mid') === '');
ok('the same programs always give the same line, whatever order they came in', T.line(['git', 'node'], 'full') === T.line(['node', 'git'], 'full'));

console.log('\nWhat is asked:');
const rust = readFileSync(join(root, 'src-tauri', 'src', 'commands', 'host.rs'), 'utf8');
const rustNames = [...(/pub const NAMES: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust) || [, ''])[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok('the names asked are the native command\'s own list, in its order', json([...T.NAMES]) === json(rustNames), json(rustNames));
ok('the native side runs nothing and sends no path back: it looks for files and returns names', !/Command::new|std::process/.test(rust) && /Result<Vec<String>, String>/.test(rust) && /\.map\(String::from\)\.collect\(\)/.test(rust));
ok('on Windows, the store\'s placeholder for Python is not counted as Python', /fn store_stub\(name: &str, dir: &Path\) -> bool/.test(rust) && /\\\\microsoft\\\\windowsapps/.test(rust));
{
  const asks = [];
  const b2 = { console, HC: { invoke: async (name, args) => { asks.push([name, args]); return ['git', 'not-a-program', 'node']; } } };
  b2.window = b2;
  vm.createContext(b2);
  vm.runInContext(src('js', 'code', 'host-tools.js'), b2, { filename: 'host-tools.js' });
  const got = await b2.HCCodeHostTools.ask();
  ok('asked once with the whole list, and only names on it are kept from the answer', asks.length === 1 && asks[0][0] === 'which_programs' && json(asks[0][1].names) === json([...T.NAMES]) && json(got) === '["git","node"]');
  const b3 = { console, HC: { invoke: async () => { throw new Error('no such command'); } } };
  b3.window = b3;
  vm.createContext(b3);
  vm.runInContext(src('js', 'code', 'host-tools.js'), b3, { filename: 'host-tools.js' });
  ok('...and when it cannot be told, nothing is assumed', (await b3.HCCodeHostTools.ask()) === null);
}

console.log('\nWhere it is wired:');
const mode = src('modes', 'code', 'mode.js');
ok('asked once a session, when the platform is read', /sharedState\.platform = info; if \(HC\.code\) HC\.code\.platform = info; window\.HCCodeHostTools\?\.ask\(\)\.then\(\(f\) => \{ sharedState\.hostTools = f; \}\);/.test(mode));
ok('said after the platform line, which is left as it is, and never in light mode', /\(HC\?\.code\?\.platformLine\?\.\(sharedState\.platform\) \|\| ''\) \+ \(window\.HCCodeHostTools\?\.line\(sharedState\.hostTools, sharedState\.size\) \|\| ''\)/.test(mode) && !/HCCodeLight\.SYSTEM[^\n]*HCCodeHostTools/.test(mode));
ok('the native command is registered, and this file may call it', /which_programs,/.test(readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8')) && /\['js\/code\/host-tools\.js', /.test(readFileSync(join(here, 'native-surface.mjs'), 'utf8')));
const boot = src('boot.js');
ok('it is loaded before the modes', boot.indexOf("'/js/code/host-tools.js'") > 0 && boot.indexOf("'/js/code/host-tools.js'") < boot.indexOf("'/modes/boot.js'"));
ok('it is part of npm run check, and of the checks run on Windows', /npm run check:host-tools\b/.test(readFileSync(join(root, 'package.json'), 'utf8')) && /"check:windows": "[^"]*check:host-tools/.test(readFileSync(join(root, 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/host-tools.js)`);
process.exit(fail ? 1 : 0);
