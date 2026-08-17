// ==============================================================
// A function used as a value has to return one
//
// `loadAgents()` reads storage into `state.agents` and returns nothing. The
// conversation snapshot called it as though it were a getter —
// `loadAgents().find(…)` — so every export in the chat toolbar threw a
// TypeError on `undefined.find`. It threw inside an async function nobody
// awaited, so the rejection went nowhere: the menu closed, no file was written,
// and no error was shown. Three formats, every conversation, every build.
//
// Nothing could catch that. It parses, the name is spelled correctly, the
// function it names is real, and the mistake is one word — a loader where a
// getter was meant. Both are `verbNoun()` and only one of them answers.
//
// So: if a file calls a function it declares and then reads a property off the
// result, that function must return a value on some path. It is a narrow rule
// and it does not need to be clever, because the defect is not subtle once
// something is actually looking for it.
//
// Run with: npm run check:returns
// ==============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', '..', 'src');

let pass = 0, fail = 0;
function check(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** Every source file the app loads, vendor excluded. */
function jsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor' || entry === 'wheels' || entry.startsWith('__')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Strip comments and string literals.
 *
 * Without this, a `return` inside a comment counts, and a function name inside
 * a prose sentence reads as a call. Written as a scanner rather than a regex
 * because a regex cannot tell a `/` that divides from one that opens a regex
 * literal, and this source has both.
 */
function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      // Newlines are carried over, so a line number counted in the stripped
      // text still points at the right line of the real file.
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n') out += '\n';
        // A template literal can hold real code in ${…}, and that code is where
        // a call like `${loadAgents().length}` would hide.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += codeOnly(src.slice(start, i));
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The body of a function declaration, by brace matching from its header. */
function bodyAt(src, braceIndex) {
  let depth = 0;
  for (let i = braceIndex; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(braceIndex + 1, i);
    }
  }
  return '';
}

/**
 * Does this body return a value anywhere?
 *
 * `return;` on its own does not count — that is an early exit, not an answer.
 * Nested functions are left in on purpose: a body whose only `return` belongs
 * to a callback inside it is exactly the shape this rule cannot judge safely,
 * so it is treated as returning and left alone rather than reported wrongly.
 */
function returnsAValue(body) {
  return /\breturn\s*(?![;\s]*[};])/.test(body);
}

console.log('\nA function read as a value answers with one:');
{
  let offenders = 0;
  for (const file of jsFiles(srcDir)) {
    const rel = relative(srcDir, file);
    const code = codeOnly(readFileSync(file, 'utf8'));

    // Functions this file declares, and whether each answers.
    const declared = new Map();
    for (const m of code.matchAll(/(?:^|[\s;}])(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
      const brace = code.indexOf('{', m.index + m[0].length - 1);
      declared.set(m[2], { answers: returnsAValue(bodyAt(code, brace)), isAsync: !!m[1] });
    }
    if (!declared.size) continue;

    for (const [name, { answers, isAsync }] of declared) {
      if (answers) continue;
      // Used as a value: the call is followed by a property read or an index.
      // An async function does answer — with a promise — so waiting on one is
      // right and only reading something else off it is wrong.
      const tail = isAsync ? '(?!\\s*(?:then|catch|finally)\\b)' : '';
      const used = new RegExp(`(?<![.\\w$])${name}\\s*\\(\\s*\\)\\s*(?:\\?\\.|\\.|\\[)${tail}`, 'g');
      const hits = [...code.matchAll(used)];
      if (!hits.length) continue;
      offenders++;
      const line = code.slice(0, hits[0].index).split('\n').length;
      check(`${rel}:${line} ${name}()`, false,
        `${name} returns ${isAsync ? 'only a promise' : 'nothing'}, and this reads a property off the result — it evaluates to undefined and throws`);
    }
  }
  if (offenders === 0) check('no call reads a property off a function that returns nothing', true);
}

console.log(`\n${pass} passed, ${fail} failed  (functions used as values)`);
process.exit(fail ? 1 : 0);
