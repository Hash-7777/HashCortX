// ==============================================================
// What the page actually loads
//
// Three checks need the same answer to the same question — which stylesheets
// and which scripts does this app load, in what order — and getting it wrong
// makes a check quietly stop covering things rather than fail.
//
// It has already happened twice.
//
// theme.mjs originally read the src/css/ directory. It therefore never saw
// src/styles.css, 1,500 lines calling itself the master design system and
// linked last so it has the final say. A guard that reads a directory is a
// guard the page can step around.
//
// Then the modes moved into src/modes/<id>/ and stopped being written into
// index.html by hand. Reading only the <link> tags in the markup went blind to
// seven stylesheets in one commit — and the failure was a budget entry for a
// file "no longer loaded", which reads like tidy-up rather than like a hole.
//
// So the answer is assembled from both places the app declares an asset: the
// tags in index.html, and the mode list in src/modes/manifest.js. Order is
// preserved, because for stylesheets order is the whole question — mode sheets
// are inserted before styles.css by the loader, exactly where they used to sit.
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Every mode the app loads: its id and the element its panel is inserted into. */
export function modes(srcDir) {
  const src = readFileSync(join(srcDir, 'modes', 'manifest.js'), 'utf8');
  const list = /MANIFEST:\s*\[([\s\S]*?)\n\s*\],/.exec(src)?.[1] || '';
  return [...list.matchAll(/\{\s*id:\s*['"]([a-z0-9-]+)['"]\s*,\s*host:\s*['"]([^'"]+)['"]/g)]
    .map((m) => ({ id: m[1], host: m[2] }));
}

/** The mode ids, in load order. */
export function modeIds(srcDir) {
  return modes(srcDir).map((m) => m.id);
}

/**
 * Every piece of markup that is not index.html, concatenated.
 *
 * This started as "the mode panels" and had to grow the moment the settings,
 * agent, memory-map and small overlays moved out of the shell too — a check
 * that reads a hardcoded list of panels goes blind the same way one that reads
 * a hardcoded directory does. It walks for .html instead.
 */
export function panelMarkup(srcDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html') && relative(srcDir, full) !== 'index.html') {
        out.push(readFileSync(full, 'utf8'));
      }
    }
  };
  walk(srcDir);
  return out.join('\n');
}

/**
 * Every stylesheet the app loads, in cascade order, vendor sheets excluded.
 *
 * Mode sheets are placed where boot.js puts them: immediately before
 * styles.css, which stays last.
 */
export function stylesheets(srcDir) {
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const fromMarkup = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1].replace(/^\//, ''))
    .filter((f) => !f.includes('vendor/'));

  const fromModes = modeIds(srcDir).map((id) => `modes/${id}/mode.css`);

  const last = fromMarkup.indexOf('styles.css');
  if (last === -1) return [...fromMarkup, ...fromModes];
  return [...fromMarkup.slice(0, last), ...fromModes, ...fromMarkup.slice(last)];
}

/**
 * Every script the app loads, in execution order, vendor scripts excluded.
 *
 * index.html no longer lists them. src/boot.js holds the ordered list and adds
 * each one with async = false, which preserves that order; the mode files come
 * last, added by modes/boot.js from the manifest.
 */
export function scripts(srcDir) {
  const html = readFileSync(join(srcDir, 'index.html'), 'utf8');
  const fromMarkup = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((m) => m[1].replace(/^\//, ''))
    .filter((f) => !f.includes('vendor/'));

  const boot = readFileSync(join(srcDir, 'boot.js'), 'utf8');
  const list = /const SCRIPTS = \[([\s\S]*?)\n  \];/.exec(boot)?.[1] || '';
  const loaded = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\//, ''));

  return [...fromMarkup, ...loaded, ...modeIds(srcDir).map((id) => `modes/${id}/mode.js`)];
}
