// ==============================================================
// Light mode for small models — checks
//
// Loads the REAL src/js/fences.js and src/js/code/light.js. A model of a few
// billion parameters writes whole files in plain text far more reliably than it
// calls tools, so in light mode it is sent no tools and its answer is read for
// FILE blocks and READ lines. These hold that such an answer is read the way a
// model writes it (whatever emphasis it dresses a file name in, one block or
// several, cut off or whole), that what it wrote becomes the calls the app
// already runs, that a file written far shorter than it is gets caught, that
// the conversation is shown back to the model as plain text with no tool call
// in it, and that a model's size is told from its name when nothing better is
// known.
//
// Run with: npm run check:code-light
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {}, JSON, String, Array, Object, Map, Set, Number, RegExp, Error };
vm.createContext(box);
vm.runInContext(src('js', 'fences.js'), box, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'digest.js'), box, { filename: 'digest.js' });
vm.runInContext(src('js', 'code', 'merge.js'), box, { filename: 'merge.js' });
vm.runInContext(src('js', 'code', 'light.js'), box, { filename: 'light.js' });
const L = box.window.HCCodeLight;
const T = '`'.repeat(3);

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('Which models are in light mode:');
{
  ok('a small model, by default', L.applies('small', 'auto') && L.applies('small', undefined) && L.applies('small', 'always'));
  ok('a mid-sized one only when the setting gives it', !L.applies('mid', 'auto') && !L.applies('mid', undefined) && L.applies('mid', 'always'));
  ok('a large one never, and nobody when it is off', !L.applies('full', 'always') && !L.applies('small', 'off') && !L.applies('mid', 'off'));
  const n = L.billionsInName;
  ok('the size is read from a name: a plain count', n('qwen2.5-coder:3b') === 3 && n('llama-3.1-8b-instant') === 8 && n('gemma-3-27b-it') === 27 && n('gpt-oss-20b') === 20);
  ok('...through the provider\'s prefix, and a count with a point', n('cloud:groq:llama-3.2-1b-preview') === 1 && n('cloud:openrouter:meta-llama/llama-3.2-3b-instruct:free') === 3 && n('local:lmstudio:phi-3.5-3.8b') === 3.8);
  ok('...a mixture counts all its experts', n('mixtral-8x7b-instruct') === 56);
  ok('...a name with no size gives none, and a version is not a size', n('nemotron-3-super') === null && n('gpt-4o') === null && n('qwen2.5-coder') === null && n('gemini-3.8-flash') === null && n('') === null && n(null) === null);
  ok('...and a word that merely starts with b after a number is not one', n('llama-3-big') === null && n('model-7beta') === null);
}

console.log('\nReading an answer:');
{
  const one = L.parseReply(`FILE: src/app.js\n${T}js\nconsole.log(1);\n${T}\n\nI printed one.`);
  ok('a file written whole is one write, with its text and a closing newline', one.writes.length === 1 && one.writes[0].path === 'src/app.js' && one.writes[0].content === 'console.log(1);\n');
  ok('what is said besides is kept, and the FILE line is not part of it', one.said === 'I printed one.' && !/FILE/.test(one.said));
  const two = L.parseReply(`I will change two files.\n\nFILE: a.js\n${T}\nA\n${T}\n\nFILE: b/c.css\n${T}css\nB\n${T}\n\nDone.`);
  ok('several files, in the order written', two.writes.map((w) => w.path).join() === 'a.js,b/c.css' && two.writes[1].content === 'B\n');
  ok('...with the sentences before and after kept as said', /^I will change two files\./.test(two.said) && /Done\.$/.test(two.said));
  for (const [label, line] of [['bold', '**FILE: src/x.js**'], ['with the path in backticks', 'FILE: `src/x.js`'], ['lower case', 'file: src/x.js'], ['a heading', '### File: src/x.js'], ['a quoted line', '> FILE: src/x.js'], ['a full stop after it', 'FILE: src/x.js.'], ['a leading dot and slash', 'FILE: ./src/x.js']]) {
    const r = L.parseReply(`${line}\n${T}\nX\n${T}`);
    ok(`the file name is found when it is written ${label}`, r.writes.length === 1 && r.writes[0].path === 'src/x.js', JSON.stringify(r.writes));
  }
  const crlf = L.parseReply(`FILE: a.js\r\n${T}js\r\nline1\r\nline2\r\n${T}\r\n`);
  ok('a Windows line ending does not hide a block', crlf.writes.length === 1 && crlf.writes[0].path === 'a.js' && /line2/.test(crlf.writes[0].content));
  const dup = L.parseReply(`FILE: a.js\n${T}\nfirst\n${T}\nFILE: a.js\n${T}\nsecond\n${T}`);
  ok('the same file written twice keeps the last, once', dup.writes.length === 1 && dup.writes[0].content === 'second\n');
  const bare = L.parseReply(`Here is an example:\n${T}js\nfoo();\n${T}\nUse it like that.`);
  ok('a code block that names no file is something said, not a write', bare.writes.length === 0 && /foo\(\);/.test(bare.said) && /Use it like that\./.test(bare.said));
  const nested = L.parseReply(`FILE: README.md\n${'`'.repeat(4)}\nSome ${T}code${T} in a readme\n${'`'.repeat(4)}`);
  ok('a longer fence holds a block that itself holds fences', nested.writes.length === 1 && /Some ```code``` in a readme/.test(nested.writes[0].content));
  const reads = L.parseReply('I need to see two files.\nREAD: src/a.js\n**READ: `src/b.js`**\nREAD: src/a.js');
  ok('files it asks to see are listed once, in order, and are not part of what it said', reads.reads.join() === 'src/a.js,src/b.js' && reads.said === 'I need to see two files.', JSON.stringify(reads));
  const none = L.parseReply('The tax rate is 14 percent, in src/billing/tax.js.');
  ok('an answer to a question has no writes and no reads', none.writes.length === 0 && none.reads.length === 0 && none.said.includes('14 percent'));
  ok('a path that climbs out of the project is not taken', L.parseReply(`FILE: ../outside.js\n${T}\nx\n${T}`).writes.length === 0 && L.parseReply(`FILE: a/../../b.js\n${T}\nx\n${T}`).writes.length === 0 && L.parseReply(`READ: ../x`).reads.length === 0);
  ok('nothing, or text that is not a string, gives nothing', L.parseReply('').writes.length === 0 && L.parseReply(null).said === '' && L.parseReply(undefined).reads.length === 0);
  ok('an answer cut off inside a block is said to be, and a whole one is not', L.parseReply(`FILE: a.js\n${T}\nhalf a fi`).cut === true && L.parseReply(`FILE: a.js\n${T}\nall of it\n${T}`).cut === false && L.parseReply('plain words').cut === false);

  // A FILE: line with the file under it and no fence.
  const page = L.parseReply('FILE: index.html\n<!DOCTYPE html>\n<html>\n<body>\n  <h1>Pricing</h1>\n</body>\n</html>\n\nThe page was made with a heading and three plans.\n\nFILE: styles.css\nh1 {\n  text-align: center;\n}\n');
  ok('a file written under a FILE: line with no fence is written, each to the next FILE: line',
    page.writes.map((w) => w.path).join() === 'index.html,styles.css' && /^<!DOCTYPE html>\n[\s\S]*<\/html>\n$/.test(page.writes[0].content) && page.writes[1].content === 'h1 {\n  text-align: center;\n}\n', JSON.stringify(page.writes));
  ok('...the sentence after a file is not part of it', !!page.writes[0] && !/three plans/.test(page.writes[0].content));
  const told = L.parseReply('FILE: src/app.js\nI changed the function so that it returns the total.');
  ok('a FILE: line over sentences about the change writes nothing, and the words are kept as said', told.writes.length === 0 && /FILE: src\/app\.js/.test(told.said) && /returns the total/.test(told.said));
  ok('...a sentence that starts with a word code also uses is still a sentence', L.parseReply('FILE: src/app.js\nReturn values are now rounded.\nFrom here the tests pass.').writes.length === 0);
  const notes = L.parseReply('FILE: NOTES.md\nThe release moves to Friday.\n');
  ok('a file of words is written from plain sentences', notes.writes.length === 1 && notes.writes[0].path === 'NOTES.md');
  const py = L.parseReply('FILE: stats.py\ndef mean(values):\n    return sum(values) / len(values)\n');
  ok('a Python file under a FILE: line is written', py.writes.length === 1 && /def mean/.test(py.writes[0].content));
  const mixed = L.parseReply(`FILE: a.js\nconst a = 1;\nmodule.exports = { a };\n\nFILE: b.js\n${T}js\nconst b = 2;\n${T}`);
  ok('a file with no fence and one in a fence after it are both written', mixed.writes.map((w) => w.path).join() === 'a.js,b.js' && /const a = 1;/.test(mixed.writes[0].content) && mixed.writes[1].content === 'const b = 2;\n', JSON.stringify(mixed.writes));
  ok('a FILE: line with no fence that climbs out of the project is not taken', L.parseReply('FILE: ../x.js\nconst x = 1;\n').writes.length === 0);

  // A file asked for by its name alone is the project's one file of that name.
  const known = ['src/limits.js', 'src/a/index.js', 'src/b/index.js', 'README.md'];
  ok('a file asked for without its folder is read as the project\'s one file of that name', L.parseReply('READ: limits.js', { known }).reads.join() === 'src/limits.js');
  ok('...a name two files share, or one the project does not have, is read as written', L.parseReply('READ: index.js\nREAD: new.js', { known }).reads.join() === 'index.js,new.js');
  ok('...and one written with its folder is read as written', L.parseReply('READ: src/limits.js\nREAD: README.md', { known }).reads.join() === 'src/limits.js,README.md');
  ok('...a path that climbs out of the project is still not taken', L.parseReply('READ: ../limits.js', { known }).reads.length === 0);
}

console.log('\nWhat it becomes:');
{
  const parsed = L.parseReply(`FILE: a.js\n${T}\nA\n${T}\nREAD: b.js`);
  const calls = L.callsFor(parsed);
  ok('its files become write_file calls and the files it asked to see read_file calls, files first', calls.map((c) => c.name).join() === 'write_file,read_file' && calls[0].arguments.path === 'a.js' && calls[0].arguments.content === 'A\n' && calls[1].arguments.path === 'b.js');
  // A file that loads itself.
  const wrote = (path, content, current = {}) => L.plan({ writes: [{ path, content, guessed: false }], reads: [], said: '', cut: false }, current);
  const selfJs = wrote('src/clamp.js', "const { clamp } = require('./clamp');\n\nfunction clamp(v, lo, hi) {\n  return Math.min(Math.max(v, lo), hi);\n}\n\nmodule.exports = { clamp };\n");
  ok('a JavaScript file that requires itself is written without that line, and the model is told which',
    selfJs.calls.length === 1 && !/require\('\.\/clamp'\)/.test(selfJs.calls[0].arguments.content) && /^\nfunction clamp/.test(selfJs.calls[0].arguments.content) && /cannot load itself/.test(selfJs.note) && /src\/clamp\.js \(line 1\)/.test(selfJs.note), selfJs.note);
  const selfPy = wrote('stats.py', 'import unittest\nfrom stats import mean, median\n\n\ndef mean(values):\n    return sum(values) / len(values)\n');
  ok('a Python file that imports itself is written without that line, other imports kept', /^import unittest\n\n\ndef mean/.test(selfPy.calls[0].arguments.content) && /stats\.py \(line 2\)/.test(selfPy.note));
  ok('...by its package path or from its own package as well', /line 1, 2/.test(wrote('app/stats.py', 'import app.stats\nfrom .stats import mean\nx = 1\n').note));
  ok('...an import, a folder\'s index and a path that climbs back in all count', /line 1/.test(wrote('src/a.mjs', "import { a } from './a.mjs';\nexport const a = 1;\n").note) && /line 1/.test(wrote('src/util/index.js', "const u = require('../util');\nmodule.exports = {};\n").note) && /line 1/.test(wrote('src/x.js', "require('../src/x');\nmodule.exports = 1;\n").note));
  const others = [
    ['test/clamp.test.js', "const { clamp } = require('../src/clamp');\n"],
    ['src/clamp.js', "const util = require('./clamp-util');\nconst lib = require('clamp');\n"],
    ['tests/test_stats.py', 'from stats import mean\nimport stats\n'],
    ['app/stats.py', 'from other.stats import mean\n'],
    ['src/clamp.js', "module.exports = load(require('./clamp'));\n"],
  ];
  ok('a file loading another of its name, a package, another package\'s module, or itself inside a longer line is left as written',
    others.every(([p, c]) => { const r = wrote(p, c); return r.calls[0].arguments.content === c && !/cannot load itself/.test(r.note); }));
  // A name declared twice.
  const pasted = wrote('src/api.js', "const { getUser } = require('./users');\n\nfunction userResponse(id) {\n  return getUser(id);\n}\n\nfunction getUser(id) {\n  return null;\n}\n\nmodule.exports = { userResponse };\n");
  ok('a file that loads a name and defines it too is not written, and the name and both lines are said',
    pasted.calls.length === 0 && /src\/api\.js was not written: it declares getUser twice \(lines 1 and 7\)/.test(pasted.note) && /Then write src\/api\.js again, whole\./.test(pasted.note), pasted.note);
  const forms = [
    "const a = 1;\nconst a = 2;\n",
    "class A {}\nfunction A() {}\n",
    "import { a } from './x.js';\nexport const a = 1;\n",
    "import b, { c as a } from './x.js';\nlet a = 2;\n",
    "const { x, y: a } = require('./x');\nvar a = 1;\n",
    "export default function a() {}\nconst a = 1;\n",
  ];
  ok('...with a const, a let, a class or an import among them, in each of their forms', forms.every((c) => wrote('src/m.js', c).calls.length === 0), forms.filter((c) => wrote('src/m.js', c).calls.length).join(' | '));
  const allowed = [
    "function a() {}\nfunction a() {}\n",
    "var a = 1;\nvar a = 2;\n",
    "function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a) {}\n",
    "const a = 1;\nfunction g() {\n  const a = 2;\n  return a;\n}\n",
    "const { a } = require('./x');\nconst b = a;\n",
  ];
  ok('...not two functions or two vars, which the language allows, nor a name declared again inside a function', allowed.every((c, i) => wrote(i === 2 ? 'src/m.ts' : 'src/m.js', c).calls.length === 1), allowed.filter((c, i) => !wrote(i === 2 ? 'src/m.ts' : 'src/m.js', c).calls.length).join(' | '));
  ok('...nor a file that is not JavaScript', wrote('stats.py', 'def a():\n    pass\n\ndef a():\n    pass\n').calls.length === 1 && wrote('NOTES.md', 'const a = 1;\nconst a = 2;\n').calls.length === 1);
  // A comment about the rename.
  const rename = { from: 'getUsr', to: 'getUser', file: '' };
  const renamed = (path, content) => L.plan({ writes: [{ path, content, guessed: false }], reads: [], said: '', cut: false }, {}, { rename });
  const users = renamed('src/users.js', "function getUser(id) { // Renamed getUsr to getUser\n  return find(id);\n}\n// Changed getUsr to getUser\nconst url = 'http://x/getUsr'; // getUsr was the old name\nmodule.exports = { getUser };\n");
  ok('a comment about the rename is left out of its line, the code kept, and a comment line on its own goes',
    users.calls[0].arguments.content === "function getUser(id) {\n  return find(id);\n}\nconst url = 'http://x/getUsr';\nmodule.exports = { getUser };\n" && /a comment about the rename named "getUsr" again/.test(users.note) && /src\/users\.js \(line 1, 4, 5\)/.test(users.note), users.calls[0].arguments.content);
  ok('...in Python too', renamed('users.py', 'def get_user(i):  # renamed from getUsr\n    return i\n').calls[0].arguments.content === 'def get_user(i):\n    return i\n');
  const kept = ["const s = '// renamed getUsr to getUser';\n", '// getUsrCount is not the same name, renamed\n', '// Reads the user with this id.\n', '/* Renamed getUsr to getUser */\n'];
  ok('a comment sign inside quoted text, a longer name, a comment that does not name it, and a block comment are left alone',
    kept.every((c) => { const r = renamed('src/a.js', c); return r.calls[0].arguments.content === c && !/rename named/.test(r.note); }));
  ok('...as is every comment when the request renames nothing, and a file that is not code',
    L.plan({ writes: [{ path: 'src/a.js', content: '// Renamed getUsr to getUser\n', guessed: false }], reads: [], said: '', cut: false }, {}).calls[0].arguments.content === '// Renamed getUsr to getUser\n'
    && renamed('NOTES.md', '// Renamed getUsr to getUser\n').calls[0].arguments.content === '// Renamed getUsr to getUser\n');
  ok('the panel passes the request\'s rename to light mode', /rename: window\.HCCodeVerify\?\.renameOf\(window\.HCCodeVerify\.requestIn\(messages\)\)/.test(src('modes', 'code', 'mode.js')));
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const current = { 'big.js': lines(100), 'small.js': lines(10), 'same.js': lines(100) };
  const shorter = L.shrunk([{ path: 'big.js', content: lines(40) }, { path: 'small.js', content: lines(2) }, { path: 'same.js', content: lines(90) }, { path: 'new.js', content: lines(1) }], current);
  ok('a long file written back far shorter is caught; a short one, one kept mostly, and a new one are not', shorter.join() === 'big.js');
}

console.log('\nWhat the model reads back:');
{
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const history = [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'Fix the bug' },
    { role: 'assistant', content: 'Changing it.', tool_calls: [call('1', 'write_file', { path: 'src/a.js', content: 'a\nb\n' }), call('2', 'read_file', { path: 'src/b.js' })] },
    { role: 'tool', tool_call_id: '1', name: 'write_file', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: '2', name: 'read_file', content: 'contents of b' },
    { role: 'assistant', content: '', tool_calls: [call('3', 'shell_run', { command: 'npm', args: ['test'] })] },
    { role: 'tool', tool_call_id: '3', name: 'shell_run', content: 'ok 1 - passes' },
    { role: 'assistant', content: '', tool_calls: [call('4', 'write_file', { path: 'src/c.js', content: 'x' })] },
    { role: 'tool', tool_call_id: '4', name: 'write_file', content: '{"error":"Permission denied: write src/c.js"}' },
    { role: 'assistant', content: 'Done.' },
  ];
  const out = L.callMessages(history);
  ok('no tool call and no tool result is left in what the model reads', out.every((m) => m.role !== 'tool' && !m.tool_calls));
  ok('the system turn and the person\'s own turn are as they were', out[0].content === 'S' && out[1].content === 'Fix the bug');
  ok('its own calls are shown as the text it was told to write: a file whole, a file asked for; a command the app ran is not one of its lines', /FILE: src\/a\.js\n```\na\nb\n```/.test(out[2].content) && /READ: src\/b\.js/.test(out[2].content) && /^Changing it\./.test(out[2].content) && !out.some((m) => m.role === 'assistant' && /RUN|npm test/.test(m.content)));
  ok('results are said by the person: the file written, the file read, the command\'s output, a refusal in words',
    /Wrote src\/a\.js\./.test(out[3].content) && /src\/b\.js:\n```\ncontents of b\n```/.test(out[3].content) && /HashCortX ran npm test:\n```\nok 1 - passes\n```/.test(out.map((m) => m.content).join('\n')) && /That did not work for src\/c\.js: Permission denied: write src\/c\.js/.test(out.map((m) => m.content).join('\n')));
  ok('the results that follow one turn are one note, a command the app ran joins it, and the roles alternate after the person\'s own turn', out.map((m) => m.role).join() === 'system,user,assistant,user,assistant,user,assistant', out.map((m) => m.role).join());
  ok('what is read back parses to the same files that were written', L.parseReply(out[2].content).writes[0].path === 'src/a.js' && L.parseReply(out[2].content).writes[0].content === 'a\nb\n' && L.parseReply(out[2].content).reads[0] === 'src/b.js');
  const tricky = L.callMessages([{ role: 'assistant', content: '', tool_calls: [call('9', 'write_file', { path: 'README.md', content: `Run ${T}npm i${T} first\n` })] }]);
  ok('a file that holds a fence is shown in a longer one, and reads back whole', L.parseReply(tricky[0].content).writes[0].content === `Run ${T}npm i${T} first\n`);
  const long = L.callMessages([{ role: 'assistant', content: '', tool_calls: [call('9', 'read_file', { path: 'big.txt' })] }, { role: 'tool', tool_call_id: '9', name: 'read_file', content: 'x'.repeat(20000) }]);
  ok('a very long result is cut, and says how much', long[1].content.length < 7000 && /\[cut: \d+ more characters\]/.test(long[1].content));
  ok('an empty or missing conversation gives an empty one', L.callMessages([]).length === 0 && L.callMessages(null).length === 0);

  // A command's record is read as text: how it ended, then its own lines.
  const ran = (record) => L.callMessages([{ role: 'assistant', content: '', tool_calls: [call('7', 'shell_run', { command: 'npm', args: ['test'] })] },
    { role: 'tool', tool_call_id: '7', name: 'shell_run', content: JSON.stringify(record, null, 2) }])[0].content;
  const failed = ran({ stdout: 'not ok 1 - range\n  expected: 5\n  actual: 4\n', stderr: '', code: 1, timedOut: false, truncated: false, stopped: false });
  ok('a command\'s record is shown with its exit code and its own line breaks, not as escaped JSON',
    /^HashCortX ran npm test \(exit code 1, it failed\):\n```\nnot ok 1 - range\n  expected: 5\n  actual: 4\n```/.test(failed) && !/\\n|"stdout"/.test(failed));
  ok('a passing run says exit code 0, and the error stream follows the output', /\(exit code 0\):\n```\nok 1\nwarn\n```/.test(ran({ stdout: 'ok 1\n', stderr: 'warn\n', code: 0 })));
  ok('a run out of time says so, and one that printed nothing says that', /\(it ran out of time and was stopped\):\n```\n\(it printed nothing\)\n```/.test(ran({ stdout: '', stderr: '', code: -1, timedOut: true })));
  const passes = Array.from({ length: 400 }, (_, i) => `ok ${i + 1} - case ${i + 1}`).join('\n');
  const buried = ran({ stdout: `${passes}\nnot ok 401 - the one that broke\n# pass 400\n# fail 1\n`, stderr: '', code: 1 });
  ok('a long run keeps its failure and its ending, not only its start', buried.length < 3200 && /not ok 401 - the one that broke/.test(buried) && /# fail 1/.test(buried) && /ok 1 - case 1\n/.test(buried));
  const digest = box.window.HCCodeDigest; box.window.HCCodeDigest = undefined;
  const plainCut = ran({ stdout: `${passes}\n# fail 1\n`, stderr: '', code: 1 });
  box.window.HCCodeDigest = digest;
  ok('without the digest a long run keeps its start and its end', plainCut.length < 3200 && /ok 1 - case 1\n/.test(plainCut) && /# fail 1/.test(plainCut) && /\[cut: \d+ characters\]/.test(plainCut));
  const sentBack = L.callMessages([{ role: 'user', content: 'Fix it' },
    { role: 'user', content: 'Note from HashCortX, not from the person: `npm test` failed after your last change. Read the failure, change the code to fix the cause, and run it again with shell_run: command "npm", args ["test"]; make the fix, do not describe it.', note: true },
    { role: 'assistant', content: '', tool_calls: [call('8', 'shell_run', { command: 'npm', args: ['test'] })] },
    { role: 'tool', tool_call_id: '8', name: 'shell_run', content: JSON.stringify({ stdout: 'not ok 1\n', stderr: '', code: 1 }) }]);
  ok('a note written for a model with tools loses the tool\'s arguments and says commands are run by HashCortX',
    !/shell_run|args \[/.test(sentBack[1].content) && /run it again; make the fix/.test(sentBack[1].content) && /never write a RUN line or what a command printed/.test(sentBack[1].content), sentBack[1].content);
  ok('...and the command HashCortX ran after it joins that note, with no turn of the model\'s between', sentBack.length === 2 && sentBack.map((m) => m.role).join() === 'user,user' && /HashCortX ran npm test \(exit code 1, it failed\)/.test(sentBack[1].content) && !('fromApp' in sentBack[1]));
  ok('a result that is not a command\'s record is shown as it came', /HashCortX ran npm test:\n```\nok 1 - passes\n```/.test(out.map((m) => m.content).join('\n')));
}

console.log('\nWhat it is told:');
{
  ok('the instruction is short, since a small model reads it at every step', L.SYSTEM.length < 1100, String(L.SYSTEM.length));
  ok('...names the two things to write, the rule about paths, tests and questions, and that it calls no tools', /FILE: index\.html/.test(L.SYSTEM) && /READ: /.test(L.SYSTEM) && /A file at its top is written by its name alone/.test(L.SYSTEM) && /When the work is done, answer with that one sentence and no FILE blocks/.test(L.SYSTEM) && /from the project folder/.test(L.SYSTEM) && /Do not change test files/.test(L.SYSTEM) && /Do not add comments saying what you changed/.test(L.SYSTEM) && /Answer a question in plain words/.test(L.SYSTEM) && /do not call tools/.test(L.SYSTEM));
}

console.log('\nWhat the app does with an answer:');
{
  const T = '`'.repeat(3);
  const half = L.parseReply(`I fixed it.\nFILE: a.js\n${T}\nconst a = 1;\n${T}\nFILE: b.js\n${T}\nhalf a fi`);
  ok('a file the answer ended inside is never written, and the answer counts as cut off', half.writes.map((w) => w.path).join() === 'a.js' && half.cut === true);
  const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const p = L.plan(L.parseReply(`FILE: big.js\n${T}\nline 0\n${T}\nFILE: new.js\n${T}\nx\n${T}`), { 'big.js': big });
  ok('a file written much shorter is not written, the rest are, and it is asked for again whole', p.calls.map((c) => c.arguments.path).join() === 'new.js' && /big\.js would have been written much shorter than it is/.test(p.note) && /^Note from HashCortX, not from the person:/.test(p.note));
  ok('a cut-off answer is asked for again, complete', /cut off inside a file/.test(L.plan(half, {}).note));
  ok('a plain answer gives no calls and no note', (() => { const q = L.plan(L.parseReply('It is in src/app.js.'), {}); return q.calls.length === 0 && q.note === ''; })());
}

{
  const T = '`'.repeat(3);
  const again = L.plan(L.parseReply(`Done.\nFILE: a.html\n${T}\n<h1>x</h1>\n${T}`), { 'a.html': '<h1>x</h1>\n' });
  ok('a file written again exactly as it is is not written, so a model that has finished is taken as finished', again.calls.length === 0 && again.note === '');
  const conv = L.callMessages([{ role: 'system', content: 'S' }, { role: 'user', content: 'Make it' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'w1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.html', content: 'x' }) } }, { id: 'w2', function: { name: 'write_file', arguments: JSON.stringify({ path: 'b.css', content: 'y' }) } }] },
    { role: 'tool', tool_call_id: 'w1', content: '{"ok":true}' }, { role: 'tool', tool_call_id: 'w2', content: '{"ok":true}' }]);
  const note = conv[conv.length - 1].content;
  const missing = L.callMessages([{ role: 'user', content: 'Make it' }, { role: 'assistant', content: '', tool_calls: [{ id: 'r1', function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.html' }) } }] },
    { role: 'tool', tool_call_id: 'r1', content: JSON.stringify({ error: "ENOENT: no such file or directory, stat 'a.html'. There is no file at that path: find it by name with fuzzy_find" }) }]);
  ok('a file it asked to see that is not there is said in its own terms: read an existing one by its place, write only a new one, with no tool named', missing[missing.length - 1].content === 'There is no file at a.html. A file already in the project is named by its place in it, its folders included, as the project shows it; READ it by that name before you change it. Only a new file is written whole in a FILE block.');
  const unnamed = L.plan(L.parseReply('Here are the tests:\n```js\ntest(1)\n```\nSave them.'), {});
  ok('code with no file named for it is sent back to be named, not silently dropped', unnamed.calls.length === 0 && /no file was named for it/.test(unnamed.note) && /FILE: followed by the file's path/.test(unnamed.note));
  ok('a plain answer in words is not sent back', L.plan(L.parseReply('It is in src/app.js, line 3.'), {}).note === '');
  const told = L.callMessages([{ role: 'user', content: 'Note from HashCortX, not from the person: make the change now with patch_file.', note: true }]);
  ok('a note from the app, written for a model with tools, is followed by how changes are made here', /Here there are no tools: a file is changed by writing it whole in a FILE block/.test(told[0].content));
  ok('after files are written it is told, once and last, how to say it is done', /Wrote a\.html\.\n\nWrote b\.css\.\n\nWrite a FILE block only for a file that must still change\. If the work is done, answer with one sentence/.test(note) && (note.match(/If the work is done/g) || []).length === 1, note);
}

console.log('\nThe other ways a small model names a file:');
{
  const T = '`'.repeat(3);
  const known = ['src/users.js', 'src/api.js', 'test/users.test.js', 'src/range.js', 'config/app.json', 'timeparse.py'];
  const P = (text, hints = []) => L.parseReply(text, { known, hints });
  const heads = P(`Here are the files:\n\n### src/users.js\n${T}javascript\nfunction getUser() {}\n${T}\n\n### \`src/api.js\`\n${T}js\nconst { getUser } = require('./users');\n${T}`);
  ok('a heading naming one file names the block under it', heads.writes.map((w) => w.path).join() === 'src/users.js,src/api.js' && heads.writes.every((w) => w.guessed));
  const header = P(`=== src/range.js ===\n${T}js\nfunction range() {}\n${T}`);
  ok('the "=== path ===" header the project is shown with names a block, and is no guess', header.writes.length === 1 && header.writes[0].path === 'src/range.js' && !header.writes[0].guessed);
  const bare = P('I fixed it.\n\n=== src/range.js ===\nfunction range(a, b) {\n  return [a, b];\n}\n\nAfter this change the tests should pass.');
  ok('a section under such a header with no fence is the file, the sentences after it left out', bare.writes.length === 1 && bare.writes[0].content === 'function range(a, b) {\n  return [a, b];\n}\n' && /I fixed it/.test(bare.said));
  const sentence = P(`Here is the updated \`range.js\` file:\n${T}js\nfunction range() { return []; }\n${T}`);
  ok('a sentence just above naming one file names it, matched to the project by its name', sentence.writes.length === 1 && sentence.writes[0].path === 'src/range.js' && sentence.writes[0].guessed);
  const comment = P(`${T}js\n// src/api.js\nconst a = 1;\n${T}`);
  ok('a comment naming a file as the first line names the block, and is left out of the file', comment.writes.length === 1 && comment.writes[0].path === 'src/api.js' && comment.writes[0].content === 'const a = 1;\n');
  const pyComment = P(`${T}python\n# timeparse.py\ndef f():\n    pass\n${T}`);
  ok('...in Python too', pyComment.writes.length === 1 && pyComment.writes[0].path === 'timeparse.py');
  const two = P(`Change src/users.js and src/api.js:\n${T}js\nx()\n${T}`);
  ok('a sentence naming two files names neither', two.writes.length === 0);
  const wrongLang = P(`Update config/app.json:\n${T}python\nprint(1)\n${T}`);
  ok('a name the block\'s language does not fit is not taken', wrongLang.writes.length === 0);
  const shell = P(`Then run this in src/users.js:\n${T}sh\nnpm test\n${T}`);
  ok('a command block is never a file', shell.writes.length === 0);
  const lone = P(`${T}json\n{ "port": 8080 }\n${T}\nI changed the port.`, ['config/app.json']);
  ok('a lone unnamed block is the one file the request names that it fits', lone.writes.length === 1 && lone.writes[0].path === 'config/app.json' && lone.writes[0].guessed && !/8080/.test(lone.said));
  ok('...but not when the request names two it could be', P(`${T}js\nx\n${T}`, ['src/users.js', 'src/api.js']).writes.length === 0);
  ok('a path ending a sentence is read without its full stop', L.pathsIn('Add parse_duration(text) to timeparse.py. It reads durations').join() === 'timeparse.py' && L.pathsIn('put them in test/clamp.test.js, and run').join() === 'test/clamp.test.js');
  ok('the project\'s files are read from how it is shown', L.knownFiles('intro\n\n=== src/a.js ===\nx\n\n=== b.css ===\ny\n\n=== not text, not shown: logo.png ===').join() === 'src/a.js,b.css');
}

console.log('\nA guessed name, checked against the file it would replace:');
{
  const T = '`'.repeat(3);
  const clamp = 'function clamp(v, lo, hi) {\n  return Math.min(hi, Math.max(lo, v));\n}\nmodule.exports = { clamp };\n';
  const tests = L.parseReply(`1. Add tests for \`clamp\` in \`src/clamp.js\`:\n${T}js\ntest('below', () => {});\n${T}`, { known: ['src/clamp.js'] });
  const p = L.plan(tests, { 'src/clamp.js': clamp });
  ok('code that shares nothing with the file a sentence named is not written over it, and is asked to be named', p.calls.length === 0 && /did not say which file it is for/.test(p.note));
  const fix = L.parseReply(`Here is the fix for \`src/clamp.js\`:\n${T}js\nfunction clamp(v, lo, hi) {\n  return v < lo ? lo : v > hi ? hi : v;\n}\n${T}`, { known: ['src/clamp.js'] });
  const q = L.plan(fix, { 'src/clamp.js': clamp });
  ok('code that redefines the file\'s own function is written', q.calls.length === 1 && /v < lo \? lo/.test(q.calls[0].arguments.content));
  const big = ['function a() {', '  return 1;', '}', ...Array.from({ length: 40 }, (_, i) => `function f${i}() { return ${i}; }`), 'module.exports = { a };'].join('\n') + '\n';
  const part = L.plan(L.parseReply(`FILE: big.js\n${T}js\nfunction a() {\n  return 2;\n}\n${T}`), { 'big.js': big });
  ok('one function of a long file is fitted into it, not refused as too short', part.calls.length === 1 && /return 2;/.test(part.calls[0].arguments.content) && /function f39\(\)/.test(part.calls[0].arguments.content) && part.note === '');
  ok('Node\'s own test runner is named for a project that uses it, and only then', /require\('node:test'\)/.test(L.testHint('=== package.json ===\n{ "scripts": { "test": "node --test" } }')) && L.testHint('{ "scripts": { "test": "jest" } }') === '');
}

console.log('\nThe loop reads an answer through it:');
{
  const T = '`'.repeat(3);
  const read = [];
  const got = await L.turnOf(`Done.\nFILE: src/a.js\n${T}\nnew\n${T}\nREAD: src/b.js`, async (path) => { read.push(path); if (path === 'src/a.js') return 'old\n'; throw new Error('no'); });
  ok('each file it would write is read as it is now, and the answer becomes calls with ids', read.join() === 'src/a.js' && got.calls.map((c) => c.name).join() === 'write_file,read_file' && got.calls.every((c) => /^light_\d+_\d$/.test(c.id)) && got.said === 'Done.');
  const failing = await L.turnOf(`FILE: c.js\n${T}\nx\n${T}`, async () => { throw new Error('not without asking'); });
  ok('a file that cannot be read without asking is taken as new, not as an error', failing.calls.length === 1 && failing.note === '');
  const mode = src('modes', 'code', 'mode.js');
  ok('a size the model app does not report is read from the name, and the setting decides light mode', /sizeOf\?\.\(info\?\.billions \?\? window\.HCCodeLight\?\.billionsInName\(model\)\) \|\| 'full', light = !!window\.HCCodeLight\?\.applies\(size, cdrPrefs\(\)\.light\);/.test(mode));
  ok('in light mode it is offered no tools and reads its history as plain text', /const tools = sharedState\.light \? \[\] :/.test(mode) && /sharedState\.light \? window\.HCCodeLight\.callMessages\(compressHistory\(baseMsgs\)\)/.test(mode));
  ok('...is told the light instructions, not the tool rules', /if \(sharedState\.light && window\.HCCodeLight\) return \[window\.HCCodeLight\.SYSTEM,/.test(mode));
  ok('...its answer becomes the calls a larger model makes, and a file not written whole is asked for again, twice at most', /window\.HCCodeLight\.turnOf\(turn\.content,/.test(mode) && /if \(lit\?\.calls\.length\) turn = \{ \.\.\.turn, content: lit\.said, tool_calls: lit\.calls \};/.test(mode) && /if \(lit\?\.note && sent\.light\+\+ < 2\)/.test(mode));
  ok('...and the tests are run for it', /if \(back\.run && \(sharedState\.size === 'small' \|\| sharedState\.light \|\| back\.kind === 'example'\)\) forced/.test(mode));
  ok('...and is shown the project whole, at the larger budget', /local \|\| light\) && !!root/.test(mode) && /wholeProject\(root, quiet, light \? 'mid' : size\)/.test(mode));
  const panel = src('core', 'settings', 'panel.html');
  ok('the setting is in Settings under HashCoder: models under 5B, under 15B, or off, and the panel reads it', /<select class="control" id="cdrSetLight">\s*<option value="auto">Models under 5B<\/option>\s*<option value="always">Models under 15B<\/option>\s*<option value="off">Off<\/option>/.test(panel)
    && /lightEl\.value = \['auto', 'always', 'off'\]\.includes\(prefs\.light\) \? prefs\.light : 'auto';/.test(mode));
  ok('the note under the box says when a model runs in light mode', /runs in light mode: it writes whole files and HashCortX does the tool work\./.test(mode));
  ok('a debugging export says a run was in light mode', /light: !!sharedState\.light,/.test(src('js', 'code', 'debug-export.js')));
  const boot = src('boot.js');
  ok('it loads before the Coder, after the fences it reads with', boot.indexOf("'/js/code/light.js'") > boot.indexOf("'/js/fences.js'") && boot.indexOf("'/js/code/light.js'") < boot.indexOf("'/js/app.js'"));
  ok('this check is part of npm run check', /npm run check:code-light/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/light.js)`);
process.exit(fail ? 1 : 0);
