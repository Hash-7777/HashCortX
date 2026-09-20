// ==============================================================
// A swarm-built site, as one page
//
// The Agent Swarm's agents write a site as several files — a page, its
// styles, its scripts. Downloading it, or opening it in the browser, needs one
// page with the rest inside it. This builds that page.
//
// Two ways it used to change what the agents wrote. Each file was put into
// the page with a plain string replacement, and a replacement string treats
// $$, $& and $' as instructions: a stylesheet's "$$" came out as "$", a
// jQuery-style double-dollar call lost a dollar, and a "$&" in a script was
// swapped for the whole <script> tag it replaced — markup injected into the
// middle of a string. And a script containing "</script>" anywhere, even
// inside a string, ended the inlined script early and spilled the rest into
// the page as HTML.
// Files now go in by a function, which inserts text as it is, and the few
// sequences that would end their block are escaped in a way the language
// reads as the same text.
//
// THREE MORE THINGS THE PAGE GOT WRONG, all seen in one real run.
// Scripts written as modules went in as plain scripts, where the first
// "export" is a syntax error that kills the whole script: js/swarm/bundle.js
// now joins them into the one script a page can run, and when it cannot, the
// page says so instead of pretending.
// An image the project itself holds — the logo the planner drew — stayed a
// broken image, because only stylesheets and scripts were ever put in. An SVG
// among the files now goes in wherever the page asks for it.
// And Tailwind was fetched from its CDN whenever a class name merely CONTAINED
// one of its words, so a page with class="product-grid" and a stylesheet of
// its own had a framework dropped on top of it — including the reset that
// throws that stylesheet's own headings and lists away. It is now added only
// for a page that really is written in Tailwind and has no stylesheet of its
// own to be flattened.
//
// Pure: takes the files, returns the page. No DOM, no storage, no network.
//
// Loaded after js/swarm/bundle.js, before the Agent Swarm, and published as
// window.HCSwarmSite. Checked by scripts/checks/swarm-site.mjs.
// ==============================================================

(function () {
  'use strict';

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * Script text that cannot end the <script> it sits in. "<\/script" is the
   * same string to JavaScript and not a closing tag to the HTML parser; the
   * same goes for the "<!--" that puts a parser into its escaped-script state.
   */
  function scriptSafe(js) {
    return String(js).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  }

  /** Style text that cannot end the <style> it sits in. */
  function styleSafe(css) {
    return String(css).replace(/<\/(style)/gi, '<\\/$1');
  }

  const styleTag = (name, css) => `<style>/* ${name} */\n${styleSafe(css)}\n</style>`;
  const scriptTag = (name, js) => `<script>/* ${name} */\n${scriptSafe(js)}\n</script>`;

  /** An SVG file as an address a page can use in place of its file name. */
  const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg).trim())}`;

  // What a Tailwind class actually looks like, as a whole class name rather
  // than as letters found inside one. "product-grid" is not "grid".
  const TW_PREFIX = /^(?:(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|group-hover|motion-safe|motion-reduce):)*/;
  const TW_WORD = /^(?:flex|grid|block|inline|inline-block|hidden|container|relative|absolute|fixed|sticky|truncate|italic|underline|uppercase|lowercase|capitalize|antialiased)$/;
  const TW_SCALE = /^(?:bg|text|border|rounded|shadow|ring|opacity|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min|max|gap|space|flex|grid|col|row|items|justify|self|content|place|font|leading|tracking|z|top|left|right|bottom|inset|order|basis|divide|overflow|object|cursor|transition|duration|delay|ease|scale|rotate|translate|aspect)-[\w./%[\]#()-]+$/;
  const tailwindClass = (token) => {
    const t = token.replace(TW_PREFIX, '');
    return TW_WORD.test(t) || TW_SCALE.test(t);
  };

  /** Put `insert` before the first match of `re`, or at `fallback` if there is none. */
  function insertBefore(html, re, insert, fallback) {
    if (!re.test(html)) return fallback === 'start' ? insert + '\n' + html : html + '\n' + insert;
    return html.replace(re, (m) => `${insert}\n${m}`);
  }

  /**
   * One page from a set of files, or null when there is no page among them.
   *
   * `files` is a Map of lower-cased name to { lang, content }. The page is
   * index.html, index.htm or the first HTML file. Each stylesheet and script
   * the page links is put in place of its tag; any it does not link is added
   * anyway, styles in the head and scripts before the end of the body, so
   * nothing the agents wrote is dropped. A page styled with Tailwind's class
   * names but without Tailwind gets its script, so it looks as intended when
   * it runs in a browser.
   */
  function buildPage(files) {
    const list = files && typeof files.get === 'function' && typeof files.entries === 'function'
      ? files
      : new Map(Object.entries(files || {}));
    const entry = list.get('index.html') || list.get('index.htm') || [...list.values()].find((f) => f.lang === 'html');
    if (!entry) return { html: null, notes: [] };
    let html = String(entry.content);
    const inlined = new Set();
    const notes = [];

    const bundler = typeof window !== 'undefined' && window.HCSwarmBundle;
    /** A script's text for the page: on its own, or with what it imports. */
    const scriptFor = (name, f) => {
      const joined = bundler ? bundler.bundleFor(name, list) : null;
      if (joined && joined.code) {
        for (const used of joined.used) inlined.add(used);
        if (joined.used.length > 1) notes.push({ kind: 'joined', name, what: `${name} was joined with ${joined.used.filter((u) => u !== name).join(', ')} so one page can run it` });
        return scriptTag(name, joined.code);
      }
      if (joined && joined.reason) notes.push({ kind: 'not-joined', name, what: `${joined.reason}, so it is in the page as written and will not run there` });
      return scriptTag(name, f.content);
    };

    for (const [name, f] of list) {
      if (f === entry) continue;
      const before = html;
      if (name.endsWith('.css')) {
        html = html.replace(new RegExp(`<link[^>]+href=["'](?:\\./)?${escapeRe(name)}["'][^>]*/?>`, 'gi'), () => styleTag(name, f.content));
      } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
        if (inlined.has(name)) continue;
        html = html.replace(new RegExp(`<script[^>]+src=["'](?:\\./)?${escapeRe(name)}["'][^>]*></script>`, 'gi'), () => scriptFor(name, f));
      } else if (name.endsWith('.svg')) {
        // An image the project holds, in place of a file name the one page
        // has no folder to look in.
        const uri = svgUri(f.content);
        html = html.replace(new RegExp(`(src|href)=["'](?:\\./)?${escapeRe(name)}["']`, 'gi'), (m, attr) => `${attr}="${uri}"`);
        if (html !== before) notes.push({ kind: 'asset', name, what: `${name} was put into the page, since one page has no folder to find it in` });
      }
      if (html !== before) inlined.add(name);
    }

    const extraCss = [];
    const extraJs = [];
    for (const [name, f] of list) {
      if (f === entry || inlined.has(name)) continue;
      if (name.endsWith('.css')) extraCss.push(styleTag(name, f.content));
      else if (name.endsWith('.js') || name.endsWith('.mjs')) extraJs.push(scriptFor(name, f));
    }
    if (extraCss.length) html = insertBefore(html, /<\/head>/i, extraCss.join('\n'), 'start');
    if (extraJs.length) html = insertBefore(html, /<\/body>/i, extraJs.join('\n'), 'end');

    // Tailwind is a substitute for a stylesheet, not something to drop on top
    // of one: its reset alone would undo a stylesheet the team wrote. So it is
    // added only for a page whose class names really are Tailwind's, and that
    // has no stylesheet of its own.
    const classes = [...html.matchAll(/class=["']([^"']*)["']/gi)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
    const usesTailwind = new Set(classes.filter(tailwindClass)).size >= 3;
    const ownStyles = /<style[\s>]/i.test(html) || [...list.keys()].some((n) => n.endsWith('.css'));
    const hasTailwind = /cdn\.tailwindcss\.com|tailwind\.config/i.test(html);
    if (usesTailwind && !ownStyles && !hasTailwind) {
      html = insertBefore(html, /<\/head>/i, '<script src="https://cdn.tailwindcss.com"></script>', 'start');
      notes.push({ kind: 'tailwind', name: 'index.html', what: 'the page is written in Tailwind class names and has no stylesheet, so Tailwind was added' });
    }
    return { html, notes };
  }

  /** The one page, or null when there is no page among the files. */
  const buildSite = (files) => buildPage(files).html;

  window.HCSwarmSite = { buildSite, buildPage, scriptSafe, styleSafe, svgUri, tailwindClass };
})();
