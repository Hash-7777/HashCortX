// ==============================================================
// Reading the team's work the way a person would open it
//
// THE DEFECT THIS FIXES. The app took the agents at their word. Whatever came
// back was saved, previewed and called finished, and the first thing that ever
// looked at it properly was the person who asked for it. One real run handed
// back a shop whose header pointed at an image that was in the project and
// never went into the page, whose products all pointed at a placeholder
// service that no longer answers, whose stylesheet called a function that
// exists in Sass and not in CSS, and whose page linked to a cart page nobody
// had written — and the run reported that the task was done.
//
// Nothing here needs a model. These are the things a person notices in the
// first ten seconds and code can see in a millisecond, so the app sees them
// first: what the plan owed and nobody wrote, a file that points at a file
// that is not there, an id a script reaches for that the page does not have,
// a class the markup leans on that nothing styles, text left over from a
// template, a file that stops in the middle, and an address that is known not
// to answer.
//
// It reports. It changes nothing. What can be repaired safely is repaired
// where the page is built (js/swarm/site.js); what cannot is said plainly, so
// the team can be asked to put it right and the person is never told a broken
// result is a finished one.
//
// It is written for any kind of work, not for websites. A campaign, a plan or
// a report is checked for what it owes, for template text and for a file that
// stops mid-sentence; the markup checks simply find nothing to look at.
//
// Pure: files in, findings out. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmProjectCheck.
// Checked by scripts/checks/swarm-project-check.mjs.
// ==============================================================

(function () {
  'use strict';

  const MAX_FINDINGS = 24;
  const MAX_NAMED = 6;
  const EMPTY_CHARS = 20;

  // Addresses that used to serve placeholder images and no longer answer. A
  // page full of these looks broken in exactly the way an unfinished page
  // looks broken, and nothing in the markup says why.
  const DEAD_HOSTS = [
    'via.placeholder.com', 'placeholder.com', 'placehold.it', 'lorempixel.com',
    'unsplash.it', 'placeimg.com', 'fillmurray.com', 'placecage.com', 'baconmockup.com',
  ];

  // Text that belongs to a template rather than to this request.
  const TEMPLATE_TEXT = [
    [/lorem ipsum/i, 'lorem ipsum'],
    [/\bjohn doe\b|\bjane doe\b/i, 'a made-up name'],
    [/\bproject (?:one|two|three)\b/i, 'Project One'],
    [/\bexample\.com\b/i, 'example.com'],
    [/\byour name here\b|\[your name\]/i, 'a name that was never filled in'],
    [/a brief description of/i, 'a description that was never written'],
    [/\bTODO\b|\bFIXME\b|\bcoming soon\b/i, 'work left for someone else'],
  ];

  // Sass, in a file the browser reads as CSS. The browser drops the whole
  // declaration, so the colour, the mixin or the variable simply does nothing.
  const SASS_IN_CSS = [
    [/\b(?:darken|lighten|saturate|desaturate|mix|rgba?\s*\(\s*\$)\s*\(/, 'a Sass colour function'],
    [/@(?:mixin|include|extend|use|forward)\b/, 'a Sass rule'],
    [/^\s*\$[\w-]+\s*:/m, 'a Sass variable'],
  ];

  const lower = (s) => String(s || '').toLowerCase();
  const baseName = (p) => lower(p).split(/[?#]/)[0].split('/').pop();
  const isHtml = (n) => /\.html?$/.test(n);
  const isCss = (n) => /\.css$/.test(n);
  const isJs = (n) => /\.m?js$/.test(n);
  const asMap = (files) => (files && typeof files.get === 'function' ? files : new Map(Object.entries(files || {})));

  // A value left for someone else to decide, written where the browser reads
  // it as code: "color: [brand-primary]" is dropped whole, so the header it
  // was meant to colour has no colour, and src="[logo-url]" is a broken image.
  // A bracket in visible text, such as a name the person has not given yet,
  // is the placeholder the brief asks for and is left alone.
  const CSS_BLANK = /:\s*[^;{}\n]*\[[A-Za-z][\w\s-]{1,40}\][^;{}\n]*;/;
  const ATTR_BLANK = /\b(src|href|srcset|content)\s*=\s*["'](?:[a-z]+:)?\[[^\]"']{2,40}\]["']/i;
  // An image or a page at a domain kept for examples. It serves nothing.
  const EXAMPLE_REF = /(?:src|href|srcset)\s*=\s*["']https?:\/\/(?:www\.)?example\.(?:com|org|net)|url\(\s*["']?https?:\/\/(?:www\.)?example\.(?:com|org|net)|["']https?:\/\/(?:www\.)?example\.(?:com|org|net)\/[^"']*\.(?:jpe?g|png|gif|webp|avif|svg)["']/i;
  // What a script switches on and off: classList.add/remove/toggle/replace and
  // the names in them.
  const CLASS_SWITCH = /classList\.(?:add|remove|toggle|replace)\(([^)]*)\)/g;
  // Server code: it runs under Node, not in the page.
  const SERVER_CODE = /\brequire\(\s*["'](?:express|http|fs|path|cookie-parser|body-parser)["']\s*\)|\bfrom\s+["'](?:express|node:\w+)["']|\bapp\.listen\(/;

  /** A reference a page makes to something outside itself. */
  const REF = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const OUTSIDE = /^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i;

  /**
   * Where a stylesheet or a script stops parsing: `{ line, what }`, or null.
   * Read by HashCoder's bracket reader (js/code/balance.js), which sets
   * comments, strings, templates and patterns aside; an apostrophe in a
   * comment is not the start of a string. Without it, braces are counted
   * outside strings and comments, and only one left open is reported.
   */
  function fault(code, name) {
    const B = typeof window !== 'undefined' && window.HCCodeBalance;
    const family = B && B.familyOf(name);
    if (family) return B.firstFault(String(code), family);
    const text = String(code).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    let depth = 0, inString = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    return depth > 0 ? { line: 0, what: 'a "{" is never closed' } : null;
  }

  // A style a script sets on elements directly, and a class it switches on
  // to change that style: a style set directly wins over every class, so the
  // class changes nothing and the elements stay as the script left them. A
  // section faded out to be shown on scrolling is never shown.
  const STYLE_SET = /\.style\.([a-zA-Z]+)\s*=(?!=)\s*([^;\n]*)/g;
  const CLASS_ON = /classList\.(?:add|toggle|replace)\(([^)]*)\)/g;
  const LITERAL = /^(?:(["'`])[^"'`$]*\1|-?\d+(?:\.\d+)?)$/;
  const kebab = (p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

  /**
   * `{ file, props, cls }` for each class a script switches on that sets a
   * property the script has fixed on elements directly, or []. A property
   * counts as fixed when every script gives it the one same literal value
   * and never clears it; one changed again from the script is not stuck.
   */
  function stuckStyles(files) {
    const given = new Map();   // property -> { values, file }
    const on = new Set();
    let cleared = '';
    for (const [n, f] of files) {
      if (!isJs(lower(n))) continue;
      const js = String((f && f.content) || '');
      for (const m of js.matchAll(STYLE_SET)) {
        const had = given.get(m[1]) || { values: new Set(), file: lower(n) };
        had.values.add(m[2].trim());
        given.set(m[1], had);
      }
      for (const m of js.matchAll(CLASS_ON)) for (const q of m[1].matchAll(/["']([-_a-zA-Z][\w-]*)["']/g)) on.add(q[1]);
      cleared += ` ${(js.match(/removeProperty\(\s*["'][\w-]+["']|\.style\.cssText\s*=|removeAttribute\(\s*["']style["']|setAttribute\(\s*["']style["']/g) || []).join(' ')}`;
    }
    if (!on.size || /cssText|Attribute/.test(cleared)) return [];
    const fixed = new Map();
    for (const [p, had] of given) {
      const [value] = had.values;
      if (had.values.size === 1 && LITERAL.test(value) && !/^(["'`])\1$/.test(value) && !cleared.includes(`'${kebab(p)}'`) && !cleared.includes(`"${kebab(p)}"`)) fixed.set(kebab(p), had.file);
    }
    if (!fixed.size) return [];
    const css = [];
    for (const [n, f] of files) {
      const text = String((f && f.content) || '');
      if (isCss(lower(n))) css.push(text);
      else if (isHtml(lower(n))) for (const m of text.matchAll(/<style[\s>]([\s\S]*?)<\/style>/gi)) css.push(m[1]);
    }
    const stuck = new Map();   // class -> properties
    for (const r of css.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Only the element a selector styles itself can clash: not its ::before
      // or ::after, which a style set directly never reaches, nor a child.
      const cls = r[1].split(',').map((sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop() || '')
        .filter((last) => !/::?(?:before|after|marker|placeholder|selection|first-line|first-letter)\b/i.test(last))
        .flatMap((last) => [...last.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((c) => c[1])).find((c) => on.has(c));
      if (!cls) continue;
      for (const d of r[2].split(';')) {
        const at = d.indexOf(':');
        const prop = d.slice(0, at).trim().toLowerCase();
        if (at < 0 || !fixed.has(prop) || /!important/i.test(d.slice(at))) continue;
        if (!stuck.has(cls)) stuck.set(cls, new Set());
        stuck.get(cls).add(prop);
      }
    }
    return [...stuck].map(([cls, props]) => ({ file: fixed.get([...props][0]), props: [...props], cls }));
  }

  // ── The standard a site is held to ────────────────────────────────────
  //
  // What works for a person looking at the page and still lets the page
  // down: content that starts hidden until a script shows it, which search
  // engines, link previews and a visitor whose script fails never see; an
  // animation that never ends; a blur behind a bar that stays on screen,
  // redrawn on every scroll; movement with no rule for a visitor who asked
  // for less of it; pictures with no size, so the page jumps as each one
  // arrives. Reported at their own level, 'standard', below "will not work".

  /** Class names of things meant to start hidden: menus, dialogs, tooltips and the like. */
  const MEANT_HIDDEN = /menu|nav|modal|dialog|drop|popup|popover|tooltip|toast|overlay|drawer|panel|tab|accordion|collapse|hidden|sr-only|visually|skip|lightbox|cart|search|mobile|open|active|show/i;
  /** Class names of things that run while something is happening. */
  const WHILE_BUSY = /spin|load|progress|busy|skeleton/i;

  /** A stylesheet's rules, `{ selector, decls, media }`, rules inside @media and the like kept with their condition. */
  function rulesOf(css, media = '') {
    const s = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      let prelude = s.slice(i, open);
      prelude = prelude.slice(Math.max(prelude.lastIndexOf(';'), prelude.lastIndexOf('}')) + 1).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (/^@(?:media|supports|layer|container)\b/i.test(prelude)) out.push(...rulesOf(body, `${media} ${prelude}`.trim()));
      else if (prelude && !prelude.startsWith('@')) {
        const decls = new Map();
        for (const d of body.split(';')) { const at = d.indexOf(':'); if (at > 0) decls.set(d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim().toLowerCase()); }
        out.push({ selector: prelude, decls, media });
      }
      i = j;
    }
    return out;
  }

  /** The element each selector of a rule styles: the last part of each, with nothing after a colon. */
  const subjects = (selector) => String(selector).split(',').map((sel) => sel.trim().split(/\s*[\s>+~]\s*/).pop() || '');

  /** What in a site's files falls short of the standard: `[{ file, what }]`. */
  function standard(files) {
    const css = [], js = [], pages = [];
    for (const [n, f] of files) {
      const name = lower(n), text = String((f && f.content) || '');
      if (isCss(name)) css.push(text);
      else if (isJs(name)) js.push(text);
      else if (isHtml(name)) { pages.push({ name, text }); for (const m of text.matchAll(/<style[\s>]([\s\S]*?)<\/style>/gi)) css.push(m[1]); for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) js.push(m[1]); }
    }
    if (!pages.length) return [];
    const style = css.join('\n'), script = js.join('\n'), rules = rulesOf(style);
    const reduced = (r) => /prefers-reduced-motion\s*:\s*reduce/i.test(r.media);
    const out = [];
    const named = (list) => list.slice(0, 3).join(', ');

    // Hidden until a script shows it.
    const used = new Map();
    for (const p of pages) for (const m of p.text.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)) for (const c of m[1].split(/\s+/)) if (c) used.set(c, (used.get(c) || 0) + 1);
    const shows = /classList\.(?:add|toggle|replace)\(|IntersectionObserver|\.style\.opacity\s*=/.test(script);
    const hidden = new Set();
    for (const r of rules) {
      if (reduced(r) || !(r.decls.get('opacity') === '0' || r.decls.get('visibility') === 'hidden')) continue;
      for (const last of subjects(r.selector)) {
        if (last.includes(':')) continue;   // hidden in a state, such as :hover
        for (const c of [...last.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])) if (!MEANT_HIDDEN.test(c) && (used.get(c) || 0) >= 2) hidden.add(`.${c}`);
      }
    }
    if (shows && (hidden.size || /\.style\.opacity\s*=\s*["']?0["']?\s*;/.test(script))) {
      out.push({ file: 'styles', what: `content starts hidden until a script shows it${hidden.size ? ` (${named([...hidden])})` : ''}: search engines, link previews and a visitor whose script fails see nothing there. Start it visible, and hide only what is still below the screen once the visitor starts to scroll` });
    }

    // An animation that never ends.
    const endless = rules.filter((r) => !reduced(r) && (/\binfinite\b/.test(r.decls.get('animation') || '') || r.decls.get('animation-iteration-count') === 'infinite') && !WHILE_BUSY.test(r.selector)).map((r) => r.selector);
    if (endless.length) out.push({ file: 'styles', what: `an animation runs forever (${named(endless)}): the page keeps drawing and the battery keeps working while nothing changes. Let it end, or run it only while something is happening` });

    // A blur behind a bar that stays on screen.
    const stays = new Set(rules.filter((r) => /^(?:sticky|fixed)\b/.test(r.decls.get('position') || '')).map((r) => r.selector));
    const blurred = rules.filter((r) => stays.has(r.selector) && ['backdrop-filter', '-webkit-backdrop-filter'].some((k) => r.decls.has(k) && r.decls.get(k) !== 'none')).map((r) => r.selector);
    if (blurred.length) out.push({ file: 'styles', what: `a blur sits behind a bar that stays on screen (${named([...new Set(blurred)])}): everything behind it is blurred again on every scroll, more than older phones and laptops keep up with. A solid background looks the same` });

    // Movement with no rule for less of it.
    const moves = /@keyframes\b/.test(style) || /IntersectionObserver/.test(script);
    if (moves && !/prefers-reduced-motion/.test(style + script)) out.push({ file: 'styles', what: 'the page moves, and nothing follows a visitor\'s "reduce motion" setting: add @media (prefers-reduced-motion: reduce) that stops the animations and shows everything at once' });

    // Pictures with no size.
    for (const p of pages) {
      const unsized = [...p.text.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/\bwidth\s*=/.test(tag) || !/\bheight\s*=/.test(tag));
      if (!unsized.length) continue;
      const first = (/\bsrc\s*=\s*["']([^"']+)["']/i.exec(unsized[0]) || [])[1] || '';
      const shown = first && !/^(?:[a-z]+:)?\[/i.test(first) ? ` (${baseName(first) || first})` : '';   // a blank address is named once, above
      out.push({ file: p.name, what: `${unsized.length} picture${unsized.length === 1 ? ' has' : 's have'} no width and height in ${p.name}${shown}: the page jumps as each one arrives. Give each its width and height` });
    }
    return out;
  }

  /**
   * What is wrong with the work, in the order a person would meet it.
   *
   * `owed` is what the run's plan said the team would hand back, so a missing
   * deliverable is a finding whatever kind of work it was.
   */
  function inspect(filesIn, { owed, photos } = {}) {
    const files = asMap(filesIn);
    const names = new Set([...files.keys()].map(lower));
    const out = [];
    const add = (level, file, what) => { if (out.length < MAX_FINDINGS) out.push({ level, file, what }); };

    // What the team said it would hand back.
    for (const name of owed || []) {
      const n = lower(name);
      if (!/\.\w{1,8}$/.test(n)) continue; // a deliverable that is not a file
      if (!names.has(n)) add('broken', n, `${n} was owed and is not here`);
    }

    for (const [rawName, file] of files) {
      const name = lower(rawName);
      const text = String((file && file.content) || '');

      if (text.trim().length < EMPTY_CHARS) { add('broken', name, `${name} is empty`); continue; }

      for (const [re, said] of TEMPLATE_TEXT) if (re.test(text)) { add('weak', name, `${name} still has ${said} in it`); break; }

      const stop = (isCss(name) || isJs(name)) ? fault(text, name) : null;
      if (stop) add('broken', name, /never closed/.test(stop.what) ? `${name} stops in the middle: ${stop.what}${stop.line ? ` (line ${stop.line})` : ''}` : `${name} does not parse: on line ${stop.line}, ${stop.what}`);

      if (isCss(name)) for (const [re, said] of SASS_IN_CSS) if (re.test(text)) { add('broken', name, `${name} uses ${said}, which a browser reading CSS ignores`); break; }
      if (isCss(name)) {
        const m = CSS_BLANK.exec(text);
        if (m) add('broken', name, `${name} leaves a design choice blank (${m[0].trim().slice(0, 60)}) — the browser drops it; choose a real value`);
      }
      if (isHtml(name)) {
        const m = ATTR_BLANK.exec(text);
        if (m) add(/^(src|srcset)$/i.test(m[1]) ? 'broken' : 'weak', name, `${name} has ${m[0].slice(0, 60)}, which leads nowhere`);
      }
      if ((isHtml(name) || isCss(name) || isJs(name) || /\.json$/.test(name)) && EXAMPLE_REF.test(text)) add('broken', name, `${name} points images or links at example.com, which serves nothing`);
      if (/\.(?:png|jpe?g|gif|webp|avif|ico)$/.test(name) && !/^data:/.test(text.trim())) add('weak', name, `${name} is written as text, so it is not an image`);

      for (const host of DEAD_HOSTS) {
        if (text.includes(host)) { add('broken', name, `${name} loads images from ${host}, which no longer answers`); break; }
      }

      if (isHtml(name)) {
        const missing = new Set();
        for (const m of text.matchAll(REF)) {
          const ref = m[1].trim();
          if (!ref || OUTSIDE.test(ref) || /^(?:[a-z]+:)?\[/i.test(ref)) continue;   // a blank is named above
          const base = baseName(ref);
          if (base && !names.has(base)) missing.add(base);
        }
        if (missing.size) add('broken', name, `${name} points at ${[...missing].slice(0, MAX_NAMED).join(', ')}, which ${missing.size === 1 ? 'is' : 'are'} not among the files`);
      }
    }

    // An id a script reaches for that no page has.
    const pages = [...files].filter(([n]) => isHtml(lower(n))).map(([, f]) => String(f.content || '')).join('\n');
    if (pages) {
      const ids = new Set([...pages.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
      for (const [rawName, file] of files) {
        const name = lower(rawName);
        if (!isJs(name)) continue;
        const wanted = new Set();
        for (const m of String(file.content || '').matchAll(/getElementById\(\s*["']([^"']+)["']|querySelector(?:All)?\(\s*["']#([\w-]+)["']/gi)) {
          const id = m[1] || m[2];
          if (id && !ids.has(id)) wanted.add(id);
        }
        if (wanted.size) add('broken', name, `${name} looks for ${[...wanted].slice(0, MAX_NAMED).map((i) => `#${i}`).join(', ')}, which no page has`);
      }

      // A class the markup leans on that nothing styles.
      const styled = new Set();
      for (const [n, f] of files) {
        if (!isCss(lower(n))) continue;
        for (const m of String(f.content || '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(m[1]);
      }
      for (const m of pages.matchAll(/<style[\s>][\s\S]*?<\/style>/gi)) for (const c of m[0].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(c[1]);
      // A class a script switches on that nothing styles: the menu, the modal
      // or the cart it was meant to open never changes on screen.
      const switched = new Set();
      for (const [n, f] of files) {
        if (!isJs(lower(n))) continue;
        for (const m of String(f.content || '').matchAll(CLASS_SWITCH)) {
          for (const q of m[1].matchAll(/["']([-_a-zA-Z][\w-]*)["']/g)) switched.add(q[1]);
        }
      }
      const unstyled = [...switched].filter((c) => !styled.has(c));
      if (unstyled.length) add('broken', 'styles', `a script switches on ${unstyled.slice(0, MAX_NAMED).map((c) => `.${c}`).join(', ')}, which nothing styles — what it opens or shows never changes on screen`);
      // A stylesheet or script that no page loads, and code meant for a server.
      const loaded = new Set([...pages.matchAll(REF)].map((m) => baseName(m[1])));
      for (const [rawName, file] of files) {
        const name = lower(rawName);
        if (!(isCss(name) || isJs(name)) || loaded.has(name)) continue;
        if (isJs(name) && SERVER_CODE.test(String(file.content || ''))) add('weak', name, `${name} is server code, which a site opened in a browser never runs`);
        else add('weak', name, `no page loads ${name}, so nothing in it reaches the site`);
      }
      if (styled.size) {
        const used = new Set();
        for (const m of pages.matchAll(/class\s*=\s*["']([^"']*)["']/gi)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
        const bare = [...used].filter((c) => !styled.has(c));
        if (bare.length) add('weak', 'styles', `nothing styles ${bare.slice(0, MAX_NAMED).join(', ')}${bare.length > MAX_NAMED ? ` and ${bare.length - MAX_NAMED} more` : ''}`);
      }
    }

    for (const s of stuckStyles(files).slice(0, MAX_NAMED)) {
      add('broken', s.file, `${s.file} sets ${s.props.join(' and ')} on elements directly, then switches on .${s.cls} to change ${s.props.length === 1 ? 'it' : 'them'} — a style set directly wins over any class, so those elements stay as the script left them${s.props.includes('opacity') ? ', invisible' : ''}. Set the starting style in the stylesheet, or change it back from the script`);
    }

    for (const s of standard(files)) add('standard', s.file, s.what);

    // A photograph shown without the credit its licence asks for — js/swarm/photos.js.
    const P = typeof window !== 'undefined' && window.HCSwarmPhotos;
    for (const p of (P ? P.uncredited(files, photos) : []).slice(0, MAX_NAMED)) {
      add('broken', 'credits', `the site shows ${P.creditOf(p)} without crediting it — its licence requires the title, the author and the licence where a visitor can read them${p.page ? `, linked to ${p.page}` : ''}`);
    }
    return out;
  }

  /** The findings as lines, worst first. */
  function linesOf(findings) {
    const list = Array.isArray(findings) ? findings : [];
    const broken = list.filter((f) => f.level === 'broken');
    const weak = list.filter((f) => f.level !== 'broken');
    return [...broken, ...weak].map((f) => f.what);
  }

  /** One sentence for the trace, or '' when there is nothing to say. */
  function summaryOf(findings) {
    const list = Array.isArray(findings) ? findings : [];
    if (!list.length) return '';
    const broken = list.filter((f) => f.level === 'broken').length;
    const weak = list.length - broken;
    const parts = [];
    if (broken) parts.push(`${broken} thing${broken === 1 ? '' : 's'} that will not work`);
    if (weak) parts.push(`${weak} that ${weak === 1 ? 'is' : 'are'} unfinished`);
    return parts.join(' and ');
  }

  /** What to ask the team to put right, or '' when nothing needs asking. */
  function repairNote(findings) {
    const lines = linesOf((Array.isArray(findings) ? findings : []).filter((f) => f.level === 'broken'));
    if (!lines.length) return '';
    return `\n\nTHESE WERE FOUND IN THE WORK AND MUST BE PUT RIGHT. Each one was read from the files themselves, not guessed at:\n${lines.map((l) => `- ${l}`).join('\n')}\nReturn the complete files you change, each in its own fenced block with its name, and change nothing else.`;
  }

  window.HCSwarmProjectCheck = { inspect, linesOf, summaryOf, repairNote, DEAD_HOSTS };
})();
