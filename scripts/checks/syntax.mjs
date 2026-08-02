// ==============================================================
// Syntax check for every script the app loads
//
// src/ is served unbundled and there is no build step, so nothing sits
// between a typo and the user. A syntax error does not fail loudly: the
// engine stops executing that file, and every feature defined below the
// error silently ceases to exist — usually noticed as "the button does
// nothing" long after the commit that caused it.
//
// This is the cheapest possible guard against that. It proves the files
// PARSE. It does not prove the app works; only running it does.
//
// Run with: npm run check:syntax
// ==============================================================
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = walk(join(root, 'src')).sort();
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${relative(root, file)}`);
    console.error(String(err.stderr || err.message).split('\n').slice(0, 4).map((l) => `        ${l}`).join('\n'));
  }
}

console.log(`\n${files.length - failed} of ${files.length} scripts parse` + (failed ? ` — ${failed} FAILED` : ''));
process.exit(failed ? 1 : 0);
