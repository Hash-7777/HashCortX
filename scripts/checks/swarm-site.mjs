// ==============================================================
// Swarm site-builder checks
//
// Loads the REAL src/js/swarm/site.js into a Node VM.
//
// This turns a swarm's files into the one page that is downloaded or opened
// in the browser. The checks are mostly about not changing what the agents
// wrote on the way in: text that a replacement string or an HTML parser
// would have read as an instruction.
//
// Run with: npm run check:swarm-site
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'site.js'), 'utf8'), sandbox, { filename: 'site.js' });
const S = sandbox.window.HCSwarmSite;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const page = (body = '<h1>x</h1>', head = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const build = (entries) => S.buildSite(new Map(entries));

console.log('The files go in as they were written:');
{
  const out = build([
    ['index.html', { lang: 'html', content: page('<h1>x</h1><script src="app.js"></script>', '<link rel="stylesheet" href="styles.css">') }],
    ['styles.css', { lang: 'css', content: '.price::after { content: "$$"; } .a { content: "$\'"; }' }],
    ['app.js', { lang: 'javascript', content: 'const pick = () => $$("a"); const t = cost + "$&"; const u = "$`";' }],
  ]);
  ok('a stylesheet\'s $$ stays $$', out.includes('content: "$$"'));
  ok('and its $\' stays', out.includes('content: "$\'"'));
  ok('a script\'s $$( stays $$(', out.includes('$$("a")'));
  ok('its "$&" stays, and is not swapped for a tag', out.includes('"$&"') && !/"<script/.test(out));
  ok('its "$`" stays', out.includes('"$`"'));
  ok('the linked stylesheet is inlined in place of its tag', !out.includes('href="styles.css"') && out.includes('/* styles.css */'));
  ok('the linked script is inlined in place of its tag', !out.includes('src="app.js"') && out.includes('/* app.js */'));

  // Control: a replacement string, as the builder used to insert files.
  ok('control: a replacement string turns $$ into $', 'X'.replace('X', '$$') === '$');
}

console.log('\nA script cannot end its own block:');
{
  const js = 'const t = "</script><b>after</b>"; const c = "<!-- x -->";';
  const out = build([
    ['index.html', { lang: 'html', content: page('<script src="app.js"></script>') }],
    ['app.js', { lang: 'javascript', content: js }],
  ]);
  const start = out.indexOf('<script>');
  const end = out.indexOf('</script>', start);
  const inside = out.slice(start, end);
  ok('the script runs to its own end, with everything it wrote inside it', inside.includes('after') && inside.includes('x -->'));
  ok('"</script" inside it is written as "<\\/script", the same string to JavaScript', inside.includes('"<\\/script><b>after</b>"'));
  ok('nothing after it became page markup', !/<\/script><b>after/.test(out));
  const css = build([
    ['index.html', { lang: 'html', content: page('', '<link rel="stylesheet" href="s.css">') }],
    ['s.css', { lang: 'css', content: 'a::after { content: "</style><i>x</i>"; }' }],
  ]);
  ok('a stylesheet cannot end its own block either', !/<\/style><i>x/.test(css));
}

console.log('\nNothing the agents wrote is dropped:');
{
  const out = build([
    ['index.html', { lang: 'html', content: page() }],
    ['extra.css', { lang: 'css', content: 'body{color:red}' }],
    ['extra.js', { lang: 'javascript', content: 'window.x = 1;' }],
  ]);
  ok('a stylesheet the page does not link goes into the head', /\/\* extra\.css \*\/[\s\S]*<\/head>/.test(out));
  ok('a script the page does not link goes before the end of the body', /\/\* extra\.js \*\/[\s\S]*<\/body>/.test(out));
  const bare = build([['index.html', { lang: 'html', content: '<h1>no head or body</h1>' }], ['a.css', { lang: 'css', content: 'h1{}' }], ['a.js', { lang: 'javascript', content: 'y()' }]]);
  ok('a page with no head still gets its styles, first', bare.startsWith('<style>'));
  ok('and no body still gets its scripts, last', bare.trim().endsWith('</script>'));
}

console.log('\nWhich page, and when there is none:');
{
  ok('index.html is the page', build([['about.html', { lang: 'html', content: 'A' }], ['index.html', { lang: 'html', content: 'I' }]]) === 'I');
  ok('otherwise the first HTML file', build([['about.html', { lang: 'html', content: 'A' }]]) === 'A');
  ok('with no page there is nothing to build', build([['app.js', { lang: 'javascript', content: 'x' }]]) === null);
  ok('a plain object of files works too', S.buildSite({ 'index.html': { lang: 'html', content: 'P' } }) === 'P');
  ok('nothing gives nothing', S.buildSite(null) === null);
}

console.log('\nA Tailwind page gets Tailwind:');
{
  const tw = build([['index.html', { lang: 'html', content: page('<div class="flex p-4 bg-white">x</div>') }]]);
  ok('a page using its class names but not loading it gets its script', tw.includes('cdn.tailwindcss.com'));
  const has = build([['index.html', { lang: 'html', content: page('<div class="flex">x</div>', '<script src="https://cdn.tailwindcss.com"></script>') }]]);
  ok('a page that already loads it does not get it twice', has.split('cdn.tailwindcss.com').length === 2);
  ok('a page that does not use it is left alone', !build([['index.html', { lang: 'html', content: page() }]]).includes('tailwind'));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/site.js)`);
process.exit(fail ? 1 : 0);
