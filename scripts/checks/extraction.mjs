// ==============================================================
// Split-out modules — checks
//
// app.js is being taken apart a piece at a time. Each piece becomes a file
// under src/core/ or src/data/ that publishes one window.HC* object, and app.js
// keeps a short binding to it.
//
// That move has exactly two ways to go wrong silently, and this session hit
// both of them within an hour of each other.
//
// THE FIRST: the module is written, the binding is written, and the script tag
// is forgotten. window.HCSettingsMemory is undefined, the call throws, and
// because it throws inside a promise the console shows one line nobody is
// watching. The app still opens.
//
// THE SECOND, worse: the thing being replaced was a `function`, and the
// binding that replaced it is a `const`. Function declarations hoist; const
// does not. Any call site ABOVE the binding is now reading a variable in its
// temporal dead zone. app.js calls activateSettingsTab("settings") near the
// top, which reads renderLocalPane — declared 30 lines further down. The
// ReferenceError aborted the rest of app.js, and the app still opened, and
// looked fine, because almost everything had already run by then.
//
// Neither is caught by reading the diff. Both are caught by two rules:
//
//   1. Every module under src/core/ and src/data/ is loaded, and loaded before
//      app.js.
//   2. Every binding in app.js that points at one of those modules is a
//      function declaration if anything above it uses the name.
//
// Run with: npm run check:extraction
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');
const read = (f) => readFileSync(join(srcDir, f), 'utf8');
const html = read('index.html');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** Every .js file under the folders app.js is being split into. */
function modules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(relative(srcDir, full).split('\\').join('/'));
    }
  };
  for (const folder of ['core', 'data']) {
    try { if (statSync(join(srcDir, folder)).isDirectory()) walk(join(srcDir, folder)); }
    catch { /* folder does not exist yet */ }
  }
  return out.sort();
}

// ── 1. Loaded, and loaded first ──────────────────────────────────────────
console.log('\nEvery split-out module is loaded before app.js:');
{
  const order = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
  const appAt = order.indexOf('js/app.js');
  check('app.js is in the script list', appAt !== -1);

  const found = modules();
  check('there are modules to check', found.length > 0, 'src/core and src/data are both empty');

  for (const file of found) {
    const at = order.indexOf(file);
    if (at === -1) {
      check(file, false, 'no <script src> in index.html — the window.HC* object will be undefined at the call site');
    } else {
      check(`${file} (position ${at + 1})`, at < appAt, 'loaded after app.js, which reads it');
    }
  }
}

// ── 2. A binding that replaced a function stays a function ───────────────
//
// The narrow, exact rule: in app.js, a top-level `const NAME = … window.HC…`
// whose NAME appears anywhere on an earlier line. That is the temporal dead
// zone, and it is always a bug — the earlier line either throws now or will as
// soon as it runs.
console.log('\nNo binding is read before it exists:');
{
  const lines = read('js/app.js').split('\n');
  const offenders = [];

  lines.forEach((line, i) => {
    const m = line.match(/^  (?:const|let)\s+([A-Za-z_$][\w$]*)\s*=.*window\.HC[A-Za-z]*\b/);
    if (!m) return;
    const name = m[1];
    const word = new RegExp(`\\b${name}\\b`);
    for (let j = 0; j < i; j++) {
      // A mention inside a comment is not a read.
      const code = lines[j].replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (word.test(code)) {
        offenders.push({ name, declaredAt: i + 1, usedAt: j + 1, line: lines[j].trim() });
        return;
      }
    }
  });

  if (offenders.length === 0) {
    check('no module binding is used above its declaration', true);
  } else {
    for (const o of offenders) {
      check(`${o.name}`, false,
        `declared with const/let on line ${o.declaredAt} but read on line ${o.usedAt} — write it as a function declaration so it hoists\n          ${o.usedAt}: ${o.line.slice(0, 90)}`);
    }
  }
}

// ── 3. Nothing left behind reads a name that moved ───────────────────────
//
// The failure this catches happened while the knowledge base was being moved.
// `_ragCache` went with it, but one function in app.js still read the variable
// directly — a reach across a boundary that worked fine while both halves were
// in one closure. Moved apart, it is a ReferenceError, thrown inside a bridge
// function that nothing calls at boot. Every static check passed. It only
// surfaced when the feature was actually exercised in a browser.
//
// So: any name a module declares at its top level must not also be read in
// app.js, unless app.js declares that name itself as its own binding.
console.log('\nNothing in app.js reads a name that moved out of it:');
{
  const appSrc = read('js/app.js');
  const appDeclares = new Set([
    // At ANY depth, not just the top level. A name declared inside a function
    // in app.js is bound there — `const init = …` in a fetch helper is not a
    // read of a module's `init`, and treating it as one buries the real ones.
    ...[...appSrc.matchAll(/^\s*(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    // Every declarator, not just the first: `const a = x, b = y;` declares both,
    // and reading only `a` reports `b` as an orphan.
    ...[...appSrc.matchAll(/(?:^\s*(?:const|let|var)\s+|,\s*)([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]),
    // Destructured bindings — `const { A, B } = window.HCPrompts;`
    ...[...appSrc.matchAll(/^\s*(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)]
      .flatMap((m) => m[1].split(',').map((n) => n.split(':').pop().trim()))
      .filter(Boolean),
  ]);
  // Strip comments and strings so prose and message text cannot look like code.
  const appCode = appSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

  let orphans = 0;
  for (const file of modules()) {
    const src = read(file);
    const declared = [
      ...[...src.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
      ...[...src.matchAll(/^  (?:const|let|var) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
      ...[...src.matchAll(/^    (?:const|let|var) (_[A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ];
    for (const name of new Set(declared)) {
      if (appDeclares.has(name)) continue;          // app.js has its own binding
      // A bare read only. `window.HCRag.init(…)` is a property, and
      // `{ isRagEnabled: … }` is a key — neither reaches the module's scope.
      const bareRead = new RegExp(`(?<![.\\w$])${name}(?![\\w$])(?!\\s*:)`);
      if (!bareRead.test(appCode)) continue;
      orphans++;
      check(`${name} (moved to ${file})`, false,
        'app.js still reads this name but no longer declares it — it is a ReferenceError at runtime, and only where the code actually runs');
    }
  }
  if (orphans === 0) check('no name is read in app.js after moving out of it', true);
}

// ── 4. Each module publishes exactly one name ────────────────────────────
//
// One file, one window.HC* object. A module that sets two of them is two
// modules, and the next person to move something will have to work out which
// half they are looking at.
console.log('\nEach module publishes one thing:');
for (const file of modules()) {
  const published = [...new Set([...read(file).matchAll(/^\s*window\.(HC[A-Za-z]*)\s*=/gm)].map((m) => m[1]))];
  check(`${file} → ${published.join(', ') || 'nothing'}`, published.length === 1,
    published.length === 0 ? 'publishes no window.HC* object, so app.js cannot reach it' : `publishes ${published.length}`);
}

console.log(`\n${pass} passed, ${fail} failed  (split-out modules)`);
process.exit(fail ? 1 : 0);
