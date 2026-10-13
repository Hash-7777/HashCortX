// ==============================================================
// Looking something up for a model that cannot
//
// Asked to look up a business and build its page, a small model on this
// computer, which HashCoder gives no web tools, wrote that it had searched
// the internet and found the details, and wrote made-up ones. It had no way
// to search, and nothing in its answer said so.
//
// When the request gives a web address, or asks for something to be
// searched or looked up, and the model was not given web_search and
// fetch_url, HashCoder makes the call itself before the model's first turn:
// it reads the addresses given, two at most, or searches once for what the
// request names. The model starts from what came back. Each call still asks
// the person first, as any fetch or search does.
//
// callsFor, queryOf and turnFor are pure. Checked by scripts/checks/code-lookup.mjs.
// Loaded before the Coder mode and published as window.HCCodeLookup.
// ==============================================================

(function () {
  'use strict';

  const ADDRESS = /https?:\/\/[^\s<>"'`)\]]+/gi;
  /**
   * A request that asks for something to be found on the web, in words that
   * say so: "look it up", "look up X", "search it", "search for X", "search
   * the web", "find info about X", "from the internet". A search box, an
   * online shop or details shown on a page are things to build, not to look
   * up, and do not count.
   */
  const ASKS = /\b(?:look(?:s|ed|ing)?\s+(?:it|this|that|them|him|her)\s+up|look\s*up\b|lookup\b|google\s+(?:it|this|for)\b|search(?:es|ed|ing)?\s+(?:it|this|that|them|for|about|up|(?:on\s+)?(?:the\s+)?(?:internet|web|net|online|google))\b|(?:find|get)\s+(?:real\s+|more\s+|the\s+)?(?:info(?:rmation)?|details|facts)\s+(?:about|on|from)\b|(?:from|on)\s+the\s+(?:internet|web)\b)/i;
  /** Words that point at something already named, not a subject to search for. */
  const POINTER = /^(?:it|this|that|them|him|her|online|(?:on\s+)?(?:the\s+)?(?:internet|web|net)|for\s+(?:it|me))$/i;
  const MOST_WORDS = 12;

  const words = (t, most = MOST_WORDS) => String(t || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, most).join(' ');
  const trimEnds = (t) => String(t || '').replace(/^[\s,.;:!?'"“”-]+|[\s,.;:!?'"“”-]+$/g, '');

  /**
   * What to search for, from the request: a name it gives ("called X",
   * "named X"), else what follows "search for", "look up" and the like, else
   * the clause just before "look it up". '' when nothing is named.
   */
  function queryOf(request) {
    const r = String(request || '').replace(ADDRESS, ' ');
    const named = /\b(?:called|named)\s+(.{2,240}?)(?=\s+(?:and\s+)?(?:look|search|google|find|get|to\s+get|use|so|then|with)\b|[,.;!?\n]|$)/i.exec(r);
    if (named && trimEnds(named[1])) return words(trimEnds(named[1]));
    const after = /\b(?:search(?:\s+(?:for|about|on|the\s+web\s+for|online\s+for))?|look\s+up|google|research|find\s+(?:out\s+)?(?:about|info(?:rmation)?\s+(?:on|about)|details\s+(?:on|about)))\s+(.{2,240}?)(?=\s+(?:and|to|then|so|for\s+the|on\s+the\s+(?:internet|web))\b|[,.;!?\n]|$)/i.exec(r);
    if (after && trimEnds(after[1]) && !POINTER.test(trimEnds(after[1]))) return words(trimEnds(after[1]));
    const at = r.search(ASKS);
    if (at > 0) {
      const before = r.slice(0, at).split(/[,.;!?\n]|\band\s+(?:make|build|create|write|then)\b/i).pop();
      const subject = trimEnds(before.replace(/^\s*(?:and|please|also|then|so)\s+/i, ''));
      if (subject && !POINTER.test(subject)) return words(subject);
    }
    return '';
  }

  /**
   * The calls HashCoder makes before the model's first turn, `[{ name,
   * arguments }]`, or none. `offered` is the names of the tools the model was
   * given; a model given web_search and fetch_url does its own looking up.
   * `earlier` is what the person said before, newest first: "search on the
   * internet" after a request that named a business searches for that name.
   */
  function callsFor(request, offered, earlier = []) {
    const have = new Set(Array.isArray(offered) ? offered : []);
    if (have.has('web_search') && have.has('fetch_url')) return [];
    const r = String(request || '');
    const urls = [...new Set((r.match(ADDRESS) || []).map((u) => u.replace(/[.,;:!?]+$/, '')))].slice(0, 2);
    if (urls.length) return urls.map((url) => ({ name: 'fetch_url', arguments: { url } }));
    if (!ASKS.test(r)) return [];
    let query = queryOf(r);
    for (const said of Array.isArray(earlier) ? earlier : []) { if (query) break; query = queryOf(said) || (ASKS.test(String(said)) ? '' : named(said)); }
    return query ? [{ name: 'web_search', arguments: { query } }] : [];
  }

  /** A name an earlier message gives, without asking for a search: "the pharmacy called X". */
  function named(said) {
    const m = /\b(?:called|named)\s+(.{2,240}?)(?=\s+(?:and|to|so|then|with)\b|[,.;!?\n]|$)/i.exec(String(said || '').replace(ADDRESS, ' '));
    return m ? words(trimEnds(m[1])) : '';
  }

  /**
   * The turn HashCoder takes for the model before its first, from the run's
   * conversation, its request and the tools offered, or null. The calls are
   * given ids of their own, as a turn's calls must have.
   */
  function turnFor(messages, request, tools) {
    const list = Array.isArray(messages) ? messages : [];
    const earlier = list.filter((m) => m && m.role === 'user' && !m.note && typeof m.content === 'string').map((m) => m.content).reverse().slice(1, 4);
    const calls = callsFor(request, (Array.isArray(tools) ? tools : []).map((t) => (t && t.function ? t.function.name : t && t.name)), earlier);
    const at = Date.now();
    return calls.length ? { content: '', tool_calls: calls.map((c, i) => ({ id: `look_${at}_${i}`, ...c })) } : null;
  }

  window.HCCodeLookup = { callsFor, queryOf, turnFor, ASKS };
})();
