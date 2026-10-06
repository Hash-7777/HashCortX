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
// without a referrer. The hosts are the ones the CSP names. When a model
// chose the words, `search` and `asking` put a question to the person before
// each service is reached.
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

  async function google(query, limit = 5, { key, cx, signal, fetch: fetchFn } = {}) {
    if (!key || !cx) return null;
    try {
      // Not www.googleapis.com: connect-src permits only this name. The key
      // goes in a header, never the address, which a failed request prints.
      const url = `https://customsearch.googleapis.com/customsearch/v1?cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${limit}`;
      const r = await get(fetchFn)(url, { referrerPolicy: "no-referrer", headers: { "x-goog-api-key": key }, signal });
      if (!r.ok) return null;
      const data = await r.json();
      return (data.items || []).map((it) => ({ title: it.title, snippet: it.snippet || "", url: it.link }));
    } catch { return null; }
  }

  async function wikipedia(query, limit = 3, { signal, fetch: fetchFn } = {}) {
    const f = get(fetchFn);
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryOf(query).words)}&format=json&origin=*&srlimit=${limit}&utf8=1`;
      const r = await f(searchUrl, { referrerPolicy: "no-referrer", signal });
      if (!r.ok) return [];
      const data = await r.json();
      const titles = (data.query?.search || []).map((s) => s.title);
      if (!titles.length) return [];
      // The extracts in one call.
      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`;
      const e = await f(extractUrl, { referrerPolicy: "no-referrer", signal });
      const ed = await e.json();
      return Object.values(ed.query?.pages || {}).map((p) => ({
        title: p.title,
        snippet: (p.extract || "").slice(0, SNIPPET),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`,
      })).filter((x) => x.snippet);
    } catch { return []; }
  }

  // Where each search goes, as the question about it names it.
  const HOSTS = {
    tavily: "https://api.tavily.com/search",
    google: "https://customsearch.googleapis.com/customsearch/v1",
    wiki: "https://en.wikipedia.org/w/api.php",
    pubmed: "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
  };
  const ASKS = { tavily: "Searching the web", google: "Searching the web", wiki: "Looking up on Wikipedia", pubmed: "Searching Europe PMC" };
  const LIMIT_MS = 12000;

  /**
   * One search whose words a model chose. The words go to a search service,
   * so the person is asked first, as for a web page; `ask(address, why)`
   * resolves true when allowed. The address names the service and the words,
   * so "allow for session" covers the service while a "no", which the guard
   * keeps for the session, covers only that search. Each search keeps its
   * own time, since a question may be on screen for longer than any tool is
   * given. Resolves to what `run(signal)` found, or to { declined: true }.
   */
  async function asking(service, query, run, { ask = async () => true, busy = () => null } = {}) {
    const words = String(query || "").replace(/\s+/g, " ").trim();
    const shown = words.length > 80 ? `${words.slice(0, 80)}...` : words;
    const address = `${HOSTS[service]}?q=${encodeURIComponent(words).replace(/%20/g, "+")}`;
    if (!(await ask(address, `${ASKS[service]} for "${shown}"`))) return { declined: true };
    const job = busy(address);
    try { return await run(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(LIMIT_MS) : undefined); }
    finally { job?.done?.(); }
  }

  /**
   * The agent's web_search: Tavily, then Google, then Wikipedia, each asked
   * about before it is reached, Tavily and Google only with their keys. A
   * "no" ends the search there rather than asking about the next service.
   * Resolves to { source, answer?, results, note? } or { declined: true }.
   */
  async function search(query, { keys = {}, ask, busy, fetch: fetchFn } = {}) {
    const via = { ask, busy };
    if (keys.tavily) {
      const t = await asking("tavily", query, (signal) => tavily(query, 5, { key: keys.tavily, signal, fetch: fetchFn }), via);
      if (t?.declined) return t;
      if (t && (t.results.length || t.answer)) return { source: "tavily", answer: t.answer || null, results: t.results.map(({ title, snippet, url }) => ({ title, snippet, url })) };
    }
    if (keys.google && keys.cx) {
      const g = await asking("google", query, (signal) => google(query, 5, { key: keys.google, cx: keys.cx, signal, fetch: fetchFn }), via);
      if (g?.declined) return g;
      if (g && g.length) return { source: "google", results: g };
    }
    const w = await asking("wiki", query, (signal) => wikipedia(query, 3, { signal, fetch: fetchFn }), via);
    if (w?.declined) return w;
    if (w.length) return { source: "wiki", results: w, note: keys.tavily || keys.google ? "Wikipedia only: the search services gave nothing." : "Wikipedia only: no Tavily or Google key is set." };
    return { source: "none", results: [], note: "No results." };
  }

  window.HCWebSearch = { queryOf, tavily, google, wikipedia, asking, search, HOSTS };
})();
