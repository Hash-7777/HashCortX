// ==============================================================
// A tool call, put right before it runs — checks
//
// Loads the REAL src/js/code/calls.js, src/js/agent-policy.js and the
// HashCoder tools (src/platform/tauri/hashcoder.js), and holds that an
// argument under another usual name reaches the tool, that a call missing
// what it needs is answered with the call written right, that a call is not
// made again the way it already failed, that a read of what has not changed
// and is still shown is answered without reading, and that a failure
// repeated is not counted as progress. The calls of a real run, a folder
// asked for and move_file called six times with the wrong names, are played
// through it.
//
// Run with: npm run check:code-calls
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { console, TextEncoder };
sandbox.window = sandbox;
sandbox.HC = {};
vm.createContext(sandbox);
vm.runInContext(src('js', 'code', 'calls.js'), sandbox, { filename: 'calls.js' });
vm.runInContext(src('js', 'agent-policy.js'), sandbox, { filename: 'agent-policy.js' });
vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), sandbox, { filename: 'hashcoder.js' });
const C = sandbox.HCCodeCalls;
const P = sandbox.HCAgentPolicy;
const tools = sandbox.HC.code.toolList();
const schema = (name) => tools.find((t) => t.function.name === name);

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (v) => JSON.stringify(v);

console.log('Another usual name for an argument reaches the tool:');
{
  const n = C.normalize({ src: '/p/a.txt', dst: '/p/b.txt' }, schema('move_file'));
  ok('"src" and "dst" are read as "from" and "to"', n.args.from === '/p/a.txt' && n.args.to === '/p/b.txt' && !('src' in n.args) && !('dst' in n.args) && n.moved.length === 2, json(n));
  const e = C.normalize({ file_path: '/p/a.js', old_string: 'let a', new_string: 'const a' }, schema('patch_file'));
  ok('"file_path", "old_string" and "new_string" are read as path, search and replace', e.args.path === '/p/a.js' && e.args.search === 'let a' && e.args.replace === 'const a', json(e));
  const w = C.normalize({ path: '/p/a.js', contents: 'x' }, schema('write_file'));
  ok('"contents" is read as content', w.args.content === 'x' && !('contents' in w.args));
  const g = C.normalize({ path: '/p', query: 'TODO' }, schema('grep_code'));
  ok('grep_code given "path" and "query" searches dir for pattern', g.args.dir === '/p' && g.args.pattern === 'TODO', json(g));
  const l = C.normalize({ dir: '/p' }, schema('list_dir'));
  ok('list_dir given "dir" lists path', l.args.path === '/p' && !('dir' in l.args));
  const r = C.normalize({ path: '/p/a.js', offset: 40, limit: 20 }, schema('read_file'));
  ok('a read asked as offset and limit is read from start_line to end_line', r.args.start_line === 40 && r.args.end_line === 59 && !('limit' in r.args), json(r));
  const s = C.normalize({ cmd: 'npm', args: ['test'] }, schema('shell_run'));
  ok('"cmd" is read as command, and "args", which shell_run takes, is left as it is', s.args.command === 'npm' && json(s.args.args) === '["test"]', json(s));
  const wrapped = C.normalize({ arguments: { path: '/p/a.js' } }, schema('read_file'));
  ok('arguments given inside a wrapper the tool does not take are taken out of it', wrapped.args.path === '/p/a.js' && !('arguments' in wrapped.args));
  const both = C.normalize({ from: '/p/a', src: '/p/other', to: '/p/b' }, schema('move_file'));
  ok('a name the call already gives is never replaced', both.args.from === '/p/a' && both.args.src === '/p/other');
  const kept = C.normalize({ path: '/p/a.js', mystery: 1 }, schema('read_file'));
  ok('an argument no alias explains stays where it is', kept.args.mystery === 1 && kept.moved.length === 0);
  ok('a tool with no schema is left alone', json(C.normalize({ src: 'a' }, undefined).args) === '{"src":"a"}');
}

console.log('\nA call missing what it needs, and giving what the tool does not take, is not made:');
{
  const m = C.missing('move_file', { to: '/p/b', dest_dir: '/p' }, schema('move_file'));
  ok('it names what is missing, and what it is', /^move_file was not run: it needs from \(Absolute path of the file as it is now\)/.test(m), m);
  ok('it names what the tool does not take', /it does not take dest_dir\./.test(m), m);
  ok('it shows the call written right', m.includes('Call it as {"from":"…","to":"…"}'), m);
  ok('nothing missing, nothing said', C.missing('move_file', { from: '/a', to: '/b', dest_dir: '/p' }, schema('move_file')) === '');
  ok('a call that only leaves something out is the tool\'s to answer', C.missing('move_file', { to: '/p/b' }, schema('move_file')) === '');
  ok('shell_run given a whole command line goes to the tool, which reads it', C.missing('shell_run', { command: 'npm test' }, schema('shell_run')) === '');
  ok('an empty replace is given, not missing', C.missing('patch_file', { path: '/a', search: 'x', replace: '', note: 1 }, schema('patch_file')) === '');
  ok('optional arguments are never asked for', C.missing('read_file', { path: '/a', note: 1 }, schema('read_file')) === '');
  const optional = { write_file: ['append', 'replace_whole', 'reason'], fetch_url: ['offset'], read_file: ['start_line', 'end_line'] };
  ok('no optional argument is offered as one a tool needs', Object.entries(optional).every(([tool, names]) => names.every((n) => !schema(tool).function.parameters.required.includes(n))),
    JSON.stringify(Object.fromEntries(Object.keys(optional).map((t) => [t, schema(t).function.parameters.required]))));
  const refused = C.memory().before({ id: 'm', name: 'move_file', arguments: { to: '/p/b', dest_dir: '/p' } }, () => true, schema('move_file'));
  ok('the run\'s memory refuses it as a failure, given the tool', refused && refused.ok === false && /needs from/.test(JSON.parse(refused.result).error));
  ok('...and lets an ordinary write through', C.memory().before({ id: 'w', name: 'write_file', arguments: { path: '/p/a.css', content: 'a{}' } }, () => true, schema('write_file')) === null);
}

console.log('\nThe same failure is not made again:');
{
  const mem = C.memory();
  const call = { id: '1', name: 'list_dir', arguments: { path: '/p/missing' } };
  ok('the first time, the call is made', mem.before(call, () => true) === null);
  mem.after(call, json({ error: 'No such file or directory (os error 2)' }), false);
  const again = mem.before({ ...call, id: '2' }, () => true);
  ok('the second time it is answered with its failure, and why it was not made', again && again.ok === false && /No such file or directory \(os error 2\) This exact call failed this way before/.test(JSON.parse(again.result).error), again && again.result);
  ok('a different reason given does not make it a different call', mem.before({ id: '3', name: 'list_dir', arguments: { path: '/p/missing', reason: 'look again' } }, () => true)?.ok === false);
  mem.after({ id: '4', name: 'write_file', arguments: { path: '/p/missing/x.txt' } }, json({ ok: true }), true);
  ok('after a file changes, it may be made again', mem.before({ ...call, id: '5' }, () => true) === null);
  const sh = C.memory();
  sh.after({ id: 'a', name: 'shell_run', arguments: { command: 'npm', args: ['test'] } }, json({ code: 1 }), false);
  ok('a command is left to run again', sh.before({ id: 'b', name: 'shell_run', arguments: { command: 'npm', args: ['test'] } }, () => true) === null);
}

console.log('\nA read of what has not changed, still shown, is not made again:');
{
  const mem = C.memory();
  const read = { id: 'r1', name: 'read_file', arguments: { path: '/p/index.html' } };
  mem.after(read, '<!doctype html>…', true);
  const shownWhole = (id, text) => id === 'r1' && text === '<!doctype html>…';
  const again = mem.before({ ...read, id: 'r2' }, shownWhole);
  ok('it is answered with a line saying it has not changed and is above', again && again.ok && /index\.html has not changed since you read it above \(step 1\)/.test(again.result), again && again.result);
  ok('asked a third time, it is read', mem.before({ ...read, id: 'r3' }, shownWhole) === null);
  const gone = C.memory();
  gone.after(read, '<!doctype html>…', true);
  ok('when the model is no longer shown that read whole, it is read', gone.before({ ...read, id: 'r2' }, () => false) === null);
  const changed = C.memory();
  changed.after(read, '<!doctype html>…', true);
  changed.after({ id: 'p', name: 'patch_file', arguments: { path: '/p/index.html', search: 'a', replace: 'b' } }, json({ ok: true }), true);
  ok('after the file is changed, it is read', changed.before({ ...read, id: 'r2' }, shownWhole) === null);
  const folder = C.memory();
  folder.after({ id: 'l1', name: 'list_dir', arguments: { path: '/p' } }, '[]', true);
  folder.after({ id: 'w', name: 'write_file', arguments: { path: '/p/new.css' } }, json({ ok: true }), true);
  ok('a folder is listed again after a file in it is written', folder.before({ id: 'l2', name: 'list_dir', arguments: { path: '/p' } }, () => true) === null);
  const web = C.memory();
  web.after({ id: 's1', name: 'find_photos', arguments: { subject: 'bakery interior', count: 3 } }, '{"photos":[]}', true);
  web.after({ id: 'w', name: 'write_file', arguments: { path: '/p/index.html' } }, json({ ok: true }), true);
  ok('a search is not run again after a file changes, which does not change its answer', /The same find_photos call ran above/.test(web.before({ id: 's2', name: 'find_photos', arguments: { count: 3, subject: 'bakery interior' } }, () => true)?.result || ''));
  web.after({ id: 'sh', name: 'shell_run', arguments: { command: 'ls' } }, json({ code: 0 }), true);
  const local = C.memory();
  local.after(read, '<!doctype html>…', true);
  local.after({ id: 'sh', name: 'shell_run', arguments: { command: 'npx', args: ['prettier', '--write', '.'] } }, json({ code: 0 }), true);
  ok('after a command, which may have changed any file, files are read again', local.before({ ...read, id: 'r2' }, shownWhole) === null);
}

console.log('\nPart of a file already shown:');
{
  const mem = C.memory();
  const tail = { id: 't1', name: 'read_file', arguments: { path: '/p/style.css', start_line: 1230 } };
  const text = '[style.css: lines 1230-1243 of 1243. The numbers and "| " are not part of the file.]\n1230| left: 0;';
  mem.after(tail, text, true);
  const shown = (id, t) => id === 't1' && t === text;
  ok('a read from a later line to the end is covered by one that went to the end', !!mem.before({ id: 't2', name: 'read_file', arguments: { path: '/p/style.css', start_line: 1240 } }, shown));
  const mem2 = C.memory();
  mem2.after(tail, text, true);
  ok('so is a range inside it', !!mem2.before({ id: 't3', name: 'read_file', arguments: { path: '/p/style.css', start_line: 1240, end_line: 1243 } }, shown));
  const mem3 = C.memory();
  mem3.after(tail, text, true);
  ok('a range reaching before it is read', mem3.before({ id: 't4', name: 'read_file', arguments: { path: '/p/style.css', start_line: 1220 } }, shown) === null);
  const win = C.memory();
  const first = '[style.css: lines 1-200 of 1305. The numbers and "| " are not part of the file. To read on, call read_file with start_line 201.]';
  win.after({ id: 'w1', name: 'read_file', arguments: { path: '/p/style.css' } }, first, true);
  ok('a window that did not reach the end covers no read to the end', win.before({ id: 'w2', name: 'read_file', arguments: { path: '/p/style.css', start_line: 150 } }, () => true) === null);
}

console.log('\nA failure repeated is not progress:');
{
  const seen = new Set();
  const a = { name: 'move_file', arguments: { to: '/d/h' } };
  const b = { name: 'move_file', arguments: { to: '/d/h', from: '' } };
  const failed = (call, error) => new Map([[call, json({ error })]]);
  ok('the first failure of its kind is progress', P.iterationMadeProgress([a], seen, failed(a, 'move_file was not run: it needs from (Absolute path).')));
  ok('failing the same way with other arguments is not', !P.iterationMadeProgress([b], seen, failed(b, 'move_file was not run: it needs from (Absolute path). This call gave to, from.')));
  ok('a different failure is', P.iterationMadeProgress([b], seen, failed(b, 'Permission denied: move /d. The person said no.')));
  ok('without failures, a new write is progress as before', P.iterationMadeProgress([{ name: 'write_file', arguments: { path: '/d/x' } }], seen, new Map()));
}

console.log('\nmove_file refuses a move onto itself or into itself, before asking anyone:');
{
  let asked = 0;
  sandbox.HC.guard = { request: async () => { asked++; return true; } };
  sandbox.HC.code.leaveAlone = () => {};
  const why = async (from, to) => { try { await sandbox.HC.code.moveFile(from, to); return ''; } catch (e) { return String(e.message); } };
  ok('the same path', /from and to are the same path[\s\S]*command "mkdir"/.test(await why('/Users/a/Desktop/h', '/Users/a/Desktop/h/')));
  ok('a folder into a folder inside it', /is inside \/Users\/a\/Desktop, and nothing can be moved into itself/.test(await why('/Users/a/Desktop', '/Users/a/Desktop/h')));
  ok('a missing end shows the call written right', /Call it as \{"from": "…", "to": "…"\}/.test(await why('', '/x')));
  ok('nobody was asked about any of them', asked === 0);
}

console.log('\nA real run played through it: a folder asked for, no project open:');
{
  // The calls a model on this computer made, in the shape it made them, with the names changed.
  const made = [
    { name: 'list_dir', arguments: { path: '/Users/a/Desktop/notes' } },
    { name: 'list_dir', arguments: { path: '/Users/a/Desktop/notes' } },
    { name: 'move_file', arguments: { src: '/Users/a/Desktop/notes', dst: '/Users/a/Desktop/notes' } },
    { name: 'move_file', arguments: { dst: '/Users/a/Desktop/notes', src: '/Users/a/Desktop' } },
    { name: 'move_file', arguments: { dst: '/Users/a/Desktop/notes' } },
    { name: 'move_file', arguments: { dst: '/Users/a/Desktop/notes' } },
    { name: 'move_file', arguments: { dst: '/Users/a/Desktop/notes' } },
  ];
  sandbox.HC.guard = { request: async () => true };
  const mem = C.memory();
  const seen = new Set();
  const told = [];
  let stalled = 0;
  for (const [i, raw] of made.entries()) {
    const call = { id: `c${i}`, name: raw.name, arguments: C.normalize(raw.arguments, schema(raw.name)).args };
    const early = mem.before(call, () => true);
    let result; let good = true;
    if (early) { result = early.result; good = early.ok; }
    else {
      const lack = C.missing(call.name, call.arguments, schema(call.name));
      try {
        if (lack) throw new Error(lack);
        if (call.name === 'list_dir') throw new Error('No such file or directory (os error 2)');
        result = await sandbox.HC.code.moveFile(call.arguments.from, call.arguments.to);
      } catch (e) { result = json({ error: String(e.message) }); good = false; }
      mem.after(call, result, good);
    }
    told.push(JSON.parse(result).error || result);
    stalled = P.iterationMadeProgress([call], seen, good ? new Map() : new Map([[call, result]])) ? 0 : stalled + 1;
  }
  ok('the second, identical listing is not made, and says why', /This exact call failed this way before/.test(told[1]), told[1]);
  ok('"src" and "dst" reach move_file, which says the two are the same and how to make a folder', /same path[\s\S]*mkdir/.test(told[2]), told[2]);
  ok('moving the Desktop into the folder is refused without asking', /nothing can be moved into itself/.test(told[3]), told[3]);
  ok('a call with only "dst" is answered by move_file with the call written right', /needs from, the path as it is now, and to, the path it should have\. Call it as \{"from": "…", "to": "…"\}/.test(told[4]), told[4]);
  ok('the same call again is not made', /This exact call failed this way before/.test(told[5]), told[5]);
  ok('by then the loop counts the run as going round in circles', stalled >= 2, String(stalled));
}

console.log('\nThe loop:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('arguments are put right before the call is saved to the conversation', /c\.arguments = window\.HCCodePaths\.argsFromRoot\(window\.HCCodeCalls\.normalize\(c\.arguments, schemaOf\(c\.name\)\)\.args, sharedState\.projectRoot\)/.test(mode)
    && mode.indexOf('window.HCCodeCalls.normalize(') < mode.indexOf('H.appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls)', mode.indexOf('async function agentLoop')));
  ok('a repeat is answered from what the model is sent, whole, and a call missing what it needs, never a connected system\'s, is refused', /const early = asked\.before\(call, \(id, text\) => compressHistory\(messages\)\.some\(\(m\) => m\.role === 'tool' && m\.tool_call_id === id && m\.content === text\), window\.HCMcp\?\.systemOf\?\.\(call\.name\) \? null : schemaOf\(call\.name\)\);/.test(mode));
  ok('an answer given in place of the call is used as its result, and a refusal is a failure', /const raw = early \? early\.result : await \(def\.fn/.test(mode) && /\|\| \(early && !early\.ok\)\) ok = false;/.test(mode));
  ok('only calls really made are remembered', /if \(!early\) asked\.after\(call, resultStr, ok\);/.test(mode));
  ok('failures go to the progress count', /policy\.iterationMadeProgress\(turn\.tool_calls, seenReadTargets, failures\)/.test(mode) && /if \(!ok\) failures\.set\(call, resultStr\);/.test(mode));
  ok('it loads before the Coder', src('boot.js').indexOf("'/js/code/calls.js'") > 0);
  ok('this check is part of npm run check', /npm run check:code-calls\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/calls.js)`);
process.exit(fail ? 1 : 0);
