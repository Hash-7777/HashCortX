// ==============================================================
// Turning model output into HTML without handing it the page
//
// Everything a model writes ends up rendered as markdown, and markdown carries
// links, code blocks and HTML entities. These are the functions that decide
// what survives that trip.
//
// `safeMarkdownHref` is the one that matters most: it is the only thing
// stopping a model — or a web page an agent fetched and quoted — from
// producing a link that runs script when clicked. It shipped with no tests at
// all, which is a poor state for the app's link sanitiser.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCMarkdown.
// Checked by scripts/checks/markdown-safe.mjs.
// ==============================================================

(function () {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Make text safe to place in HTML. */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  /**
   * The href a markdown link may point at, or null to refuse it.
   *
   * Only absolute http(s). That is what keeps out `javascript:`, `data:`,
   * `file:` and `vbscript:` — every scheme that turns a link into an action
   * rather than a destination. Credentials are refused too, because
   * `https://trusted.example@evil.example/` reads as one host and goes to
   * another, and a user judging a link by eye will read the first one.
   *
   * A relative link is refused as well: there is nothing on this app's own
   * origin a model has any business linking to.
   */
  function safeMarkdownHref(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.username !== '' || u.password !== '') return null;
      return u.href;
    } catch {
      return null;
    }
  }

  /**
   * Read a link out of the arguments marked hands a renderer.
   *
   * Marked changed this shape between major versions: older builds pass
   * (href, title, text) and newer ones pass a single token object. Both are
   * accepted so that upgrading the vendored copy does not silently turn every
   * link into the string "[object Object]".
   */
  function extractMarkedLinkArgs(args) {
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const label = first.tokens?.map((t) => t.raw || t.text || '').join('') || first.text || first.href || '';
      return { href: first.href || '', title: first.title || '', text: label };
    }
    return {
      href: first || '',
      title: args[1] || '',
      text: args[2] || first || '',
    };
  }

  /** The same, for a fenced code block. */
  function extractMarkedCodeArgs(args) {
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return { text: first.text || '', lang: first.lang || '' };
    }
    return { text: first || '', lang: args[1] || '' };
  }

  /**
   * Undo HTML entity encoding, including numeric forms.
   *
   * `&amp;` is decoded last, on purpose. Doing it first would turn
   * `&amp;lt;` into `&lt;` and then into `<`, which is how an escaped
   * less-than sign becomes a real tag again.
   */
  function decodeHtmlEntities(s) {
    let t = String(s || '');
    if (!t) return '';
    t = t.replace(/&#x([0-9a-f]+);/gi, (whole, hex) => {
      const c = parseInt(hex, 16);
      return Number.isFinite(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : whole;
    });
    t = t.replace(/&#(\d+);/g, (whole, dec) => {
      const c = parseInt(dec, 10);
      return Number.isFinite(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : whole;
    });
    t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
    t = t.replace(/&amp;/g, '&');
    return t;
  }

  /**
   * Remove the quoted block the composer adds when replying to a message, so
   * the quote is not shown twice when the turn is rendered back.
   */
  function stripReplyPrelude(text) {
    const raw = String(text || '');
    const parts = raw.split(/\n\n(?=[^>])/);
    if (parts.length > 1 && /^Replying to /.test(parts[0])) {
      return parts.slice(1).join('\n\n');
    }
    return raw;
  }

  /** What to show when the markdown renderer is unavailable. */
  function fallbackFormatContent(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // ── Rendering what a model wrote ──────────────────────────────────────

  /** A link a model wrote: http(s) only, opened outside the app. */
  function safeLinkHtml(href, title, text) {
    const resolved = safeMarkdownHref(href);
    const label = escapeHtml(text || href || '');
    if (!resolved) return `<span class="md-link-blocked" title="Only http(s) links are allowed">${label}</span>`;
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener noreferrer"${t}>${label}</a>`;
  }

  /**
   * An image a model wrote. The app's own images — data: and blob: — are
   * shown; one from another site becomes a link, because fetching it would be
   * a request the app makes on the model's behalf before anyone has read the
   * reply, with a URL the model chose.
   */
  function safeImageHtml(href, title, text) {
    const label = escapeHtml(text || title || 'image');
    if (/^(?:data:image\/|blob:)/i.test(String(href || '').trim())) {
      return `<img src="${escapeHtml(href)}" alt="${label}" loading="lazy">`;
    }
    const resolved = safeMarkdownHref(href);
    if (!resolved) return `<span class="md-link-blocked" title="Only http(s) images are allowed">${label}</span>`;
    return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener noreferrer">[image: ${label}]</a>`;
  }

  /** What the sanitiser removes whatever else it would allow. */
  const FORBID_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'meta', 'link', 'base', 'svg', 'math'];

  /**
   * Model output as HTML that cannot run anything, for anywhere that is not
   * the chat, which has its own renderer for code blocks.
   *
   * The app's security policy permits inline script, so markup is the one
   * thing text from a model must never become. Raw HTML in the text is
   * escaped before the markdown library sees it, so it is shown rather than
   * built; links and images go through the rules above; and the result is
   * passed through the sanitiser as a last line. With either library missing
   * this does not guess — the text comes back escaped, as plain text.
   *
   * `marked` and `purify` are handed in so this stays free of the page.
   */
  function renderUntrusted(text, { marked, purify } = {}) {
    const src = String(text == null ? '' : text);
    if (!marked || !purify || typeof purify.sanitize !== 'function') {
      return `<div class="md-plain">${escapeHtml(src).replace(/\n/g, '<br>')}</div>`;
    }
    const renderer = new marked.Renderer();
    renderer.link = (...args) => { const a = extractMarkedLinkArgs(args); return safeLinkHtml(a.href, a.title, a.text); };
    renderer.image = (...args) => { const a = extractMarkedLinkArgs(args); return safeImageHtml(a.href, a.title, a.text); };
    // Code arrives carrying the escaping done below, once; it is undone and
    // done again exactly once, or every < in a code block reads as &lt;.
    renderer.code = (...args) => {
      const { text, lang } = extractMarkedCodeArgs(args);
      const label = String(lang || '').trim().split(/\s+/)[0].replace(/[^\w+#.-]/g, '');
      const cls = label ? ` class="language-${escapeHtml(label)}"` : '';
      return `<pre><code${cls}>${escapeHtml(decodeHtmlEntities(text).replace(/\n$/, ''))}</code></pre>`;
    };
    renderer.codespan = (...args) => {
      const first = args[0];
      const text = first && typeof first === 'object' ? first.text : first;
      return `<code>${escapeHtml(decodeHtmlEntities(text))}</code>`;
    };
    const escaped = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = marked.parse(escaped, { gfm: true, breaks: true, silent: true, renderer });
    return purify.sanitize(html, { ADD_ATTR: ['target', 'rel'], FORBID_TAGS, FORBID_ATTR: ['style'] });
  }

  window.HCMarkdown = {
    renderUntrusted,
    safeLinkHtml,
    safeImageHtml,
    escapeHtml,
    safeMarkdownHref,
    extractMarkedLinkArgs,
    extractMarkedCodeArgs,
    decodeHtmlEntities,
    stripReplyPrelude,
    fallbackFormatContent,
  };
})();
