// ==============================================================
// Rewinding a HashCoder conversation — checks
//
// Loads the real src/js/code/rewind.js and holds what it says before a
// rewind (the replies that go, the changes undone newest first, the
// changes kept or never saved that cannot be undone, changes made before
// the conversation was opened, and the commands that cannot be taken back,
// judged by the same test Auto uses), and where Edit and Regenerate are
// wired. The drawing and the rewind itself are looked at in a browser.
// Every request, file and command here is invented.
//
// Run with: npm run check:code-rewind
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(src('js', 'code', 'rewind.js'), box, { filename: 'rewind.js' });
const W = box.HCCodeRewind;

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond === true) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (x) => JSON.stringify(x);
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const convo = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Fix the totals.' },
  { role: 'assistant', content: '', tool_calls: [call('a', 'shell_run', { command: 'npm', args: ['test'] }), call('b', 'patch_file', { path: 'src/a.js' })] },
  { role: 'tool', tool_call_id: 'a', content: '{"code":0}' }, { role: 'tool', tool_call_id: 'b', content: '{"ok":true}' },
  { role: 'assistant', content: 'Done.' },
  { role: 'user', content: 'Now add vitest.' },
  { role: 'assistant', content: '', tool_calls: [call('c', 'shell_run', { command: 'npm', args: ['install', '--save-dev', 'vitest'] }), call('d', 'shell_run', { command: 'rm', args: ['-rf', 'dist'] }), call('e', 'write_file', { path: 'test/a.test.js' }), call('f', 'shell_run', { command: 'curl', args: ['x'] })] },
  { role: 'tool', tool_call_id: 'c', content: '{"code":0}' }, { role: 'tool', tool_call_id: 'd', content: '{"code":0}' }, { role: 'tool', tool_call_id: 'e', content: '{"ok":true}' }, { role: 'tool', tool_call_id: 'f', content: '{"error":"Denied by the person."}' },
  { role: 'assistant', content: 'Added.' },
];
const reads = (command, args) => command === 'npm' && args[0] === 'test';   // the test Auto uses, as a stand-in: only the project's own test is free

console.log('\nWhat cannot be taken back:');
ok('the commands run after the place rewound to, other than those that only read or run the project\'s own checks', json(W.commandsAfter(convo, 1, reads)) === '["npm install --save-dev vitest","rm -rf dist"]', json(W.commandsAfter(convo, 1, reads)));
ok('...never one that was refused or failed to start, and none before that place', json(W.commandsAfter(convo, 6, reads)) === '["npm install --save-dev vitest","rm -rf dist"]' && json(W.commandsAfter(convo, 11, reads)) === '[]');
ok('...and with no test given, every command counts', W.commandsAfter(convo, 1, null).length === 3);
ok('the changes the replies after it made, by their calls', W.changeCallsAfter(convo, 1) === 2 && W.changeCallsAfter(convo, 6) === 1 && W.changeCallsAfter(convo, 12) === 0);

console.log('\nWhat it says first:');
const rows = [{ name: 'a.js', state: 'pending', canUndo: true }, { name: 'b.js', state: 'accepted', canUndo: false }, { name: 'c.js', state: 'rejected', canUndo: false }, { name: 'd.js', state: 'pending', canUndo: false }, { name: 'e.js', state: 'pending', canUndo: true }];
const p = W.plan({ replies: 2, added: 1, rows, commands: ['npm install --save-dev vitest'], changeCalls: 7, pictures: true });
ok('what goes: the replies, the changes undone newest first, the kept and never-saved ones that stay, and what cannot be seen from here', p.replies === 2 && json(p.undo) === '["e.js","a.js"]' && json(p.kept) === '["b.js"]' && json(p.cannot) === '["d.js"]' && p.unseen === 2, json(p));
const said = W.lines(p, 'edit');
ok('...said in plain words, each kind on its own line, what cannot be taken back marked to look at', json(said.map((l) => l.kind)) === '["reply","undo","kept","cannot","unseen","commands","pictures"]' && said.filter((l) => l.attention).length === 4, json(said));
ok('...the replies with all their steps and the message you added', said[0].text === '2 replies go, with all their steps and the message you added while they worked.', said[0].text);
ok('...the changes undone, newest first, by name', said[1].text === '2 changes they made are undone, newest first: e.js, a.js.');
ok('...a command is named as one undo cannot put back', /^1 command cannot be taken back: npm install --save-dev vitest\. Undo puts back files, not what a command did\.$/.test(said[5].text), said[5].text);
ok('regenerating says nothing of pictures: the request stays as it was sent', !W.lines(p, 'regen').some((l) => l.kind === 'pictures'));
ok('nothing after it: said so', json(W.lines(W.plan({ replies: 0, rows: [], commands: [], changeCalls: 0 }), 'edit').map((l) => l.text)) === '["Nothing after this message changed a file or ran a command."]');
ok('one reply that changed nothing and ran nothing is regenerated at once, with nothing to say first', W.quiet(W.plan({ replies: 1, rows: [], commands: [], changeCalls: 0 })) === true && W.quiet(p) === false && W.quiet(W.plan({ replies: 2, rows: [], commands: [], changeCalls: 0 })) === false);

console.log('\nWhere it is wired:');
const rw = src('js', 'code', 'rewind.js'), mode = src('modes', 'code', 'mode.js'), view = src('js', 'run-view.js'), css = src('modes', 'code', 'mode.css');
ok('each request bubble knows the message it was drawn from', /el\.hcMsg = msg \|\| null;/.test(mode) && /shownRequest\(m\.content\) : m\.content, m\.thumbs, m\)/.test(mode) && /\.hcMsg = conversationMsgs\.at\(-1\)/.test(mode));
ok('Edit opens the message to change in place; Regenerate rewinds to the request before it; neither while a run goes on', /window\.HCCodeRewind\.edit\(el, rewindCtx\(\)\)/.test(mode) && /if \(!runAbort\) window\.HCCodeRewind\?\.regenerate\(el, rewindCtx\(\)\);/.test(mode) && /if \(!userEl \|\| ctx\.busy\(\)/.test(rw));
ok('nothing goes until you send: the changes are undone first, newest first, one at a time, and if one is not undone nothing more is undone or sent, and it says which were', /const undone = await window\.HCRunView\.undoRows\(/.test(rw) && /if \(!undone\.done\) \{/.test(rw) && /was not undone, so nothing more was undone and nothing was sent/.test(rw) && rw.indexOf('undoRows(') < rw.indexOf('ctx.cut('));
ok('...then the conversation is cut there, what follows leaves the screen, and it is sent again', /ctx\.cut\(index\)\)/.test(rw) && /ctx\.cut\(index \+ 1\);/.test(rw) && /ctx\.send\(text\)/.test(rw) && /ctx\.rerun\(msg\)/.test(rw));
ok('the changes waiting from an earlier session stay, and are never counted as this conversation\'s replies', /:not\(\.cdr-change-group\)/.test(rw));
ok('Undo all and the rewind undo the same way', /async function undoRows\(/.test(view) && /return undoRows\(/.test(view));
ok('the controls say their word beside their mark', (mode.match(/\$\{svgCopy\} Copy<\/button>/g) || []).length === 2 && /<\/svg> Edit<\/button>/.test(mode) && /\$\{svgReply\} Reply<\/button>/.test(mode) && /\$\{svgRegen\} Regenerate<\/button>/.test(mode));
ok('nothing in it moves', !/\.cdr-rewind[^{]*\{[^}]*(?:animation|transition)/.test(css));
const boot = src('boot.js');
ok('it is loaded before the modes', boot.indexOf("'/js/code/rewind.js'") > 0 && boot.indexOf("'/js/code/rewind.js'") < boot.indexOf("'/modes/boot.js'"));
ok('it is part of npm run check', /npm run check:code-rewind\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/rewind.js)`);
process.exit(fail ? 1 : 0);
