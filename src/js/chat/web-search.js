// ============================================================
// chat/web-search.js — the searches an agent's web_search tool makes
//
// Tavily first (built for models: clean snippets and an answer of its own),
// then Google's Custom Search, then Wikipedia, which needs no key. Each
// answers with a list of { title, snippet, url }, or null when it has no key
// or cannot be reached, so the tool can move on to the next.
//
// A QUERY WRITTEN FOR A SEARCH BOX. Models write "site:nodejs.org" the way a
// person would. Tavily has a field for the site and refuses a query that is
// nothing but that (HTTP 400), which the agent read as "no results" and so
// searched again, and again, until it ran out of steps. The site now goes in
// that field, and the rest of the words are the query.
//
// Every key is sent only to the service it belongs to, and each request goes
// without a referrer. The hosts are the ones the CSP names.
//
// `fetch` and the signal are handed in, so these run in the checks with no
// network. Published as window.HCWebSearch.
// Run the checks with: npm run check:web-search
// ============================================================
(function () {
  "use strict";

  const SNIPPET = 400;
  const SITE = /\bsite:(\S+)/gi;

  /** A query as a search box would read it: its words, and the sites it names. */
  function queryOf(query) {
    const text = String(query || "");
    const sites = [...text.matchAll(SITE)].map((m) => m[1].replace(/^https?:\/\//i, ""));
    const words = text.replace(SITE, " ").replace(/\s+/g, " ").trim()
      || sites.map((s) => s.replace(/[/._-]+/g, " ")).join(" ").trim();
    const domains = [...new Set(sites.map((s) => s.split("/")[0].toLowerCase()).filter(Boolean))];
    return { words, domains };
  }

  const get = (fetchFn) => fetchFn || ((...a) => fetch(...a));

  async function tavily(query, limit = 5, { key, signal, fetch: fetchFn } = {}) {
    if (!key) return null;
    const { words, domains } = queryOf(query);
    if (!words) return null;
    try {
      const r = await get(fetchFn)("https://api.tavily.com/search", {
        method: "POST",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query: words,
          ...(domains.length ? { include_domains: domains } : {}),
          search_depth: "basic",
          include_answer: true,
          max_results: limit,
        }),
        signal,
      });
      if (!r.ok) return null;
      const data = await r.json();
      return {
        answer: data.answer || "",
        results: (data.results || []).map((it) => ({
          title: it.title || "",
          snippet: (it.content || "").slice(0, SNIPPET),
          url: it.url || "",
          score: it.score ?? null,
        })),
      };
    } catch { return null; }
  }

  async function google(query, limit = 5, { key, cx, fetch: fetchFn } = {}) {
    if (!key || !cx) return null;
    try {
      // Not www.googleapis.com: connect-src permits only this name.
      const url = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${limit}`;
      const r = await get(fetchFn)(url, { referrerPolicy: "no-referrer" });
      if (!r.ok) return null;
      const data = await r.json();
      return (data.items || []).map((it) => ({ title: it.title, snippet: it.snippet || "", url: it.link }));
    } catch { return null; }
  }

  async function wikipedia(query, limit = 3, { fetch: fetchFn } = {}) {
    const f = get(fetchFn);
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryOf(query).words)}&format=json&origin=*&srlimit=${limit}&utf8=1`;
      const r = await f(searchUrl, { referrerPolicy: "no-referrer" });
      if (!r.ok) return [];
      const data = await r.json();
      const titles = (data.query?.search || []).map((s) => s.title);
      if (!titles.length) return [];
      // The extracts in one call.
      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`;
      const e = await f(extractUrl, { referrerPolicy: "no-referrer" });
      const ed = await e.json();
      return Object.values(ed.query?.pages || {}).map((p) => ({
        title: p.title,
        snippet: (p.extract || "").slice(0, SNIPPET),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`,
      })).filter((x) => x.snippet);
    } catch { return []; }
  }

  window.HCWebSearch = { queryOf, tavily, google, wikipedia };
})();
