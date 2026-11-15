// ==============================================================
// The person's own folders are not looked through unasked — checks
//
// Loads the real src/js/code/private-places.js and holds it to its rule: a
// home folder, the folders a system keeps a person's files in and the
// folder of every account are not listed or searched unless the request
// asks in words; a place inside one of them, the open project, and a
// request that asks are let through. Then a run in the real loop.
//
// The homes here are invented.
//
// Run with: npm run check:code-private
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${String(detail).slice(0, 300)}` : ''}`); }
}

const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(src('js', 'code', 'private-places.js'), box, { filename: 'private-places.js' });
const P = box.HCCodePrivate;

const HOME = '/home/sam';
const MAKE = 'make a folder on the desktop called harbour site and build a portfolio in it';
const call = (name, args) => ({ name, arguments: args });
const refused = (c, o = {}) => !!P.refuse(c, { request: MAKE, home: HOME, root: '', ...o });

console.log('Not looked through unasked:');
ok('listing the whole Desktop to make a folder on it', refused(call('shell_run', { command: 'ls', args: ['-la', '/home/sam/Desktop'] })));
ok('...written with ~ or $HOME', refused(call('shell_run', { command: 'ls', args: ['~/Desktop'] })) && refused(call('shell_run', { command: 'ls', args: ['$HOME/Desktop/'] })));
ok('...or by list_dir, a file search or a text search', refused(call('list_dir', { dir: '/home/sam/Desktop' })) && refused(call('fuzzy_find', { dir: '/home/sam/Desktop', query: 'cv' })) && refused(call('grep_code', { dir: '/home/sam/Documents', pattern: 'x' })));
ok('the home folder itself, and the folder of every account', refused(call('list_dir', { dir: '/home/sam' })) && refused(call('shell_run', { command: 'ls', args: ['/Users'] })) && refused(call('shell_run', { command: 'find', args: ['/home/sam', '-name', '*.pdf'] })));
ok('...a home folder known only by its shape, on another system', refused(call('list_dir', { dir: 'C:\\Users\\sam\\Downloads' }), { home: '' }));
ok('a listing command with no place, run from the home folder', refused(call('shell_run', { command: 'ls', args: [], cwd: '/home/sam' })));
const said = JSON.parse(P.refuse(call('shell_run', { command: 'ls', args: ['/home/sam/Desktop'] }), { request: MAKE, home: HOME }).result).error;
ok('the answer says why and how to do the task without looking: mkdir with the whole path, or ask first', /names of their private files/.test(said) && /mkdir/.test(said) && /ask the person first/.test(said), said);

console.log('\nLet through:');
ok('the folder the request makes on the Desktop, and a project inside it', !refused(call('list_dir', { dir: '/home/sam/Desktop/harbour site' })) && !refused(call('shell_run', { command: 'ls', args: ['/home/sam/Desktop/harbour site/src'] })));
ok('making the folder, which is not a listing', !refused(call('shell_run', { command: 'mkdir', args: ['-p', '/home/sam/Desktop/harbour site'] })));
ok('a request that asks to see the Desktop', !refused(call('shell_run', { command: 'ls', args: ['/home/sam/Desktop'] }), { request: 'list all the files on my desktop' }) && !refused(call('list_dir', { dir: '/home/sam/Downloads' }), { request: 'organise my downloads folder' }));
ok('...but asking about the Desktop is not asking about Documents', refused(call('list_dir', { dir: '/home/sam/Documents' }), { request: 'list all the files on my desktop' }));
ok('a request that names the Desktop without asking to look is not asking', refused(call('list_dir', { dir: '/home/sam/Desktop' }), { request: 'put the new page on my desktop' }));
ok('the very folder the person opened as the project', !refused(call('list_dir', { dir: '/home/sam/Desktop' }), { root: '/home/sam/Desktop' }));
ok('reading one file, and any tool that does not look through a folder', !refused(call('read_file', { path: '/home/sam/Desktop/notes.txt' })) && !refused(call('shell_run', { command: 'npm', args: ['test'], cwd: '/home/sam' })));
ok('a folder of the person\'s own making under the home folder, such as one for code', !refused(call('list_dir', { dir: '/home/sam/code' })));

console.log('\nIn a run:');
{
  const loop = src('js', 'agent-loop.js'), boot = src('boot.js');
  ok('the loop answers such a call before anything runs, with the request, the home folder and the project', /const early = window\.HCCodePrivate\?\.refuse\(call, \{ request: HC\?\.code\?\.request, home: sharedState\.homeDir, root: sharedState\.projectRoot \}\) \|\|/.test(loop));
  ok('it is loaded before the modes', boot.indexOf("'/js/code/private-places.js'") > 0 && boot.indexOf("'/js/code/private-places.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('it is part of npm run check', /npm run check:code-private\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/private-places.js)`);
process.exit(fail ? 1 : 0);
