// ==============================================================
// Module-import checks
//
// Every `import ... from "..."` in the code the app loads must resolve to a
// file that is actually there.
//
// WHY THIS CHECK EXISTS
// ---------------------
// three.js ships as two files: three.module.min.js, which imports from
// three.core.min.js. Only the first was vendored. Every attempt to open 3D
// Forge asked for the missing file, the app's asset server answered with
// index.html the way it answers any unknown path, and the browser reported
// "'text/html' is not a valid JavaScript MIME type" — which does not sound
// like a missing file, and 3D Forge could not open at all.
//
// A syntax check cannot catch this: the file that does the importing parses
// perfectly. Nothing else in the repository looked at where an import points.
//
// Both kinds of specifier are checked:
//   relative ("./x.js", "../y/z.js")  → the file must exist on disk
//   bare     ("three")                → the import map in index.html must name
//                                       it, and that target must exist too
//
// Run with: npm run check:imports
// ==============================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = join(root, 'src');

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n          ' + detail : ''}`); }
}

// ── The import map, which is how bare specifiers resolve ─────────────────────
const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
const mapMatch = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
let importMap = {};
if (mapMatch) {
  try { importMap = JSON.parse(mapMatch[1]).imports || {}; } catch { importMap = {}; }
}

console.log('\nThe import map is readable:');
ok('index.html has an import map', !!mapMatch);
ok('it parses as JSON', Object.keys(importMap).length > 0, 'a broken map makes every bare import fail');

console.log('\nEvery target the import map names exists:');
for (const [specifier, target] of Object.entries(importMap)) {
  const file = join(srcDir, target.replace(/^\//, ''));
  ok(`"${specifier}" → ${target}`, existsSync(file), `${relative(root, file)} is not there`);
}

// ── Every .js file the app can load ──────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/**
 * The module specifiers a file really imports.
 *
 * Block comments are removed first. Without that, three.js's own JSDoc — which
 * documents each add-on with a line like `@three_import import { X } from
 * 'three/addons/...'` — reads as an import of a path that does not exist, and
 * prose in a comment that happens to contain the word "from" followed by a
 * quoted phrase reads as one too.
 *
 * The patterns then require a real import or export statement rather than the
 * bare word `from`, and none of them may cross a quote, a bracket or a
 * semicolon, so a match cannot run from one statement into the next.
 */
function specifiersIn(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found = [];
  const patterns = [
    /\bimport\b[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,  // import x from "y"
    /\bexport\b[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g,  // export x from "y"
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,               // import("y")
    /\bimport\s+['"]([^'"]+)['"]/g,                    // import "y"
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) found.push(m[1]);
  }
  return found;
}

console.log('\nEvery import resolves to a file that exists:');
{
  const files = walk(join(srcDir, 'js')).concat(walk(join(srcDir, 'platform')));
  let checked = 0;
  const broken = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const spec of specifiersIn(text)) {
      // Not a module path.
      if (/^(https?:|data:|node:)/.test(spec)) continue;
      checked++;

      let target;
      if (spec.startsWith('/')) {
        target = join(srcDir, spec.slice(1));
      } else if (spec.startsWith('.')) {
        target = resolve(dirname(file), spec);
      } else {
        // Bare specifier: only the import map can resolve it here.
        const mapped = importMap[spec];
        if (!mapped) {
          broken.push(`${relative(root, file)} imports "${spec}", which the import map does not name`);
          continue;
        }
        target = join(srcDir, mapped.replace(/^\//, ''));
      }

      if (!existsSync(target)) {
        broken.push(`${relative(root, file)} imports "${spec}" → ${relative(root, target)}, which is not there`);
      }
    }
  }

  ok(`${checked} imports across ${files.length} files`, broken.length === 0, broken.join('\n          '));
}

// ── The vendored libraries, which are the ones that arrive incomplete ────────
console.log('\nVendored libraries bring everything they depend on:');
{
  const vendorDir = join(srcDir, 'js', 'vendor');
  const files = existsSync(vendorDir) ? walk(vendorDir) : [];
  const broken = [];
  let checked = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const spec of specifiersIn(text)) {
      if (/^(https?:|data:|node:)/.test(spec)) continue;
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // bare: covered above
      checked++;
      const target = spec.startsWith('/')
        ? join(srcDir, spec.slice(1))
        : resolve(dirname(file), spec);
      if (!existsSync(target)) {
        broken.push(`${relative(root, file)} needs ${relative(root, target)}, which was not vendored with it`);
      }
    }
  }
  ok(`${files.length} vendored files, ${checked} internal imports`, broken.length === 0,
    broken.join('\n          '));
}

console.log(`\n${pass} passed, ${fail} failed  (module imports)`);
process.exit(fail ? 1 : 0);
