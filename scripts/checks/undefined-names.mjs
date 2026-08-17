// ==============================================================
// A name that is called has to exist
//
// `isNarrow()` was called twice in app.js and defined nowhere in the app. Both
// calls sat at the end of their functions, so each one threw a ReferenceError
// and took the statement after it down: starting a new chat stopped focusing the
// composer, and nothing said why. It survived because a ReferenceError in an
// event handler goes to the console, and nobody is watching the console of a
// desktop app.
//
// Every script here is loaded as a plain <script>, so there is no bundler and no
// module resolution to notice. This is the check that notices.
//
// THE RULE IS DELIBERATELY COARSE: a bare identifier that is called must be
// bound somewhere in the same file, or be a known global. It does not do real
// scope analysis — a name declared in one function and called from another is
// accepted — because the defect this exists for is a name that is nowhere at
// all, and a coarse rule that never cries wolf is worth more than a precise one
// that has to be argued with.
//
// WHAT IT TOOK TO GET THERE. A first pass reported about a hundred and fifty
// names and every single one was wrong, in two ways worth writing down:
//
//   · A regex literal containing a quote sent the scanner into "string mode" and
//     blanked out the code after it — including the declarations it was looking
//     for. app.js alone has 112 of those. So the scanner has to know a `/` that
//     opens a pattern from a `/` that divides, which it decides from the token
//     before it.
//   · `readFile(path) {` inside an object literal is a method DEFINITION, and it
//     was being read as a call. So a call is only a call when the bracket it
//     opens is not followed by a body — that one rule removed most of the noise.
//
// Run with: npm run check:undefined-names
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
 * Blank out everything that is not code, keeping every offset.
 *
 * Comments, string and template literals, and regex literals are replaced
 * character for character with spaces (newlines kept), so line numbers stay
 * exact and nothing is glued to its neighbour. Code inside `${…}` is kept,
 * because that is real code and a call can hide in it.
 *
 * Whether a `/` opens a regex is decided by the last meaningful character
 * before it: after a value — a name, a number, `)`, `]` — it divides; after an
 * operator, a comma, an opening bracket or a keyword, it opens a pattern.
 */
function codeOnly(src) {
  const out = new Array(src.length);
  for (let k = 0; k < src.length; k++) out[k] = src[k] === '\n' ? '\n' : ' ';
  const keep = (k) => { out[k] = src[k]; };

  /** The last kept, non-space character before `k`. */
  function prevMeaningful(k) {
    for (let j = k - 1; j >= 0; j--) {
      if (out[j] === ' ' || out[j] === '\n') continue;
      return { ch: out[j], at: j };
    }
    return null;
  }
  function regexCanStartAt(k) {
    const prev = prevMeaningful(k);
    if (!prev) return true;
    if (/[\w$)\]]/.test(prev.ch)) {
      // A word could be a keyword that takes an operand — `return /x/` — rather
      // than a value being divided.
      let j = prev.at;
      while (j >= 0 && /[\w$]/.test(out[j])) j--;
      const word = out.slice(j + 1, prev.at + 1).join('');
      return /^(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await|throw)$/.test(word);
    }
    return true;
  }

  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '/' && regexCanStartAt(i)) {
      i++; // past the opening slash
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        else if (src[i] === '\n') break; // unterminated: it was division after all
        i++;
      }
      while (i < src.length && /[gimsuyd]/.test(src[i])) i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          const start = i;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          // The interpolation is code, so it goes through the same treatment —
          // a string inside it is still a string.
          const inner = codeOnly(src.slice(start, i));
          for (let k = start; k < i; k++) out[k] = inner[k - start];
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    keep(i);
    i++;
  }
  return out.join('');
}

/** Every name the file binds, however it binds it. */
function declaredIn(code) {
  const names = new Set();
  const add = (n) => { if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); };
  const addAll = (text) => { for (const m of String(text).matchAll(/[A-Za-z_$][\w$]*/g)) add(m[0]); };

  for (const m of code.matchAll(/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // A declaration list can span lines, destructure, AND hold several
  // declarators: `const d = new Date(), z = n => …` binds both d and z. Only
  // the text before each `=` is a binding — taking the whole statement would
  // count every name in the initialiser as declared and blind the check.
  for (const m of code.matchAll(/\b(?:const|let|var)\s+/g)) {
    let i = m.index + m[0].length;
    let depth = 0;
    const start = i;
    for (; i < code.length; i++) {
      const c = code[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ';' && depth === 0) break;
      else if (c === '\n' && depth === 0 && /^\s*(?:const|let|var|return|if|for|while|function)\b/.test(code.slice(i + 1, i + 40))) break;
    }
    let part = '';
    let d2 = 0;
    for (const c of code.slice(start, i) + ',') {
      if ('([{'.includes(c)) d2++;
      else if (')]}'.includes(c)) d2--;
      if (c === ',' && d2 === 0) { addAll(part.split('=')[0]); part = ''; continue; }
      part += c;
    }
  }
  // Parameters, of both functions and arrows, including destructured ones.
  for (const m of code.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) addAll(m[1]);
  // A single-parameter arrow needs no brackets.
  for (const m of code.matchAll(/(?:^|[\s(,=;])([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // Names the file itself publishes on window, and reads back off it.
  for (const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\bimport\s+\{?([^}'"]*)\}?\s+from/g)) addAll(m[1]);
  return names;
}

/**
 * Bare-identifier calls.
 *
 * A call, not a definition: `foo(a) {` and `foo(a) =>` declare something, and
 * reading those as calls is what made the first version of this useless.
 */
function callsIn(code) {
  const out = [];
  for (const m of code.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = code.indexOf('(', m.index + m[1].length);
    let depth = 0, close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) continue;
    const after = code.slice(close + 1, close + 4).trim();
    if (after.startsWith('{') || after.startsWith('=>')) continue; // a definition
    out.push({ name: m[1], index: m.index });
  }
  return out;
}

const KEYWORDS = new Set(('if for while switch catch return typeof new await else do function class in of delete void ' +
  'instanceof yield throw case with super constructor get set async from as export default let const var try finally ' +
  'break continue debugger null true false undefined this arguments import').split(/\s+/));

// Everything the platform provides. A name here is assumed to exist at runtime;
// anything else has to be bound by the file that calls it.
const GLOBALS = new Set(('Array Object String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError ' +
  'SyntaxError EvalError ReferenceError URIError AggregateError Map Set WeakMap WeakSet WeakRef Promise Proxy Reflect ' +
  'Function Intl ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array ' +
  'Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array parseInt parseFloat isNaN isFinite ' +
  'encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape eval structuredClone queueMicrotask ' +
  'setTimeout clearTimeout setInterval clearInterval setImmediate requestAnimationFrame cancelAnimationFrame ' +
  'requestIdleCallback cancelIdleCallback fetch alert confirm prompt btoa atob console window document navigator ' +
  'location history localStorage sessionStorage indexedDB IDBKeyRange performance screen crypto caches URL ' +
  'URLSearchParams Blob File FileReader FormData Headers Request Response ReadableStream WritableStream AbortController ' +
  'AbortSignal DOMException Event CustomEvent MouseEvent KeyboardEvent PointerEvent WheelEvent InputEvent FocusEvent ' +
  'DragEvent ClipboardEvent SubmitEvent MutationObserver ResizeObserver IntersectionObserver Image Audio Option Node ' +
  'Element HTMLElement HTMLCanvasElement HTMLImageElement HTMLInputElement Text DocumentFragment Range Selection ' +
  'XMLSerializer DOMParser XMLHttpRequest TextEncoder TextDecoder WebSocket Worker SharedWorker MessageChannel ' +
  'BroadcastChannel Notification ClipboardItem CSS matchMedia getComputedStyle scrollTo scrollBy open close ' +
  'postMessage addEventListener removeEventListener dispatchEvent getSelection WebAssembly globalThis self top parent ' +
  'frames opener speechSynthesis SpeechSynthesisUtterance SpeechRecognition webkitSpeechRecognition OffscreenCanvas ' +
  'createImageBitmap ResizeObserverEntry Path2D DOMMatrix devicePixelRatio innerWidth innerHeight' +
  // The app's own runtime bridge, set up before any of these files run.
  ' HC').split(/\s+/));

console.log('\nEvery name that is called exists somewhere:');
{
  let offenders = 0;
  for (const file of jsFiles(srcDir)) {
    const rel = relative(srcDir, file);
    const code = codeOnly(readFileSync(file, 'utf8'));
    const declared = declaredIn(code);
    // `typeof cloudModelLabel === "function" ? cloudModelLabel(x) : x` cannot
    // throw. The author already knows the name might not exist, so this check
    // has nothing to add — reporting it would only teach people to ignore it.
    const guarded = new Set([...code.matchAll(/typeof\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    const missing = new Map();
    for (const { name, index } of callsIn(code)) {
      if (declared.has(name) || GLOBALS.has(name) || KEYWORDS.has(name) || guarded.has(name)) continue;
      if (!missing.has(name)) missing.set(name, code.slice(0, index).split('\n').length);
    }
    for (const [name, line] of missing) {
      offenders++;
      check(`${rel}:${line} ${name}()`, false,
        'called here and bound nowhere in this file — a ReferenceError at runtime, which in an event handler is silent');
    }
  }
  if (offenders === 0) check('no call names something that does not exist', true);
}

console.log(`\n${pass} passed, ${fail} failed  (names that are called)`);
process.exit(fail ? 1 : 0);
