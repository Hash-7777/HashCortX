// ==============================================================
// Choosing what to read before designing a model
//
// Before a model is designed, Forge searches the web for how the real object
// is proportioned. The value of that step is entirely in what it reads, and
// what it read was decided by the address alone: a url containing "wikipedia"
// scored, whatever the page was about. So a run for one short, ordinary noun
// spent most of its time reading encyclopaedia articles on entirely different
// senses of the word, and handed their measurements to the design call as if
// they described the object.
//
// Nothing asked the one question that matters: is this page about the thing
// being modelled? That question is asked here, first, and a result that cannot
// answer it is dropped rather than ranked lower — a page about the wrong
// subject is not a weaker reference, it is a wrong one, and reading nothing
// beats reading that.
//
// Pure and side-effect free so scripts/checks/reference-pick.mjs can load this
// exact source and put real search results through it.
// ==============================================================
(function () {
  "use strict";

  // Words that carry no subject. "a fish" and "fish" name the same object, and
  // a query word like "model" would match half the web.
  const STOPWORDS = new Set([
    "a", "an", "the", "of", "for", "with", "and", "or", "in", "on", "at", "to",
    "my", "some", "any", "one", "two", "this", "that", "it", "its",
    "make", "made", "create", "build", "design", "generate", "model", "modelled",
    "modeled", "3d", "object", "thing", "please", "simple", "detailed", "realistic",
    "low", "high", "poly", "render", "scene", "asset", "mesh", "shape",
  ]);

  /** The words in a prompt that name what is being modelled. */
  function subjectTerms(prompt) {
    return String(prompt || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .filter((word, i, arr) => arr.indexOf(word) === i);
  }

  /** A word and the same word pluralised or singular, so "planes" matches "plane". */
  function variantsOf(term) {
    const out = [term];
    if (term.endsWith("s") && term.length > 3) out.push(term.slice(0, -1));
    else out.push(`${term}s`);
    if (term.endsWith("y") && term.length > 3) out.push(`${term.slice(0, -1)}ies`);
    return out;
  }

  /**
   * Does this result concern the subject?
   *
   * Judged on the title and the address, not the snippet. A snippet is a
   * fragment chosen by a search engine for containing the query word, so it
   * says the word appears on the page — which is true of an article about
   * optics that mentions an image plane once. A title and an address say what
   * the page is.
   */
  function isOnSubject(result, terms) {
    if (!terms.length) return true;
    const hay = `${String(result?.title || "")} ${String(result?.url || "")}`.toLowerCase();
    return terms.some((term) => variantsOf(term).some((v) => hay.includes(v)));
  }

  /** How much this page is likely to state real measurements. */
  function scoreResult(result, terms = []) {
    const url = String(result?.url || "").toLowerCase();
    const title = String(result?.title || "").toLowerCase();
    const hay = `${title} ${url}`;
    let score = 0;

    // Wanted: a page that states measurements — an encyclopaedia, a species or
    // spec page, a teaching site.
    if (/wikipedia|britannica|\.edu|\.gov|encyclopedia|species|anatomy|dimensions|specification|datasheet/.test(url)) score += 60;
    if (/proportion|ratio|measurement|size|length|weight|dimension/.test(hay)) score += 25;

    // Unwanted: somewhere to obtain a model rather than a description of one.
    if (/download|free-?3d|top-?\d|best-?\d|model-librar|marketplace|\/product\/|\/3d-models?\//.test(url)) score -= 80;
    if (/sketchfab|turbosquid|cgtrader|thingiverse|printables|grabcad|blendswap|renderfarm/.test(url)) score -= 60;

    // Naming the subject in the title is the strongest signal a page is about
    // it, and it outweighs the domain — which is the ordering that was wrong.
    if (terms.length && terms.some((term) => variantsOf(term).some((v) => title.includes(v)))) score += 70;
    return score;
  }

  /**
   * The results worth keeping, best first.
   *
   * Anything not about the subject is gone before ranking, so a high-scoring
   * domain cannot carry a page on a different subject to the top of the list.
   */
  function pickReferences(results, prompt, opts = {}) {
    const limit = Number.isFinite(opts.limit) ? opts.limit : 5;
    const terms = subjectTerms(prompt);
    const seen = new Set();
    return (Array.isArray(results) ? results : [])
      .filter((r) => r && r.url && !seen.has(r.url) && seen.add(r.url))
      .filter((r) => isOnSubject(r, terms))
      .map((r) => ({ result: r, score: scoreResult(r, terms) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.result);
  }

  /**
   * Which of those to actually open.
   *
   * Fetching a page costs seconds a person is watching, so this is deliberately
   * smaller than the list above, and it returns nothing rather than something
   * off-subject: the design call already knows what the object is, and a wrong
   * reference is worse than none.
   */
  function pickPagesToRead(results, prompt, opts = {}) {
    const limit = Number.isFinite(opts.limit) ? opts.limit : 2;
    return pickReferences(results, prompt, { limit: Math.max(0, limit) })
      .filter((r) => scoreResult(r, subjectTerms(prompt)) > 0);
  }

  window.HCReferencePick = {
    subjectTerms,
    variantsOf,
    isOnSubject,
    scoreResult,
    pickReferences,
    pickPagesToRead,
  };
})();
