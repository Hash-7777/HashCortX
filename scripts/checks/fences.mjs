// ==============================================================
// Code-fence checks
//
// Loads the REAL src/js/fences.js beside the REAL markdown renderer the chat is
// drawn with, and the PDF writer that uses it.
//
// Everything in the app that looks for code in a model's answer reads it
// through this file, so the central check hands each case to the renderer and
// to this reader and requires the same code blocks from both. A pattern that
// misses a block's opening fence can take its closing fence for an opening
// one and turn everything after it inside out; that is checked here too.
//
// Run with: npm run check:fences
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
vm.runInContext(src('js', 'export-format.js'), sandbox, { filename: 'export-format.js' });
const marked = sandbox.marked || sandbox.window.marked;
const F = sandbox.window.HCFences;
const X = sandbox.window.HCExport;

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
const onScreen = (text) => [...marked.parse(text, { gfm: true, breaks: true })
  .matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map((m) => decode(m[1]).replace(/\n$/, ''));

const CASES = {
  'a language in letters': `${B}js\nconst a = 1;\n${B}`,
  'no language': `${B}\nplain\n${B}`,
  'C++': `${B}c++\nint x = 0;\n${B}`,
  'C#': `${B}c#\nvar x = 0;\n${B}`,
  'a fence with a title': `${B}js title="app.js"\nlet a;\n${B}`,
  'a trailing space after the language': `${B}python \nx = 1\n${B}`,
  'Windows line endings': `${B}js\r\nconst a = 1;\r\n${B}\r\n`,
  'a tilde fence': `${T}py\nx = 1\n${T}`,
  'a longer fence around a shorter one': '````md\n' + `${B}js\ninner\n${B}` + '\n````',
  'an indented backtick fence': `  ${B}js\n  const a = 1;\n    nested();\n  ${B}`,
  'an indented tilde fence': `  ${T}py\n  a\n    b\n  ${T}`,
  'two blocks with prose between': `${B}a\n1\n${B}\ntext\n${B}b\n2\n${B}`,
  'a C# block followed by more code': `Intro:\n\n${B}c#\nvar a = 1;\n${B}\n\nThen run it.\n\n${B}bash\ndotnet run\n${B}\n`,
  'a block left open': `${B}js\nconst a = 1;`,
  'backticks used inline': 'use ```inline``` here',
  'a fence whose info line has a backtick': '```a`b\nx\n```',
  'no code at all': 'no code here at all',
};

console.log('The reader finds exactly the code the chat shows:');
for (const [name, text] of Object.entries(CASES)) {
  const screen = onScreen(text);
  const found = F.codeBlocks(text).map((b) => b.code);
  ok(name, JSON.stringify(screen) === JSON.stringify(found));
  if (JSON.stringify(screen) !== JSON.stringify(found)) {
    console.log(`          screen ${JSON.stringify(screen)}\n          reader ${JSON.stringify(found)}`);
  }
}

console.log('\nProse comes back exactly as it was written:');
{
  const text = `First line.\r\nSecond *line*.\n\n${B}js\ncode\n${B}\nAfter, with a trailing newline.\n`;
  const pieces = F.splitFences(text);
  ok('prose, then code, then prose', pieces.map((p) => p.type).join() === 'text,code,text');
  ok('the prose before keeps its own line endings', pieces[0].text === 'First line.\r\nSecond *line*.\n\n');
  ok('the prose after keeps its trailing newline', pieces[2].text === 'After, with a trailing newline.\n');
  ok('a text with no code is one piece, unchanged', (() => {
    const p = F.splitFences('just words\nand more\n');
    return p.length === 1 && p[0].text === 'just words\nand more\n';
  })());
  ok('the whole info line is kept alongside the language', (() => {
    const [b] = F.codeBlocks(`${B}js title="app.js"\nx\n${B}`);
    return b.lang === 'js' && b.info === 'js title="app.js"';
  })());
  ok('nothing gives nothing', F.splitFences('').length === 0 && F.splitFences(null).length === 0);
}

console.log('\nThe PDF writer frames code and leaves prose as prose:');
{
  // One C# block used to be missed, its closing fence taken for an opening
  // one, and everything after it read inside out.
  const flat = X.markdownToPlainText(CASES['a C# block followed by more code']);
  ok('the C# block is framed as code', /\[code: c#\]\n    var a = 1;\n\[end code\]/.test(flat));
  ok('the sentence after it is prose, not code', /\n\nThen run it\.\n\n/.test(flat) && !/    Then run it/.test(flat));
  ok('the bash block after that is framed too', /\[code: bash\]\n    dotnet run\n\[end code\]/.test(flat));
  ok('no stray fence characters are left', !flat.includes('``'));

  // The prose rules used to run across the code as well.
  const code = X.markdownToPlainText(`${B}js\nconst area = a * b * c;\nconst s = \`x\${y}\`;\n# not a heading\n${B}`);
  ok('multiplication keeps its asterisks', code.includes('a * b * c'));
  ok('a template string keeps its backticks', code.includes('`x${y}`'));
  ok('a line starting with # inside code is kept', code.includes('# not a heading'));
  ok('prose still loses its markdown', X.markdownToPlainText('**bold** and `code`') === 'bold and code');

  // Control: the pattern the PDF writer used before.
  const old = /```[ \t]*([\w+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  const oldFirst = old.exec(CASES['a C# block followed by more code']);
  ok('control: the old pattern opens its first block at the C# block\'s closing fence',
    !!oldFirst && oldFirst[2].includes('Then run it.'));
}

console.log('\nThe Agent Swarm output panel reads fences through this reader:');
{
  // Its own pattern read a language as letters only with an optional newline
  // after it, so a C++ block was labelled "c" and its code began with "++".
  const am = src('modes', 'agent-maker', 'mode.js');
  const start = am.indexOf('function _peekRenderContent(');
  const body = am.slice(start, am.indexOf('\n  }\n', start));
  ok('the panel splits its output with the shared reader', /HCFences\.splitFences\(/.test(body));
  ok('and has no fence pattern of its own', !/`{3}\(/.test(body));
}

console.log('\nNothing else in the app writes its own fence pattern:');
{
  // Every hand-written pattern for finding code in an answer turned out to be
  // narrower than the renderer — each missed C#, titled fences, tildes or
  // Windows line endings somewhere. So a new one fails here until it is either
  // moved onto this reader or added below with its reason.
  //
  // The ones allowed pull a machine-readable reply — JSON, or Python for the
  // sandbox — out of a single fence, and each has its own way of recovering
  // when the fence is not what it expected. They are the next to move, not a
  // settled exception.
  const ALLOWED = {
    'js/agent-shape.js': 1,        // Python out of a reply, for the sandbox
    'js/systems/spec.js': 2,       // a system spec's JSON, with repair after
    'modes/agent-maker/mode.js': 2, // a blueprint's JSON; and "is any fence present"
    'modes/finance/mode.js': 1,    // the analysis JSON, with repair after
    'modes/forge/mode.js': 1,      // a plan's JSON, with repair after
  };
  const root = join(here, '..', '..', 'src');
  const found = {};
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'vendor') continue;
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.js')) continue;
      const rel = full.slice(root.length + 1).split('\\').join('/');
      if (rel === 'js/fences.js') continue;
      const count = readFileSync(full, 'utf8').split('\n')
        .filter((line) => !/^\s*(\/\/|\*)/.test(line) && /\/[^/\n]*`{3}[^/\n]*\/[gimsuy]*/.test(line)).length;
      if (count) found[rel] = count;
    }
  })(root);
  const unexpected = Object.entries(found).filter(([f, n]) => n > (ALLOWED[f] || 0));
  ok('no fence pattern exists outside js/fences.js beyond the listed ones', unexpected.length === 0);
  if (unexpected.length) console.log(`          ${unexpected.map(([f, n]) => `${f} (${n})`).join(', ')}`);
  const shrunk = Object.entries(ALLOWED).filter(([f, n]) => (found[f] || 0) < n);
  ok('and the list is kept exact — one moved off it is taken off it', shrunk.length === 0);
  if (shrunk.length) console.log(`          no longer there: ${shrunk.map(([f]) => f).join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/fences.js)`);
process.exit(fail ? 1 : 0);
