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
const W = sandbox.window.HCSwarmWebBrief;

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
ok('every agent\'s note comes from it', /HCSwarmWebBrief\.brief\(\{ task, siteFiles: execOptions\.siteFiles, isFinalOwner \}\)/.test(mode));
ok('a run reads the team\'s files from its blueprint', /siteFiles: window\.HCSwarmWebBrief\.siteFilesOf\(bp\)/.test(mode));
ok('the old note that named three files for everyone is gone', !/WEB FILE FORMAT/.test(mode));
ok('reviewers and the final agent get the files whole on a build', /const needsWhole = isFinalOwner \|\| \(execOptions\.codeBuild && /.test(mode));
ok('it loads before the Agent Swarm', src('boot.js').indexOf("'/js/swarm/web-brief.js'") > 0 && src('boot.js').indexOf("'/js/swarm/web-brief.js'") < src('boot.js').indexOf("'/modes/manifest.js'"));

console.log(`\n${pass} passed, ${fail} failed  (website brief)`);
if (fail) process.exit(1);
