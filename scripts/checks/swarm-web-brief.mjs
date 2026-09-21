// ==============================================================
// Website brief checks
//
// Loads the REAL src/js/swarm/web-brief.js. Holds that the agents on a web
// task are told the team's own file names, that only the agent delivering
// the answer is told to write every file, and that the bar for the result
// rules out the stand-ins a first draft reaches for.
//
// Run with: npm run check:swarm-web-brief
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src('js', 'swarm', 'web-brief.js'), sandbox, { filename: 'web-brief.js' });
// Loaded too, so that what agents are PROMISED will be checked is the same as
// what is actually checked. The two drifting apart is how a bar becomes words.
vm.runInContext(src('js', 'swarm', 'project-check.js'), sandbox, { filename: 'project-check.js' });
const W = sandbox.window.HCSwarmWebBrief;
const PC = sandbox.window.HCSwarmProjectCheck;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const team = { artifactContracts: [
  { name: 'spec.json' }, { name: 'script.js' }, { name: 'index.html' }, { name: 'style.css' }, { name: 'validation_report.txt' }, { name: 'index.html' },
] };

console.log('The site\'s files are the team\'s own:');
ok('only the page, stylesheet and script count as site files', W.siteFilesOf(team).join() === 'index.html,style.css,script.js');
ok('each once, the page first', W.siteFilesOf(team)[0] === 'index.html' && W.siteFilesOf(team).length === 3);
ok('a team with no file list has none', W.siteFilesOf({}).length === 0 && W.siteFilesOf(null).length === 0);
ok('a name with a path or a space is not a site file', W.siteFilesOf({ artifactContracts: [{ name: 'src/app.js' }, { name: 'my page.html' }] }).length === 0);

console.log('\nWho writes which file:');
const builder = W.brief({ task: 'build a portfolio website', siteFiles: W.siteFilesOf(team), isFinalOwner: false });
const finalOwner = W.brief({ task: 'build a portfolio website', siteFiles: W.siteFilesOf(team), isFinalOwner: true });
ok('every agent is told the exact names', builder.includes("THE SITE'S FILES: index.html, style.css, script.js."));
ok('... and that they replace any other names in its instructions', /replace any other file names in your instructions/.test(builder));
ok('the names it was told are the only ones in the note', !/styles\.css|app\.js/.test(builder));
ok('an agent that is not the last writes only its own files', /Write only the files your own instructions give you/.test(builder) && !/Write EVERY one/.test(builder));
ok('the agent delivering the answer writes every file', /Write EVERY one of these files, each complete: index\.html, style\.css, script\.js/.test(finalOwner));
ok('... and makes them agree', /every class, id, element and file name used in one exists in the others/.test(finalOwner));
ok('each file is shown as one named block', builder.includes('```css style.css') && builder.includes('```javascript script.js') && builder.includes('```html index.html'));
ok('a team with no file list gets the usual three', /THE SITE'S FILES: index\.html, styles\.css, app\.js\./.test(W.brief({ task: 'a landing page', siteFiles: [] })));
ok('a task that is not for the web gets no note', W.brief({ task: 'write a market report', siteFiles: [] }) === '');

console.log('\nThe bar for the result:');
for (const stand of ['John Doe', 'Lorem ipsum', 'Project One', 'example.com']) ok(`"${stand}" is ruled out`, builder.includes(stand));
ok('it asks for a visual identity set as custom properties', /CSS custom properties/.test(builder) && /Google Fonts/.test(builder));
ok('it no longer sends every site to a CSS framework', !/cdn\.tailwindcss\.com/.test(builder) && /do not pull in a CSS framework unless the request asks/.test(builder));
ok('it asks for every control to work', /Every button, link, form and toggle does something real/.test(builder));
ok('it asks for reduced motion to be respected', /prefers-reduced-motion/.test(builder));

console.log('\nThe Agent Swarm uses it:');
const mode = src('modes', 'agent-maker', 'mode.js');
ok('every agent\'s note comes from it', /HCSwarmWebBrief\.brief\(\{ task, siteFiles: execOptions\.siteFiles, isFinalOwner, bar: execOptions\.bar, images: window\.HCSwarmPhotos\?\.briefOf\(execOptions\.photos\) \}\)/.test(mode));
ok('... with the note on images the run\'s photographs make', /bpCopy\.photos = plan\.photos \|\| \[\]/.test(mode) && /photos: bp\.photos/.test(mode));
{
  const withImages = W.brief({ task: 'Build a website for a bakery', isFinalOwner: true, images: '\n\nIMAGES: draw them.' });
  ok('the note on images is part of the brief when there is one', withImages.includes('IMAGES: draw them.'));
  ok('images are never an address an agent made up', /Never an address you made up/.test(withImages));
}
ok('and carries what this run\'s own request asks of the result', /bar: Array\.isArray\(bp\.qualityGates\)/.test(mode));

// The bar used to be written out here in the language of a portfolio and
// appended to every web task, so a shop was held to a portfolio's bar.
{
  // A shop, a storefront and a browser game are web builds. None of them was,
  // which is why one team produced a good portfolio and a broken shop.
  for (const t of ['an online shop', 'build me an e-commerce site for a coffee shop', 'a storefront with a cart', 'code a snake game in the browser', 'a portfolio website', 'a landing page']) {
    ok(`"${t}" is a web build`, W.isWebTask(t));
  }
  ok('a market analysis is not', !W.isWebTask('do a market analysis of the scooter market'));
  ok('and neither is a poem', !W.isWebTask('write me a poem'));
  ok('a run owing html and js is a web build whatever it called itself', W.isWebRun('some unusual request', ['index.html', 'app.js']));
  ok('a run owing no files is not', !W.isWebRun('do a market analysis', []));

  const shopBar = ['the cart adds, removes and keeps its total right', 'the catalogue is data in its own file'];
  const withBar = W.brief({ task: 'an online shop', siteFiles: ['index.html'], bar: shopBar });
  const without = W.brief({ task: 'a landing page', siteFiles: ['index.html'], bar: [] });
  ok('this run\'s own bar reaches the agent', shopBar.every((l) => withBar.includes(l)));
  ok('a run with no bar of its own is given none', !/AND FOR THIS SITE IN PARTICULAR/.test(without));
  ok('a landing page is not told about a cart', !/cart/i.test(without));
  ok('the part true of every site is still there', /prefers-reduced-motion/.test(without));
  ok('a bar line is never taken as more than text', W.forThisSite(['a', null, '  ', 'a real line here']).split('\n- ').length === 3);
}
ok('a run reads the team\'s files from its blueprint', /siteFiles: window\.HCSwarmWebBrief\.siteFilesOf\(bp\)/.test(mode));
ok('the old note that named three files for everyone is gone', !/WEB FILE FORMAT/.test(mode));
ok('reviewers and the final agent get the files whole on a build', /const needsWhole = isFinalOwner \|\| \(execOptions\.codeBuild && /.test(mode));
ok('it loads before the Agent Swarm', src('boot.js').indexOf("'/js/swarm/web-brief.js'") > 0 && src('boot.js').indexOf("'/js/swarm/web-brief.js'") < src('boot.js').indexOf("'/modes/manifest.js'"));

console.log('\nAgents are told the test the app will actually apply:');
{
  const b = W.brief({ task: 'a portfolio website', isFinalOwner: true });
  ok('every local address must name one of the files', /names one of the files above/.test(b));
  ok('every id a script looks for must exist', /Every id a script looks for exists in the markup/.test(b));
  ok('two agents inventing two sets of class names is named as the failure', /two different sets of class names/.test(b));
  ok('Sass in a stylesheet is named', /darken\(\)/.test(b) && /@mixin/.test(b));
  ok('the placeholder services that stopped answering are named', /via\.placeholder\.com/.test(b) && /stopped answering/.test(b));
  ok('and it says what happens if they are found', /sent back to be put right/.test(b));
  const sentence = b.match(/never via\.placeholder[\s\S]*?broken image\./)[0];
  const named = [...sentence.matchAll(/\b[a-z][\w-]*(?:\.[a-z]{2,})+\b/g)].map((m) => m[0]);
  ok('every host it names is one the app really refuses', named.length >= 4 && named.every((h) => PC.DEAD_HOSTS.includes(h)));
}

console.log(`\n${pass} passed, ${fail} failed  (website brief)`);
if (fail) process.exit(1);
