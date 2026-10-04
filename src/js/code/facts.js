// ==============================================================
// Details about a business that nothing the agent was given or read says
//
// A model that cannot find a business's own page can still write a page for
// it, and what it writes then reads as fact: an address, a year, opening
// hours. Nothing tells the person which details were found and which were
// guessed, and a line left in square brackets is no better, since a visitor
// reads it as part of the page.
//
// When a run changes a page or a text file, what it holds is read here for the
// details a visitor takes as fact and could check: an address, a phone number,
// an email, a year it began, how long it has been open, opening hours, and a
// link to an account on a social network. Each is looked for in what the run
// was told or read: the person's own words, a page or a search the agent
// opened, a file in the project it had not written itself, a connected
// system, a note it was given to recall. A detail found in none of those is
// reported, once, to the agent, which is sent back to find it, take it out, or
// say it is a guess; and what is still unconfirmed when the run ends is said
// under the answer, from this record and not from the agent's account of it.
// A line of square brackets that shows as text on a page is reported too.
//
// A file the agent wrote earlier, in this run or an earlier one of the same
// conversation, is not a source: a detail it made up and read back is not
// confirmed by being read. When the person attached a picture, what it shows
// cannot be searched, so no detail is held against the run for want of a
// source; the brackets are still reported. An example the way every template
// writes one (123 Main Street, 555-0100, 000 0000, example.com) is not a claim.
//
// Pure: takes strings and records, returns records and strings. No DOM, no
// storage, no network.
//
// Loaded before the Coder mode and published as window.HCCodeFacts.
// Checked by scripts/checks/code-facts.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Pages and text a visitor reads, and where square brackets show as text. */
  const PAGE = /\.(?:html?|md|mdx|txt|vue|svelte|jsx|tsx|astro|php)$/i;
  const MARKUP = /\.(?:html?|vue|svelte|jsx|tsx|astro|php)$/i;
  const PROSE = /\.(?:html?|md|mdx|txt)$/i;
  const MOST_FILES = 8;
  const MOST_CHARS = 200000;
  const MOST_SHOWN = 6;

  const WRITERS = new Set(['write_file', 'patch_file', 'move_file']);
  /** What a tool returns that the agent did not write: the web, notes, and anything a connected system answers. */
  const OWN_TOOLS = new Set(['read_file', 'write_file', 'patch_file', 'list_dir', 'delete_file', 'move_file', 'fuzzy_find', 'grep_code', 'search_files',
    'shell_run', 'execute_python', 'current_datetime', 'calculate', 'remember_fact', 'update_plan', 'save_lesson', 'placeholder_images', 'find_photos']);

  const slash = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
  const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/ /g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ── What a visitor would read ───────────────────────────────────────────

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', copy: '©' };
  const decode = (t) => String(t).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => {
    if (d || h) { const c = parseInt(d || h, d ? 10 : 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }
    return Object.prototype.hasOwnProperty.call(ENTITIES, n.toLowerCase()) ? ENTITIES[n.toLowerCase()] : m;
  });

  /**
   * The words of a file as a visitor meets them: a page's text, its title and
   * description, the numbers and addresses in its phone and mail links, its
   * links to other sites, and the structured data it gives search engines. Not
   * its scripts, its styles, its drawings, its comments, or the grey example
   * inside an empty field.
   */
  function visibleText(path, raw) {
    let t = String(raw == null ? '' : raw).slice(0, MOST_CHARS);
    if (!MARKUP.test(path)) return t;
    const extra = [];
    t = t.replace(/<!--[\s\S]*?-->/g, ' ');
    for (const m of t.matchAll(/<meta\b[^>]*?\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) extra.push(m[1] || m[2] || '');
    for (const m of t.matchAll(/\bhref\s*=\s*["']((?:tel|mailto):[^"']+|https?:\/\/[^"']+)/gi)) extra.push(m[1]);
    for (const m of t.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) extra.push(m[1]);
    t = t.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return [decode(t), ...extra.map(decode)].join('\n');
  }

  // ── Details that can be checked ─────────────────────────────────────────

  const PHONE = /[+(]?\d[\d\s().-]{6,17}\d/g;
  const digitsOf = (s) => String(s).replace(/\D/g, '');
  /** An example number, the way every template writes one. */
  const fakeNumber = (d) => /0{5,}|(\d)\1{5,}|1234567|7654321|0123456|555\d{4}$/.test(d);

  function phonesIn(text, strict) {
    const out = [];
    for (const m of String(text).matchAll(PHONE)) {
      const before = text[m.index - 1];
      if (before && /[\w.]/.test(before)) continue;
      const raw = m[0].trim();
      const d = digitsOf(raw);
      if (d.length < 8 || d.length > 13) continue;
      if (strict && (!/^(?:\+|0|\()/.test(raw) || /^\d{4}-\d{2}-\d{2}/.test(raw) || fakeNumber(d))) continue;
      out.push({ shown: raw, key: d.slice(-8) });
    }
    return out;
  }

  const KIND = { phone: 'phone number', address: 'address', year: 'year', years: 'how long it has been open', hours: 'opening hours', email: 'email', link: 'link to an account' };

  const STREET = /\b(\d{1,4}[A-Za-z]?)\s+((?:[A-Z][\w'’.-]*\s+){1,4}?)(Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Square|Sq\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Highway|Hwy\.?)(?![\w])/g;
  const ARABIC_STREET = /([\d٠-٩]{1,4})\s*(?:شارع|ش\.?)\s+([؀-ۿ]+(?:\s[؀-ۿ]+){0,2})/g;
  const YEAR_CUE = /\b(?:since|est\.?|established(?: in)?|founded(?: in)?)\s+((?:18|19|20)\d{2})\b/gi;
  const HOW_LONG = /\b(?:(?:for\s+)?(?:over|more than|nearly|almost)\s+([a-z]+(?:-[a-z]+)?|\d{1,3})\+?\s+(?:decades|years|generations)|(\d{1,3})\+?\s+years\s+(?:of|in)\b)/gi;
  const TIME = '\\d{1,2}(?::\\d{2})?\\s?(?:a\\.?m\\.?|p\\.?m\\.?)';
  const HOURS = new RegExp(`\\b(${TIME})\\s?(?:–|—|-|to|until|till)\\s?(${TIME})`, 'gi');
  const HOURS_24 = /\b([01]?\d:[0-5]\d)\s?(?:–|—|-|to)\s?([01]?\d:[0-5]\d|2[0-3]:[0-5]\d)\b/g;
  const HOURS_CUE = /\b(?:hours?|open(?:ing)?|daily|everyday|every day|weekdays?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|closed|schedule|working)\b/i;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
  const NOT_MAIL = /@\dx|\.(?:png|jpe?g|gif|svg|webp|avif|css|m?js)$|@(?:example|domain|yourdomain|yourcompany|company|email|site|website|test|sample)\.|^(?:you|your|name|user|email|info)@(?:your|domain)/i;
  const SOCIAL = /https?:\/\/(?:www\.|m\.)?(?:(?:instagram|facebook|fb|twitter|x|tiktok)\.com\/@?|linkedin\.com\/(?:company|in)\/|youtube\.com\/(?:@|c\/|channel\/|user\/)|wa\.me\/)([A-Za-z0-9._-]{3,60})/gi;
  const NOT_HANDLE = /^(?:your|yourhandle|yourbrand|yourname|username|handle|example|brand|company|business|name|sharer|share|intent|p|reel|explore|login)/i;

  const normStreet = (s) => squash(s).replace(/\bst\b/g, 'street').replace(/\brd\b/g, 'road').replace(/\bave\b/g, 'avenue').replace(/\bblvd\b/g, 'boulevard').replace(/\bsq\b/g, 'square').replace(/\bln\b/g, 'lane').replace(/\bdr\b/g, 'drive').replace(/\bhwy\b/g, 'highway');
  const hoursKey = (a, b) => `${a}-${b}`.toLowerCase().replace(/[\s.]/g, '').replace(/:00/g, '');
  const TEMPLATE_STREET = /^(?:123|1234|12345|1)\s+(?:main|example|sample|your|any|test|fake|street)/i;

  /** Every checkable detail in `text`, `{ kind, shown, key }`, each once. */
  function specifics(text) {
    const t = String(text == null ? '' : text);
    const out = [];
    const seen = new Set();
    const add = (kind, shown, key) => {
      const id = `${kind}|${key}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ kind, shown: String(shown).replace(/\s+/g, ' ').trim().slice(0, 90), key });
    };
    for (const p of phonesIn(t, true)) add('phone', p.shown, p.key);
    for (const m of t.matchAll(STREET)) {
      const shown = `${m[1]} ${m[2]}${m[3]}`;
      if (TEMPLATE_STREET.test(shown)) continue;
      add('address', shown, { num: m[1].toLowerCase(), name: normStreet(m[2]), line: normStreet(`${m[1]} ${m[2]} ${m[3]}`) });
    }
    for (const m of t.matchAll(ARABIC_STREET)) add('address', m[0], { num: String(m[1]).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660), name: squash(m[2]), line: squash(m[0]) });
    for (const m of t.matchAll(YEAR_CUE)) add('year', m[0], m[1]);
    for (const m of t.matchAll(HOW_LONG)) add('years', m[0], squash(m[0]).replace(/^for /, ''));
    for (const re of [HOURS, HOURS_24]) {
      for (const m of t.matchAll(re)) {
        if (!HOURS_CUE.test(t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 30))) continue;
        add('hours', m[0], hoursKey(m[1], m[2]));
      }
    }
    for (const m of t.matchAll(EMAIL)) if (!NOT_MAIL.test(m[0])) add('email', m[0], m[0].toLowerCase());
    for (const m of t.matchAll(SOCIAL)) {
      const handle = m[1].replace(/^@/, '').toLowerCase();
      if (!NOT_HANDLE.test(handle)) add('link', m[0], handle);
    }
    return out;
  }

  /** Lines of square brackets that show as text on a page: a visitor would read them. */
  function placeholdersIn(text) {
    const out = [];
    const t = String(text == null ? '' : text);
    for (const m of t.matchAll(/\[([^\[\]\n]{3,110})\]/g)) {
      if (t[m.index + m[0].length] === '(' || !/\p{L}{3}/u.test(m[1])) continue;
      out.push(m[0].replace(/\s+/g, ' ').trim());
    }
    for (const m of t.matchAll(/\blorem ipsum\b|\byour (?:business|company|brand|shop|store) name\b|\bX{3,}[-\s]X{3,}\b/gi)) out.push(m[0]);
    return [...new Set(out)];
  }

  // ── What the run was told and read ──────────────────────────────────────

  const argsOf = (call) => {
    const a = call && (call.arguments != null ? call.arguments : call.function && call.function.arguments);
    if (a && typeof a === 'object') return a;
    try { return JSON.parse(a || '{}') || {}; } catch { return {}; }
  };
  const nameOf = (call) => (call && (call.name || (call.function && call.function.name))) || '';

  /**
   * What the conversation holds that is a source: the person's words, what
   * the web, a note or a connected system returned, and what a file read
   * said that the agent had not written, reading in the order it happened.
   * `pictures` is whether the person attached one.
   */
  function evidenceOf(messages) {
    const parts = [];
    const wrote = new Set();
    const asked = new Map();
    let pictures = false;
    for (const m of Array.isArray(messages) ? messages : []) {
      if (!m) continue;
      if (m.role === 'user' && !m.note) {
        if (typeof m.content === 'string') parts.push(m.content);
        if (Array.isArray(m.images) && m.images.length) pictures = true;
      } else if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const c of m.tool_calls) {
          const name = nameOf(c), a = argsOf(c);
          if (c.id) asked.set(c.id, { name, a });
          if (WRITERS.has(name)) for (const p of [a.path, a.from, a.to]) if (p) wrote.add(slash(p));
        }
      } else if (m.role === 'tool' && typeof m.content === 'string') {
        const name = m.name || (asked.get(m.tool_call_id) || {}).name || '';
        if (name === 'read_file') {
          const path = slash((asked.get(m.tool_call_id) || { a: {} }).a.path);
          if (path && !wrote.has(path)) parts.push(m.content);
        } else if (name && !OWN_TOOLS.has(name)) parts.push(m.content);
      }
    }
    const text = parts.join('\n');
    return { text, squashed: squash(text), pictures, phones: new Set(phonesIn(text, false).map((p) => p.key)), hours: new Set(specifics(text.replace(/\bhours?\b/gi, 'hours hours')).filter((s) => s.kind === 'hours').map((s) => s.key)) };
  }

  /** Whether the evidence says what `s` says. */
  function sourced(s, ev) {
    switch (s.kind) {
      case 'phone': return ev.phones.has(s.key);
      case 'year': return new RegExp(`\\b${s.key}\\b`).test(ev.text);
      case 'years': return ev.squashed.includes(s.key);
      case 'hours': return ev.hours.has(s.key) || ev.squashed.replace(/ /g, '').includes(s.key.replace(/-/g, ''));
      case 'email': return ev.text.toLowerCase().includes(s.key);
      case 'link': return ev.text.toLowerCase().includes(s.key);
      case 'address': {
        const { num, name, line } = s.key;
        if (ev.squashed.includes(normStreet(line))) return true;
        // The number and the street's name close together, in either order, however the street was abbreviated.
        let at = -1;
        while ((at = ev.squashed.indexOf(name, at + 1)) >= 0) {
          if (new RegExp(`(?:^|\\s)${num}(?:\\s|$)`).test(ev.squashed.slice(Math.max(0, at - 24), at + name.length + 24))) return true;
        }
        return false;
      }
      default: return true;
    }
  }

  // ── What a run's files hold that nothing says ───────────────────────────

  /** The files a run changed that a visitor reads, as `worth` of them. */
  const worth = (changed) => (Array.isArray(changed) ? changed : []).map(String).filter((p) => PAGE.test(p)).slice(0, MOST_FILES);

  /** The pages a run changed as they are now, `[{ path, text }]`, each read with `read` (the check that never asks); one that cannot be read is left out. */
  async function gather(changed, root, read) {
    const base = String(root || '').replace(/[\\/]+$/, '');
    const files = [];
    for (const p of worth(changed)) {
      const full = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p) ? p : `${base}/${p}`;
      const text = await Promise.resolve().then(() => read(full)).catch(() => null);
      if (typeof text === 'string') files.push({ path: full, text });
    }
    return files;
  }

  /**
   * `files` is `[{ path, text }]`, as they are now; `messages` the conversation.
   * Returns `{ unsourced, placeholders, total, pictures }`.
   */
  function check({ files, messages } = {}) {
    const ev = evidenceOf(messages);
    const unsourced = [];
    const placeholders = [];
    const seen = new Set();
    for (const f of Array.isArray(files) ? files : []) {
      if (!f || typeof f.text !== 'string' || !PAGE.test(f.path || '')) continue;
      const visible = visibleText(f.path, f.text);
      if (PROSE.test(f.path)) for (const shown of placeholdersIn(visible)) placeholders.push({ path: f.path, shown });
      if (ev.pictures) continue;
      for (const s of specifics(visible)) {
        const id = `${s.kind}|${typeof s.key === 'object' ? s.key.line : s.key}`;
        if (seen.has(id) || sourced(s, ev)) continue;
        seen.add(id);
        unsourced.push({ path: f.path, kind: s.kind, shown: s.shown });
      }
    }
    return { unsourced, placeholders, total: unsourced.length + placeholders.length, pictures: ev.pictures };
  }

  const nameIn = (path, root) => {
    const p = slash(path), r = slash(root || '').replace(/\/+$/, '');
    return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p.split('/').pop();
  };

  /** The details as a list a person reads: the first few, then how many more. */
  function listOf(items) {
    const shown = items.slice(0, MOST_SHOWN).map((i) => i.shown);
    return items.length > MOST_SHOWN ? `${shown.join(', ')} and ${items.length - MOST_SHOWN} more` : shown.join(', ');
  }

  /** What the person is told under the answer, or '' when nothing is left. */
  function leftLine(found) {
    if (!found || !found.total) return '';
    const a = found.unsourced.length
      ? `Not confirmed from anything you gave me or I read: ${listOf(found.unsourced)}. Check ${found.unsourced.length === 1 ? 'it' : 'them'} before this goes live.` : '';
    const b = found.placeholders.length ? `Still on the page as unfinished text: ${listOf(found.placeholders)}.` : '';
    return [a, b].filter(Boolean).join(' ');
  }

  window.HCCodeFacts = { visibleText, specifics, placeholdersIn, evidenceOf, sourced, worth, gather, check, listOf, leftLine, nameIn, KIND, PAGE };
})();
