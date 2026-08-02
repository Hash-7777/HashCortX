// ==============================================================
// Layout checks
//
// Scans the real stylesheets for the two mistakes that produce every "text is
// cut off" and "that label wrapped in half" bug in this app. Both were found
// in the sidebar and both are invisible until someone screenshots the app:
//
//   1. `text-overflow: ellipsis` on a FLEX CONTAINER. It only applies to the
//      box whose own text overflows, so on a container it does nothing — the
//      child is hard-clipped mid-word with no ellipsis to show that anything
//      was lost. This is what turned "Local host offline · cloud ready" into
//      "Local host offline · cl".
//
//   2. A fixed-basis flex item (`flex: 0 0 <px>`) holding text that can change
//      length, with no `white-space: nowrap`. The box cannot grow, so the text
//      wraps inside it. This is what split "Off" into "OF" and "F".
//
// Both checks are deliberately narrow. A first pass flagged twenty rules,
// nearly all of them icon buttons and layout columns that are fixed on
// purpose — and a check people learn to ignore is worse than no check. So:
//
//   * ellipsis-on-a-container is only reported when NO descendant rule handles
//     the ellipsis itself, since the common case is a harmless duplicate on
//     the parent of a child that already does it correctly;
//   * a fixed-width item is only reported when its selector and properties say
//     it holds text — a 32px avatar or a 10px chevron holds no text and is
//     supposed to be exactly that size.
//
// Run with: npm run check:layout
// ==============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cssDir = join(root, 'src', 'css');

const files = [join(root, 'src', 'styles.css')]
  .concat(readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => join(cssDir, f)));

// Selectors deliberately exempt, each with the reason it is safe.
const ALLOWED = new Map([
  ['.mem-val', 'sized to content with a min-width — the case this check exists for'],
]);

// Selector fragments that name a box holding variable text, rather than an
// icon, an avatar, a toggle or a layout column.
const HOLDS_TEXT = /(time|label|val|value|name|title|count|badge|text|stage|status)\b/i;
// …and fragments that mean the box holds a glyph, whatever it is called.
const HOLDS_A_GLYPH = /\b(svg|img|i|span\.icon)$|icon|chevron|dot|avatar|\.clear$|::?(before|after)/i;

let problems = 0;
let scanned = 0;
/** Every selector in every stylesheet, so a parent can be asked whether any
 *  descendant rule takes responsibility for the ellipsis. */
const ellipsisSelectors = [];

/** Split a stylesheet into { selector, body } pairs. Good enough for this
 *  codebase: hand-written CSS, no preprocessor, no nested at-rules inside
 *  declaration blocks. */
function rules(css) {
  // Strip comments first. Without this a comment above a rule is glued to the
  // selector, which both mangles the report and produces false hits when a
  // word the checks look for happens to appear in the prose.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

const has = (body, re) => re.test(body);

const parsed = files.map((file) => ({ file, rules: rules(readFileSync(file, 'utf8')) }));
for (const { rules: rs } of parsed) {
  for (const { selector, body } of rs) {
    if (/text-overflow\s*:\s*ellipsis/.test(body)) ellipsisSelectors.push(selector);
  }
}

/** Does some other rule set the ellipsis on a descendant of this selector? */
function childHandlesEllipsis(selector) {
  return ellipsisSelectors.some(
    (other) => other !== selector && other.startsWith(selector + ' ')
  );
}

for (const { file, rules: rs } of parsed) {
  const where = relative(root, file);
  for (const { selector, body } of rs) {
    scanned++;
    if (ALLOWED.has(selector)) continue;

    // 1. Ellipsis promised on a flex row, with nothing beneath it delivering.
    if (
      has(body, /text-overflow\s*:\s*ellipsis/) &&
      has(body, /display\s*:\s*(inline-)?flex/) &&
      !has(body, /flex-direction\s*:\s*column/) &&
      !childHandlesEllipsis(selector)
    ) {
      problems++;
      console.log(`  FAIL  ${where}  ${selector}`);
      console.log('        text-overflow: ellipsis on a flex container does nothing, and no');
      console.log('        descendant rule sets it either — the text is hard-clipped mid-word.');
      console.log('        Put it on the child that holds the text, with min-width: 0.');
    }

    // 2. A small fixed-width box that plainly holds text.
    const fixed = body.match(/flex\s*:\s*0\s+0\s+(\d+(?:\.\d+)?)px/);
    if (
      fixed && Number(fixed[1]) < 90 &&
      !has(body, /white-space\s*:\s*nowrap/) &&
      !has(body, /min-width/) &&
      HOLDS_TEXT.test(selector) && !HOLDS_A_GLYPH.test(selector)
    ) {
      problems++;
      console.log(`  FAIL  ${where}  ${selector}`);
      console.log(`        flex: 0 0 ${fixed[1]}px with no white-space: nowrap and no min-width.`);
      console.log('        When its text grows it wraps inside the box instead of resizing —');
      console.log('        this is what split "Off" into "OF" and "F" in the sidebar.');
    }
  }
}

console.log(
  problems
    ? `\n${problems} layout problem${problems === 1 ? '' : 's'} across ${files.length} stylesheets`
    : `\nno layout problems — ${scanned} rules across ${files.length} stylesheets`
);
process.exit(problems ? 1 : 0);
