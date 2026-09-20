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
