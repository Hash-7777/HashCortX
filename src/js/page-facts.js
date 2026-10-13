// ==============================================================
// What a fetched web page holds besides its words
//
// HashCoder's fetch_url handed a model the text of a page and nothing else.
// Asked to build a site for a real business from its own pages, a model
// could read the words but had no way to the pictures, the logo, the
// colours, the contact details or the other pages of the site, so it drew
// stand-ins and guessed the rest.
//
// read() takes the page's markup and its address and returns what a visitor
// would take from it: its title and description, the pictures it shows with
// their own addresses, the marks that look like its logo, the colours it
// declares, the phone numbers, email addresses, street address, opening
// hours and social accounts it gives, from its links, its text and the
// structured data it publishes for search engines, and the links to its
// other pages, so the agent can read the About or Contact page next. Every
// address is made absolute from the page's own.
//
// searchResults() reads the plain results page of DuckDuckGo, the search
// HashCoder falls back to when no search key is set.
//
// Pure: takes strings, returns records. No DOM, no network.
// Loaded before app.js and HashCoder and published as window.HCPageFacts.
// Checked by scripts/checks/page-facts.mjs.
// ==============================================================

(function () {
  'use strict';

  const MOST_IMAGES = 24;
  const MOST_LINKS = 30;
  const MOST_COLOURS = 8;
  const MOST_EACH = 6;

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', copy: '©' };
  const decode = (t) => String(t == null ? '' : t).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => {
    if (d || h) { const c = parseInt(d || h, d ? 10 : 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }
    const k = n.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
  });
  // Tags inside a line of text (bold, a span) are taken out without a space, so "<b>1961</b>." stays "1961.".
  const clean = (t, most = 200) => decode(String(t || '').replace(/<\/?(?:b|i|em|strong|span|small|mark|abbr|sup|sub)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, most);

  /** The attributes of one tag, lower-cased names, decoded values. */
  function attrsOf(tag) {
    const out = {};
    for (const m of String(tag).matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const k = m[1].toLowerCase();
      if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
    }
    return out;
  }

  /** `href` made absolute from `base`, web addresses only; '' for anything else. */
  function absolute(href, base) {
    const h = String(href || '').trim();
    if (!h || /^(?:data|blob|javascript|about|mailto|tel):/i.test(h)) return '';
    try {
      const u = new URL(h, base);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  }

  const tagsOf = (html, name) => [...String(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
  const unique = (list) => [...new Set(list.filter(Boolean))];

  /** The structured data a page publishes for search engines, flattened into its objects. */
  function structured(html) {
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') { out.push(v); if (v['@graph']) walk(v['@graph']); }
    };
    for (const m of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { walk(JSON.parse(m[1].trim())); } catch { /* a block that does not parse says nothing */ }
    }
    return out;
  }

  const textOfValue = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOfValue).filter(Boolean).join('; ')
    : typeof v === 'object' ? (v.url || v.name || [v.streetAddress, v.addressLocality, v.addressRegion, v.postalCode, v.addressCountry].filter(Boolean).map(textOfValue).join(', ')) : String(v));

  const SOCIAL = /^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|facebook\.com|fb\.com|twitter\.com|x\.com|tiktok\.com|linkedin\.com|youtube\.com|wa\.me|t\.me|snapchat\.com|pinterest\.com)\//i;
  const PHONE = /(?:\+|00)?\d[\d\s().-]{6,17}\d/g;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const NOT_MAIL = /\.(?:png|jpe?g|gif|svg|webp|avif|css|m?js)$|@\dx\b|@(?:example|domain|sentry|wixpress)\./i;
  const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

  /** The colours a page declares: its theme colour, then those its own styles use most. */
  function coloursOf(html, metas) {
    const counts = new Map();
    const add = (c, n = 1) => {
      let x = String(c).toLowerCase();
      if (x.length === 4) x = `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}`;
      counts.set(x, (counts.get(x) || 0) + n);
    };
    const theme = metas['theme-color'];
    if (theme && /^#(?:[0-9a-f]{3}){1,2}$/i.test(theme.trim())) add(theme.trim(), 1000);
    const styles = [...String(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
      + '\n' + [...String(html).matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(';');
    // A colour named as a custom property is a colour the site chose, so it counts for more.
    for (const m of styles.matchAll(/--[\w-]+\s*:\s*(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\b/gi)) add(m[1], 5);
    for (const m of styles.matchAll(HEX)) add(m[0]);
    const plain = (c) => /^#(?:000000|ffffff)$/.test(c);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => !plain(c)).slice(0, MOST_COLOURS);
  }

  /**
   * What a page holds besides its words. `html` is its markup, `url` its
   * address (the one it was finally read from). Returns
   * `{ title, description, siteName, logos, images, colours, contact, links, stylesheets }`.
   */
  function read(html, url) {
    const whole = String(html || '');
    // Pictures, links and words are read from the page without its scripts and templates, whose markup is text, not part of the page; its structured data is read from the whole.
    const page = whole.replace(/<script\b(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>|<template\b[\s\S]*?<\/template>/gi, ' ');
    const metas = {};
    for (const tag of tagsOf(page, 'meta')) {
      const a = attrsOf(tag);
      const key = (a.property || a.name || a['http-equiv'] || '').toLowerCase();
      if (key && a.content != null && !(key in metas)) metas[key] = a.content;
    }
    const data = structured(whole);
    const org = data.find((d) => /Organization|LocalBusiness|Store|Pharmacy|Restaurant|Shop|Hotel|MedicalBusiness|Corporation|Place/i.test(String(d['@type'] || ''))) || null;

    const title = clean(metas['og:title'] || (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page) || [])[1] || '', 160);
    const description = clean(metas['og:description'] || metas.description || '', 300);
    const siteName = clean(metas['og:site_name'] || (org && org.name) || '', 120);

    // Pictures, with what each is called.
    const images = [];
    const seen = new Set();
    const addImage = (src, alt, extra = {}) => {
      const u = absolute(src, url);
      if (!u || seen.has(u) || images.length >= MOST_IMAGES) return;
      if (/(?:pixel|spacer|blank|tracking|1x1)\.(?:gif|png)\b/i.test(u)) return;
      seen.add(u);
      images.push({ url: u, alt: clean(alt, 140), ...extra });
    };
    const ogImage = metas['og:image'] || metas['og:image:url'] || metas['twitter:image'];
    if (ogImage) addImage(ogImage, metas['og:image:alt'] || title, { role: 'share picture' });
    for (const tag of tagsOf(page, 'img')) {
      const a = attrsOf(tag);
      if ((a.width === '1' && a.height === '1') || /display\s*:\s*none/i.test(a.style || '')) continue;
      const src = a.src && !/^data:/i.test(a.src) ? a.src : (a['data-src'] || a['data-lazy-src'] || (a.srcset || a['data-srcset'] || '').split(',').pop().trim().split(/\s+/)[0]);
      addImage(src, a.alt || a.title || '', a.width && a.height && /^\d+$/.test(a.width) && /^\d+$/.test(a.height) ? { width: Number(a.width), height: Number(a.height) } : {});
    }
    for (const m of page.matchAll(/background(?:-image)?\s*:[^;"']*url\(\s*["']?([^"')]+)["']?\s*\)/gi)) addImage(m[1], '', { role: 'background' });

    // What looks like its logo: a picture named so, the icons it gives, and what its structured data names.
    const logos = [];
    const addLogo = (src, from) => { const u = absolute(src, url); if (u && !logos.some((l) => l.url === u)) logos.push({ url: u, from }); };
    if (org && org.logo) addLogo(textOfValue(org.logo), 'structured data');
    for (const tag of tagsOf(page, 'img')) {
      const a = attrsOf(tag);
      if (/logo|brand/i.test([a.src, a.alt, a.class, a.id].join(' '))) addLogo(a.src || a['data-src'], 'picture named as a logo');
    }
    for (const tag of tagsOf(page, 'link')) {
      const a = attrsOf(tag);
      if (/(?:^|\s)(?:apple-touch-icon|icon|mask-icon)(?:\s|$)/i.test(a.rel || '')) addLogo(a.href, `icon (${(a.rel || '').toLowerCase()}${a.sizes ? `, ${a.sizes}` : ''})`);
    }
    if (!logos.length) addLogo('/favicon.ico', 'the usual icon address, not seen on the page');

    // How to reach it: links that call or write, words in the text, and structured data.
    const text = clean(page.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' '), 200000);
    const phones = [], emails = [], social = [], addresses = [], hours = [];
    for (const tag of tagsOf(page, 'a')) {
      const a = attrsOf(tag);
      const h = String(a.href || '');
      if (/^tel:/i.test(h)) phones.push(decodeURIComponent(h.slice(4)).trim());
      else if (/^mailto:/i.test(h)) emails.push(decodeURIComponent(h.slice(7).split('?')[0]).trim());
      else { const u = absolute(h, url); if (u && SOCIAL.test(u) && !/\/(?:sharer|share|intent)\b/i.test(u)) social.push(u); }
    }
    for (const m of text.matchAll(EMAIL)) if (!NOT_MAIL.test(m[0])) emails.push(m[0]);
    for (const m of text.matchAll(PHONE)) {
      const d = m[0].replace(/\D/g, '');
      if (d.length >= 8 && d.length <= 15 && /^(?:\+|00|0|\()/.test(m[0].trim()) && !/^(?:19|20)\d{6}$/.test(d)) phones.push(m[0].trim());
    }
    for (const d of org ? [org] : []) {
      if (d.telephone) phones.unshift(textOfValue(d.telephone));
      if (d.email) emails.unshift(textOfValue(d.email).replace(/^mailto:/i, ''));
      if (d.address) addresses.push(textOfValue(d.address));
      if (d.openingHours) hours.push(textOfValue(d.openingHours));
      if (d.openingHoursSpecification) hours.push(textOfValue([].concat(d.openingHoursSpecification).map((s) => [].concat(s.dayOfWeek || []).map((x) => String(x).split('/').pop()).join(', ') + (s.opens ? ` ${s.opens}-${s.closes}` : ''))));
      for (const s of [].concat(d.sameAs || [])) if (SOCIAL.test(String(s))) social.push(String(s));
    }
    const contact = {
      phones: phones.filter((p, i) => p && phones.findIndex((q) => q.replace(/\D/g, '').slice(-8) === p.replace(/\D/g, '').slice(-8)) === i).slice(0, MOST_EACH),   // one number written several ways is one number
      emails: unique(emails.map((e) => e.toLowerCase())).slice(0, MOST_EACH),
      addresses: unique(addresses).slice(0, MOST_EACH),
      hours: unique(hours).slice(0, MOST_EACH),
      social: unique(social).slice(0, MOST_EACH),
    };
    if (org && org.foundingDate) contact.founded = textOfValue(org.foundingDate);

    // Its other pages, by the words on their links, so the next read can be chosen.
    const links = [];
    let host = '';
    try { host = new URL(url).host; } catch { /* no address, no links of its own */ }
    for (const m of page.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const a = attrsOf(m[1]);
      const u = absolute(a.href, url);
      if (!u || !host) continue;
      let to;
      try { to = new URL(u); } catch { continue; }
      if (to.host !== host || /\.(?:jpe?g|png|gif|webp|svg|pdf|zip)$/i.test(to.pathname)) continue;
      to.hash = '';
      const label = clean(m[2] || a.title || a['aria-label'] || '', 80);
      if (!label || links.some((l) => l.url === to.href) || to.href === url) continue;
      links.push({ url: to.href, text: label });
      if (links.length >= MOST_LINKS) break;
    }
    const stylesheets = tagsOf(page, 'link').map(attrsOf).filter((a) => /stylesheet/i.test(a.rel || '')).map((a) => absolute(a.href, url)).filter(Boolean).slice(0, 4);

    return { title, description, siteName, logos: logos.slice(0, MOST_EACH), images, colours: coloursOf(page, metas), contact, links, stylesheets };
  }

  /** The note sent with what read() found: where it came from, and what may be done with it. */
  const NOTE = 'Pictures, logos and words above are the site\'s own, read from its page: use them as they are, at their own addresses, and only for the business they belong to. ' +
    'Colours are those the page itself declares; its stylesheets were not read (fetch_url one of them for more). Details here are what the page says, not checked against anything else.';

  /**
   * Results from DuckDuckGo's plain results page: `[{ title, url, snippet }]`.
   * Its links go through a redirect that carries the real address; that
   * address is taken out of it. Advertisements are left out.
   */
  function searchResults(html, most = 8) {
    const out = [];
    const page = String(html || '');
    const blocks = page.split(/<div[^>]*class="[^"]*\bresult\b/).slice(1);
    for (const b of blocks) {
      if (/result--ad\b|ad_domain|badge--ad/.test(b.slice(0, 400))) continue;
      const link = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b) || /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
      if (!link) continue;
      let href = decode(link[1]);
      const uddg = /[?&]uddg=([^&]+)/.exec(href);
      if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch { continue; } }
      const target = absolute(href, 'https://duckduckgo.com/');
      if (!target || /^https?:\/\/(?:[^/]*\.)?duckduckgo\.com\//i.test(target)) continue;
      const snippet = (/<(?:a|div|td)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(b) || [])[1] || '';
      out.push({ title: clean(link[2], 160), url: target, snippet: clean(snippet, 300) });
      if (out.length >= most) break;
    }
    return out;
  }

  window.HCPageFacts = { read, searchResults, structured, absolute, NOTE, MOST_IMAGES, MOST_LINKS };
})();
