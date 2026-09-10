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
// Pure: takes the files, returns the page. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmSite.
// Checked by scripts/checks/swarm-site.mjs.
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
  function buildSite(files) {
    const list = files && typeof files.get === 'function' && typeof files.entries === 'function'
      ? files
      : new Map(Object.entries(files || {}));
    const entry = list.get('index.html') || list.get('index.htm') || [...list.values()].find((f) => f.lang === 'html');
    if (!entry) return null;
    let html = String(entry.content);
    const inlined = new Set();

    for (const [name, f] of list) {
      if (f === entry) continue;
      const before = html;
      if (name.endsWith('.css')) {
        html = html.replace(new RegExp(`<link[^>]+href=["'](?:\\./)?${escapeRe(name)}["'][^>]*/?>`, 'gi'), () => styleTag(name, f.content));
      } else if (name.endsWith('.js')) {
        html = html.replace(new RegExp(`<script[^>]+src=["'](?:\\./)?${escapeRe(name)}["'][^>]*></script>`, 'gi'), () => scriptTag(name, f.content));
      }
      if (html !== before) inlined.add(name);
    }

    const extraCss = [];
    const extraJs = [];
    for (const [name, f] of list) {
      if (f === entry || inlined.has(name)) continue;
      if (name.endsWith('.css')) extraCss.push(styleTag(name, f.content));
      else if (name.endsWith('.js')) extraJs.push(scriptTag(name, f.content));
    }
    if (extraCss.length) html = insertBefore(html, /<\/head>/i, extraCss.join('\n'), 'start');
    if (extraJs.length) html = insertBefore(html, /<\/body>/i, extraJs.join('\n'), 'end');

    const usesTailwind = /class="[^"]*(?:bg-|text-|flex|grid|p-|m-|rounded|shadow|border|w-|h-|gap-|space-)[^"]*"/i.test(html);
    const hasTailwind = /cdn\.tailwindcss\.com|tailwind\.config/i.test(html);
    if (usesTailwind && !hasTailwind) {
      html = insertBefore(html, /<\/head>/i, '<script src="https://cdn.tailwindcss.com"></script>', 'start');
    }
    return html;
  }

  window.HCSwarmSite = { buildSite, scriptSafe, styleSafe };
})();
