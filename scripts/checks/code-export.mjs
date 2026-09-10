// ==============================================================
// Coder export checks
//
// Loads the REAL src/js/code/export.js and the REAL markdown renderer the chat
// is drawn with, side by side.
//
// An export has to contain what the person saw. So the central check here
// does not describe fences in the abstract: it hands each case to the chat's
// own renderer and to the export, and requires the code blocks each finds to
// be the same. If the renderer is ever upgraded and reads fences differently,
// this fails before an export quietly starts leaving code out again.
//
// Run with: npm run check:code-export
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, self: {}, console };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'vendor', 'marked.min.js'), sandbox, { filename: 'marked.min.js' });
vm.runInContext(src('js', 'fences.js'), sandbox, { filename: 'fences.js' });
vm.runInContext(src('js', 'code', 'paths.js'), sandbox, { filename: 'paths.js' });
vm.runInContext(src('js', 'code', 'export.js'), sandbox, { filename: 'export.js' });
const marked = sandbox.marked || sandbox.window.marked;
const X = sandbox.window.HCCodeExport;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const B = '`'.repeat(3);
const T = '~'.repeat(3);
const decode = (h) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** The code blocks the chat draws for a piece of markdown, as it draws them. */
const onScreen = (text) => [...marked.parse(text, { gfm: true, breaks: true })
  .matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map((m) => decode(m[1]).replace(/\n$/, ''));

const CASES = {
  'a language in letters': `${B}js\nconst a = 1;\n${B}`,
  'no language': `${B}\nplain\n${B}`,
  'C++': `${B}c++\nint x = 0;\n${B}`,
  'C#': `${B}c#\nvar x = 0;\n${B}`,
  'Objective-C': `${B}objective-c\n@interface A\n${B}`,
  'a shell session': `${B}shell-session\n$ ls\n${B}`,
  'a fence with a title': `${B}js title="app.js"\nlet a;\n${B}`,
  'a trailing space after the language': `${B}python \nx = 1\n${B}`,
  'Windows line endings': `${B}js\r\nconst a = 1;\r\n${B}`,
  'a tilde fence': `${T}py\nx = 1\n${T}`,
  'a longer fence around a shorter one': '````md\n' + `${B}js\ninner\n${B}` + '\n````',
  'an indented fence': `  ${B}js\n  const a = 1;\n    nested();\n  ${B}`,
  'an indented fence with a shallow line': `   ${B}\n x\n   y\n${B}`,
  'an indented tilde fence': `  ${T}py\n  a\n    b\n  ${T}`,
  'two blocks with prose between': `${B}a\n1\n${B}\ntext\n${B}b\n2\n${B}`,
  'a block left open': `${B}js\nconst a = 1;`,
  'backticks used inline': 'use ```inline``` here',
  'no code at all': 'no code here at all',
  'a fence whose info line has a backtick': '```a`b\nx\n```',
};

console.log('The export finds exactly the code the chat shows:');
for (const [name, text] of Object.entries(CASES)) {
  const screen = onScreen(text);
  const exported = X.codeBlocks(text).map((b) => b.code);
  ok(name, JSON.stringify(screen) === JSON.stringify(exported));
  if (JSON.stringify(screen) !== JSON.stringify(exported)) {
    console.log(`          screen ${JSON.stringify(screen)}\n          export ${JSON.stringify(exported)}`);
  }
}

console.log('\nThe old pattern left code out that the chat showed:');
{
  // Control: the pattern the export used before. Every one of these is drawn
  // as code in the chat, and none of them reached the code-only export.
  const old = /```(\w*)\n([\s\S]*?)```/g;
  const missed = ['C++', 'C#', 'Objective-C', 'a shell session', 'a fence with a title',
    'a trailing space after the language', 'Windows line endings'].filter((k) => {
    old.lastIndex = 0;
    return onScreen(CASES[k]).length === 1 && !old.test(CASES[k]);
  });
  ok('control: the old pattern misses blocks the chat shows as code', missed.length === 7);
}

console.log('\nThe language is read the way the chat reads it:');
{
  ok('C++ keeps its name', X.codeBlocks(CASES['C++'])[0].lang === 'c++');
  ok('C# keeps its name', X.codeBlocks(CASES['C#'])[0].lang === 'c#');
  ok('a title after the language is not part of it', X.codeBlocks(CASES['a fence with a title'])[0].lang === 'js');
  ok('no language is an empty name', X.codeBlocks(CASES['no language'])[0].lang === '');
}

console.log('\nCode-only export:');
{
  const msgs = [
    { role: 'system', content: `${B}js\nsecret system prompt code\n${B}` },
    { role: 'user', content: `Fix this:\n${B}c++\nint main() {}\n${B}` },
    { role: 'assistant', content: `Here:\n${B}c++\nint main() { return 0; }\n${B}\nand\n${B}\nnotes\n${B}` },
  ];
  const out = X.buildCodeOnly(msgs);
  ok('a conversation whose code is C++ is not reported as having none', out.trim() !== '');
  ok('every block the person saw is there', (out.match(/\/\* ── block/g) || []).length === 3);
  ok('blocks are numbered in order', /block 1 · c\+\+[\s\S]*block 2 · c\+\+[\s\S]*block 3 · text/.test(out));
  ok('a block with no language is labelled text', out.includes('block 3 · text'));
  ok('the system prompt is not exported', !out.includes('secret system prompt'));
  ok('the code itself is intact', out.includes('int main() { return 0; }'));
  ok('nothing at all gives nothing', X.buildCodeOnly([]) === '');
  ok('messages that are not a list give nothing', X.buildCodeOnly(null) === '');
}

console.log('\nWhole-chat exports:');
{
  const msgs = [
    { role: 'system', content: 'hidden' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ];
  const md = X.buildMarkdown(msgs, { date: 'D', projectRoot: '/work/app' });
  ok('markdown names the speakers', md.includes('## User') && md.includes('## Agent'));
  ok('markdown carries what was said', md.includes('hello') && md.includes('hi there'));
  ok('markdown leaves the system prompt out', !md.includes('hidden'));
  ok('markdown carries the date it was given', md.includes('Date: D'));
  ok('markdown names the project', md.includes('Project: /work/app'));
  const txt = X.buildPlainText(msgs, { date: 'D' });
  ok('text names the speakers', txt.includes('>>> USER') && txt.includes('<<< AGENT'));
  ok('text leaves the system prompt out', !txt.includes('hidden'));
  ok('text with no project does not print an empty project line', !txt.includes('Project:'));
  ok('a message with no content does not print the word undefined',
    !X.buildMarkdown([{ role: 'user' }], { date: 'D' }).includes('undefined'));
}

console.log('\nThe file name is a file name on every system:');
{
  // The path was split on forward slashes only, so a Windows path left the
  // drive letter, colon and backslashes in the name the save dialog offered.
  ok('a Mac path gives its last folder', X.exportBaseName('/Users/me/projects/app') === 'app');
  ok('a Windows path gives its last folder', X.exportBaseName('C:\\Users\\me\\projects\\app') === 'app');
  ok('a trailing slash still gives a name', X.exportBaseName('/Users/me/app/') === 'app');
  ok('a trailing backslash still gives a name', X.exportBaseName('C:\\work\\app\\') === 'app');
  ok('characters no system allows are removed', X.exportBaseName('/x/a:b*c?') === 'abc');
  ok('a folder starting with a dot does not become a hidden file', X.exportBaseName('/x/.config') === 'config');
  ok('no project gives a sensible default', X.exportBaseName('') === 'chat');
  ok('a drive on its own gives a sensible default', X.exportBaseName('C:\\') === 'C');
  ok('control: splitting on forward slashes alone keeps the Windows path',
    'C:\\Users\\me\\app'.split('/').slice(-1)[0] === 'C:\\Users\\me\\app');
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/export.js)`);
process.exit(fail ? 1 : 0);
