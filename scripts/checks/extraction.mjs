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

/** A name used inside a regex must be escaped — "$" is an anchor otherwise. */
const rx = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Names published as window.<name> by any script the app loads.
 *
 * A module reading HCMemory or HCMarkdown is reading a global, not reaching
 * into app.js's closure, even though app.js also keeps a local alias for it.
 */
function publishedGlobals(walkFrom) {
  const out = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]);
      }
    }
  };
  walk(walkFrom);
  return out;
}

/**
 * Source with comments and string bodies blanked out, in one pass.
 *
 * Ordered regexes cannot do this. Stripping comments first turns the `//` in
 * "https://ollama.com" into a comment, which swallows the closing quote and
 * desynchronises every string after it — that is what made this check report
 * `data` as a free variable when the only `data` in the file was inside
 * "tr[data-lm-model]". Stripping strings first has the mirror problem: an
 * apostrophe in a comment opens a string that never closes.
 *
 * And a template literal is not simply a string. `${escapeHtml(f.key)}` is
 * code, in the middle of one. Blanking the whole literal hid every call the
 * memory pane makes — including the one name that had actually shipped broken.
 * So interpolations are walked as code, to any depth.
 */
function codeOnly(src) {
  let out = '';
  let i = 0;

  const readString = (quote) => {
    i++;                                     // opening quote
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === quote) { i++; return; }
      if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        const from = i;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          else if (src[i] === '"' || src[i] === "'" || src[i] === '`') { readString(src[i]); continue; }
          if (depth > 0) i++;
        }
        out += ' ' + codeOnly(src.slice(from, i)) + ' ';   // the interpolation is code
        i++;                                                // closing brace
        continue;
      }
      i++;
    }
  };

  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"' || c === "'" || c === '`') {
      readString(c);
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

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

const GLOBALS = publishedGlobals(srcDir);

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
  // Comments and string bodies removed, so prose cannot look like code.
  const appCode = codeOnly(appSrc);

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
      const bareRead = new RegExp(`(?<![.\\w$])${rx(name)}(?![\\w$])(?!\\s*:)`);
      if (!bareRead.test(appCode)) continue;
      orphans++;
      check(`${name} (moved to ${file})`, false,
        'app.js still reads this name but no longer declares it — it is a ReferenceError at runtime, and only where the code actually runs');
    }
  }
  if (orphans === 0) check('no name is read in app.js after moving out of it', true);
}

// ── 3b. Nothing in a module reads a name it does not have ────────────────
//
// The mirror of the rule above, and the direction that actually shipped a bug.
//
// memory-pane.js was moved out of app.js and kept using escapeHtml, which is
// destructured from HCMarkdown near the top of app.js and was therefore in
// scope right up until the move. Afterwards it was a free variable. The pane
// still opened, because the throw only happens on the line that renders a
// fact — so with an empty memory nothing went wrong, which is exactly what the
// verification at the time saw. Anyone with a saved fact got an empty list and
// a console error.
//
// So: a module may not read a bare name that app.js declares, unless it
// declares that name itself or destructures it from its own deps.
console.log('\nNothing in a module reads a name it does not have:');
{
  const appTop = new Set([
    ...[...read('js/app.js').matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ...[...read('js/app.js').matchAll(/(?:^  (?:const|let|var)\s+|,\s*)([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]),
    // Multi-line destructuring counts. app.js pulls escapeHtml out of
    // HCMarkdown across three lines, and a one-line pattern misses it — which
    // is exactly the name that shipped broken.
    ...[...read('js/app.js').matchAll(/^  (?:const|let|var)\s*\{([\s\S]*?)\}\s*=/gm)]
      .flatMap((m) => m[1].split(',').map((n) => n.split(':').pop().trim())).filter(Boolean),
  ]);

  let free = 0;
  for (const file of modules()) {
    const src = read(file);
    const owns = new Set([
      ...[...src.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...src.matchAll(/(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/g)]
        .flatMap((m) => m[1].split(',').map((n) => n.split(':').pop().trim())).filter(Boolean),
      // parameters count as owned
      ...[...src.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)]
        .flatMap((m) => m[1].split(',').map((n) => n.trim().split(/[=\s]/)[0].replace(/^\.\.\./, '')))
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)),
    ]);
    const code = codeOnly(src);

    for (const name of appTop) {
      if (owns.has(name)) continue;
      if (GLOBALS.has(name)) continue;            // window.<name>, not app.js's closure
      if (!new RegExp(`(?<![.\\w$])${rx(name)}(?![\\w$])(?!\\s*:)`).test(code)) continue;
      free++;
      check(`${file} reads ${name}`, false,
        'this name is declared in app.js and is not declared, injected or destructured here — it was in scope before the move and is a free variable now');
    }
  }
  if (free === 0) check('every name a module reads is one it owns or is given', true);
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
