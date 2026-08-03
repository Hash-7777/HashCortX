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

  window.HCMarkdown = {
    escapeHtml,
    safeMarkdownHref,
    extractMarkedLinkArgs,
    extractMarkedCodeArgs,
    decodeHtmlEntities,
    stripReplyPrelude,
    fallbackFormatContent,
  };
})();
