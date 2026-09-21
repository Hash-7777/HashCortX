// ==============================================================
// Swarm work-inspection checks
//
// Loads the REAL src/js/swarm/project-check.js into a Node VM.
//
// This is what the app notices about the team's work before the person does.
// Two things matter equally here: that it finds what is really wrong, and that
// it stays quiet about what is not. A checker that cries about a working page
// is worse than none, because the next real finding is ignored with the rest.
// So every group below has its own control.
//
// Run with: npm run check:swarm-project-check
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, '..', '..', 'src', 'js', 'swarm', 'project-check.js'), 'utf8'), sandbox, { filename: 'project-check.js' });
const C = sandbox.window.HCSwarmProjectCheck;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const set = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, { content: v }]));
const look = (obj, opts) => C.inspect(set(obj), opts);
const said = (obj, opts) => look(obj, opts).map((f) => `${f.level}:${f.what}`).join(' | ');
const FULL = '<!doctype html><html><body><h1>A real heading for a real request</h1></body></html>';

console.log('What the team said it would hand back:');
ok('a deliverable nobody wrote is named', /answer\.md was owed/.test(said({ 'brief.md': 'x'.repeat(40) }, { owed: ['brief.md', 'answer.md'] })));
ok('a deliverable that was written is not', !/brief\.md was owed/.test(said({ 'brief.md': 'x'.repeat(40) }, { owed: ['brief.md'] })));
ok('a deliverable that is not a file is not looked for', !/owed/.test(said({ 'a.md': 'x'.repeat(40) }, { owed: ['the finished work'] })));
ok('nothing owed, nothing said', said({ 'a.md': 'x'.repeat(40) }) === '');

console.log('\nA file that is not finished:');
ok('an empty file', /styles\.css is empty/.test(said({ 'styles.css': '  ' })));
ok('a file cut off mid-way', /app\.js stops in the middle/.test(said({ 'app.js': 'function f() {\n  const a = 1;' })));
ok('a brace inside a string does not count as unclosed', !/stops in the middle/.test(said({ 'app.js': 'const a = "{";\nconst b = 2;' })));
ok('an escaped quote does not run the string on', !/stops in the middle/.test(said({ 'app.js': 'const a = "say \\" here";\nconst b = 2;' })));
ok('a whole stylesheet is not called cut off', !/stops in the middle/.test(said({ 'styles.css': 'body { margin: 0; }\n.a { color: red; }' })));

console.log('\nText that came from a template rather than this request:');
ok('lorem ipsum', /lorem ipsum/.test(said({ 'index.html': `<p>Lorem ipsum dolor sit amet consectetur</p>${FULL}` })));
ok('a made-up name', /made-up name/.test(said({ 'about.md': 'Written by John Doe, who does not exist at all.' })));
ok('example.com', /example\.com/.test(said({ 'index.html': `<a href="https://example.com">Contact</a>${FULL}` })));
ok('work left for someone else', /left for someone else/.test(said({ 'app.js': '// TODO: wire this up properly later on' })));
ok('a real page says none of this', !/still has/.test(said({ 'index.html': FULL })));

console.log('\nAn address that is known not to answer:');
ok('the placeholder service the run used', /via\.placeholder\.com, which no longer answers/.test(said({ 'index.html': `<img src="https://via.placeholder.com/300x200">${FULL}` })));
ok('a working image host is left alone', !/no longer answers/.test(said({ 'index.html': `<img src="https://images.unsplash.com/photo-1">${FULL}` })));

console.log('\nSass written into a file the browser reads as CSS:');
ok('a colour function', /Sass colour function/.test(said({ 'styles.css': '.a:hover { background: darken(#e74c3c, 10%); }' })));
ok('a rule', /Sass rule/.test(said({ 'styles.css': '@mixin center { margin: 0 auto; }\n.a { color: red; }' })));
ok('a variable', /Sass variable/.test(said({ 'styles.css': '$accent: #e74c3c;\n.a { color: red; }' })));
ok('a custom property is not a Sass variable', !/Sass/.test(said({ 'styles.css': ':root { --accent: #e74c3c; }\n.a { color: red; }' })));
ok('a plain colour function is not Sass', !/Sass/.test(said({ 'styles.css': '.a { color: rgba(0, 0, 0, 0.5); }' })));

console.log('\nA file pointing at a file that is not there:');
ok('a page that links a page nobody wrote', /index\.html points at cart\.html/.test(said({ 'index.html': `<a href="cart.html">Cart</a>${FULL}` })));
ok('a page that links one that is there is fine', !/points at/.test(said({ 'index.html': `<a href="about.html">About</a>${FULL}`, 'about.html': FULL })));
ok('a web address is not a missing file', !/points at/.test(said({ 'index.html': `<a href="https://a.example/x.html">x</a>${FULL}` })));
ok('an anchor is not a missing file', !/points at/.test(said({ 'index.html': `<a href="#work">Work</a>${FULL}` })));
ok('an inline image is not a missing file', !/points at/.test(said({ 'index.html': `<img src="data:image/svg+xml,%3Csvg%3E">${FULL}` })));
ok('a path written with ./ is found', !/points at/.test(said({ 'index.html': `<link rel="stylesheet" href="./styles.css">${FULL}`, 'styles.css': 'body { margin: 0; }' })));

console.log('\nAn id a script reaches for that no page has:');
ok('a missing id is named', /app\.js looks for #total/.test(said({ 'index.html': `<div id="cart"></div>${FULL}`, 'app.js': "document.getElementById('total').textContent = 1;" })));
ok('an id that is there is fine', !/looks for/.test(said({ 'index.html': `<div id="cart"></div>${FULL}`, 'app.js': "document.getElementById('cart').textContent = 1;" })));
ok('a selector for a class is not an id', !/looks for/.test(said({ 'index.html': `<div class="cart"></div>${FULL}`, 'app.js': "document.querySelector('.cart');" })));

console.log('\nA class the markup leans on that nothing styles:');
ok('the mismatch the run actually had is named',
  /nothing styles site-header/.test(said({ 'index.html': `<header class="site-header"></header>${FULL}`, 'styles.css': '.product-card { color: red; }' })));
ok('a class the stylesheet has is not named',
  !/nothing styles/.test(said({ 'index.html': `<header class="site-header"></header>${FULL}`, 'styles.css': '.site-header { color: red; }' })));
ok('a style block in the page counts as styling',
  !/nothing styles/.test(said({ 'index.html': `<style>.site-header{color:red}</style><header class="site-header"></header>${FULL}` })));
ok('a project with no stylesheet at all is not scolded',
  !/nothing styles/.test(said({ 'index.html': `<header class="site-header"></header>${FULL}` })));

console.log('\nWork that is not a website finds nothing to complain about:');
ok('a campaign of real files is clean',
  said({ 'positioning.md': 'The position we are taking, at real length, for a real audience.', 'calendar.md': 'Week one: the launch post goes out on Tuesday morning.' }) === '');

console.log('\nA choice left blank where the browser reads it as code:');
{
  const page = `<link rel="stylesheet" href="style.css"><h1>Luis Diamond</h1>${FULL}`;
  ok('a colour left as a bracketed name is broken', /broken:style\.css leaves a design choice blank \(: \[brand-primary\];\)/.test(said({ 'index.html': page, 'style.css': ':root { --primary: [brand-primary]; --text: #222; }' })));
  ok('a real value is not', !/design choice blank/.test(said({ 'index.html': page, 'style.css': ':root { --primary: #1f2a44; }\na[href="x"] { color: red; }' })));
  ok('an attribute selector is not mistaken for one', !/design choice blank/.test(said({ 'index.html': page, 'style.css': 'input[type="email"] { border: 1px solid #ccc; }' })));
  ok('an image whose address was never filled in is broken', /broken:index\.html has src="\[logo-url\]"/.test(said({ 'index.html': `<img src="[logo-url]" alt="logo">${FULL}` })));
  ok('a link whose address was never filled in is only unfinished', /weak:index\.html has href="mailto:\[your-email\]"/.test(said({ 'index.html': `<a href="mailto:[your-email]">[your-email]</a>${FULL}` })));
  ok('a placeholder in the visible text is what the brief asks for, and is left alone', !/leads nowhere/.test(said({ 'index.html': `<p>Address: [your-address]</p>${FULL}` })));
}

console.log('\nAn address kept for examples, which serves nothing:');
ok('an image at example.com is broken, so it is sent to be fixed', /broken:catalogue\.js points images or links at example\.com/.test(said({ 'catalogue.js': 'window.c = [{ imageUrl: "https://example.com/diamond1.jpg" }];' })));
ok('... and so is one in the markup', /broken:index\.html points images/.test(said({ 'index.html': `<img src="https://www.example.com/a.png" alt="">${FULL}` })));
ok('... and so is one in the data a page loads', /broken:products\.json points images/.test(said({ 'products.json': '[{ "imageUrl": "https://example.com/diamond1.jpg" }]' })));
ok('a blank address is named once, not again as a missing file', (said({ 'index.html': `<img src="[logo-url]" alt="logo">${FULL}` }).match(/logo-url/g) || []).length === 1);
ok('a word about example.com in prose is not an image', !/points images/.test(said({ 'notes.md': 'Do not use example.com for anything real in this project.' })));

console.log('\nWhat a script switches on must be styled:');
{
  const page = `<link rel="stylesheet" href="style.css"><script src="script.js"></script><div id="cart-modal" class="modal"></div>${FULL}`;
  const css = '.modal { display: none; }';
  ok('a modal opened by a class nothing styles is broken', /broken:a script switches on \.show, which nothing styles/.test(said({ 'index.html': page, 'style.css': css, 'script.js': 'm.classList.add("show");' })));
  ok('the same class, styled, is fine', !/switches on/.test(said({ 'index.html': page, 'style.css': css + '\n.modal.show { display: block; }', 'script.js': 'm.classList.add("show");' })));
  ok('every form is read: toggle, remove, replace and several names at once', /\.open, \.a, \.b/.test(said({ 'index.html': page, 'style.css': css, 'script.js': 'x.classList.toggle("open"); y.classList.add(\'a\', "b");' })));
}

console.log('\nFiles the site never uses:');
{
  const page = `<link rel="stylesheet" href="style.css"><script src="script.js"></script>${FULL}`;
  const found = said({ 'index.html': page, 'style.css': 'body{}', 'script.js': 'let a = 1;', 'styles.css': 'body { color: red; }', 'server.js': 'const express = require("express");\nconst app = express();\napp.listen(3000);' });
  ok('a stylesheet no page loads is named', /weak:no page loads styles\.css/.test(found));
  ok('server code is named as server code', /weak:server\.js is server code/.test(found));
  ok('a file every page loads is not', !/no page loads style\.css|no page loads script\.js/.test(found));
  ok('an image written out as text is named', /weak:placeholder_logo\.png is written as text/.test(said({ 'placeholder_logo.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' })));
}

console.log('\nWhat it hands back:');
{
  const found = look({ 'index.html': `<a href="cart.html">Cart</a><p>Lorem ipsum dolor sit</p>${FULL}` });
  ok('the worst comes first', C.linesOf(found)[0].includes('points at'));
  ok('it counts both kinds', C.summaryOf(found) === '1 thing that will not work and 1 that is unfinished');
  ok('a note to fix carries only what will not work', C.repairNote(found).includes('points at') && !C.repairNote(found).includes('Lorem'));
  ok('nothing wrong means nothing to ask', C.repairNote([]) === '' && C.summaryOf([]) === '');
}
ok('it never returns an unbounded list', look(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}.css`, '']))).length <= 24);

console.log(`\n${pass} passed, ${fail} failed  (src/js/swarm/project-check.js)`);
process.exit(fail ? 1 : 0);
