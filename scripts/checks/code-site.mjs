// ============================================================
// A site HashCoder changed, read the way a browser would —
// src/js/code/site.js, and where the Coder uses it.
// Run with: npm run check:code-site
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const box = { window: {} };
vm.createContext(box);
for (const [file, name] of [[['js', 'code', 'balance.js'], 'balance.js'], [['js', 'swarm', 'project-check.js'], 'project-check.js'], [['js', 'code', 'verify.js'], 'verify.js']]) {
  vm.runInContext(src(...file), box, { filename: name });
}
vm.runInContext(process.argv[2] ? readFileSync(process.argv[2], 'utf8') : src('js', 'code', 'site.js'), box, { filename: 'site.js' });
const S = box.window.HCCodeSite;
const V = box.window.HCCodeVerify;
const C = box.window.HCSwarmProjectCheck;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('Which runs are checked:');
ok('one that changed a page, a stylesheet or a script', S.worthChecking(['/p/README.md', '/p/index.html']) && S.worthChecking(['/p/app.mjs']) && S.worthChecking(['/p/site.css']));
ok('not one that changed none', !S.worthChecking(['/p/main.py', '/p/README.md']) && !S.worthChecking([]) && !S.worthChecking(null));

console.log('\nWhat a page loads:');
{
  const refs = S.loads('<link href="css/site.css"><script src="./js/app.js"></script><script src="https://cdn.example.org/x.js"></script><link href="/root.css"><a href="page.html"><script src="//cdn.x/y.js"></script><link href="print.css?v=2">');
  ok('its own stylesheets and scripts, as it writes them', refs.join() === 'css/site.css,./js/app.js,print.css', refs.join());
  ok('a path from a folder, followed', S.resolve('/p/pages', '../css/site.css') === '/p/css/site.css' && S.resolve('/p', './js/app.js') === '/p/js/app.js');
  ok('in a Windows folder too', S.resolve('C:\\p\\pages', '../css/a.css') === 'C:\\p\\css\\a.css');
}

// A made-up project, read through the two functions gather is given.
const FILES = {
  '/p/index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="css/extra.css"><link rel="stylesheet" href="../outside.css"></head><body><nav class="main-nav">Menu</nav><section class="card">A real section of the page</section><script src="script.js"></script></body></html>',
  '/p/style.css': '.card { padding: 1rem; }\n.main-nav { display: none; }\n.revealed { opacity: 1; transform: none; }\n',
  '/p/script.js': "document.querySelectorAll('.card').forEach((el) => {\n  el.style.opacity = '0';\n  el.style.transform = 'translateY(20px)';\n});\nfunction shown(e) { e.target.classList.add('revealed'); }\nmenu.addEventListener('click', () => nav.classList.toggle('open'));\n// we'll style the menu later\n",
  '/p/css/extra.css': '.card h2 { margin: 0; }\n',
  '/p/notes.md': '# not part of the site\n',
  '/outside.css': 'body { color: red; }\n',
};
function fake(files = FILES) {
  const read = [];
  const io = {
    list: async (dir) => [...new Set(Object.keys(files).filter((f) => f.startsWith(dir + '/')).map((f) => f.slice(dir.length + 1).split('/')[0]))]
      .map((name) => ({ name, is_dir: !Object.prototype.hasOwnProperty.call(files, `${dir}/${name}`) })),
    read: async (path) => { read.push(path); if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error('Not read without asking'); return files[path]; },
  };
  return { io, read };
}

console.log('\nWhat is gathered:');
{
  const f = fake();
  const got = await S.gather(['/p/index.html', '/p/notes.md'], '/p', f.io);
  ok('the pages, stylesheets and scripts in the folder changed', ['index.html', 'style.css', 'script.js'].every((n) => got.has(n)));
  ok('and what a page loads from another folder of the project', got.has('extra.css') && got.get('extra.css').path === '/p/css/extra.css');
  ok('never a file outside the project, even one a page loads', !f.read.includes('/outside.css') && !got.has('outside.css'));
  ok('nor a file that is not part of a site', !got.has('notes.md'));
  const rel = await S.gather(['index.html'], '/p', fake().io);
  ok('a change named from the project\'s folder is found there', rel.has('script.js'));
  const broken = { ...FILES }; delete broken['/p/script.js'];
  const some = await S.gather(['/p/index.html'], '/p', fake(broken).io);
  ok('a file it cannot read is left out, and the rest still read', !some.has('script.js') && some.has('style.css'));
  const server = await S.gather(['/srv/app.js'], '/srv', fake({ '/srv/app.js': "fetch('https://example.com/a.png');\n", '/srv/db.js': 'x' }).io);
  ok('scripts with no page among them are not a site, and give nothing', server.size === 0);
  const failing = await S.gather(['/p/index.html'], '/p', { list: async () => { throw new Error('no'); }, read: async () => '' });
  ok('a folder it cannot list gives nothing, and no error', failing.size === 0);
  const many = Object.fromEntries([['/p/a.html', '<p>page</p>'], ...Array.from({ length: 50 }, (_, i) => [`/p/m${String(i).padStart(2, '0')}.js`, 'x'])]);
  ok(`no more than ${S.MOST_FILES} files`, (await S.gather(['/p/m00.js'], '/p', fake(many).io)).size === S.MOST_FILES);
}

console.log('\nWhat the agent is sent back with:');
{
  const files = await S.gather(['/p/script.js'], '/p', fake().io);
  const broken = C.inspect(files).filter((x) => x.level === 'broken').map((x) => x.what);
  ok('sections a script hides for good, named as never appearing', broken.some((w) => /switches on \.revealed/.test(w) && /invisible/.test(w)), broken.join(' | '));
  ok('a menu the script opens that nothing styles', broken.some((w) => /\.open, which nothing styles/.test(w)));
  ok('and nothing it would be wrong to report', !broken.some((w) => /stops in the middle|does not parse/.test(w)));
  const note = V.siteNote(broken);
  ok('a note from the app, not from the person, with each finding and what to do', note.kind === 'site' && note.message.startsWith(V.APP_NOTE) && /read the way a browser reads it/.test(note.message) && /\n- script\.js sets opacity/.test(note.message) && /Fix each one now, then finish/.test(note.message));
  ok('a saved conversation shows it as the step it was', V.noteStep(note.message) === note.step && note.step === 'Sent back with what the site check found');
}

console.log('\nHashCoder:');
{
  const mode = src('modes', 'code', 'mode.js');
  ok('checks a site once a run, while proving is switched on, only when the run changed one',
    /if \(!S \|\| !C \|\| !proof \|\| sent\.site \|\| cdrPrefs\(\)\.prove === false \|\| !root \|\| !S\.worthChecking\(proof\.changed\)\) return null;/.test(mode));
  ok('reading the files without asking', /S\.gather\(proof\.changed, root, \{ list: \(d\) => HC\.code\.listQuietly\(d\), read: \(f\) => HC\.code\.readQuietly\(f\) \}\)\.catch\(\(\) => null\)/.test(mode));
  ok('and sends back only what will not work', /C\.inspect\(files\)\.filter\(\(f\) => f\.level === 'broken'\)/.test(mode) && /window\.HCCodeVerify\.siteNote\(broken\)/.test(mode));
  ok('before a second look, when nothing else sent it back', /\|\| \(finalText\.trim\(\) \? \(await siteLook\(\)\) \|\| \(await secondLook\(\)\) : null\);/.test(mode) && /site: 0 \};/.test(mode));
  const boot = src('boot.js');
  ok('it is loaded before the modes', boot.indexOf("'/js/code/site.js'") > 0 && boot.indexOf("'/js/code/site.js'") < boot.indexOf("'/modes/boot.js'") && boot.indexOf("'/js/swarm/project-check.js'") < boot.indexOf("'/modes/boot.js'"));
  ok('Settings says so under proving changes', /A site it changed is read the way a browser would, and what will not work is sent back to be fixed\./.test(src('core', 'settings', 'panel.html')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/code/site.js)`);
process.exit(fail ? 1 : 0);
