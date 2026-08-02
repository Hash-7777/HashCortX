// ==============================================================
// Knowledge-base retrieval — the ranking maths
//
// Extracted from app.js so it can be tested. These functions are pure: they
// take their inputs, touch no DOM, no storage and no network, and return a
// value. That is the whole reason this file exists — retrieval quality is
// the part of a knowledge base that silently degrades, and it is untestable
// while it lives inside an 8,800-line closure.
//
// Loaded before app.js and published as window.HCRagSearch.
// Checked by scripts/checks/rag.mjs.
// ==============================================================

(function () {
  'use strict';

  const STOP_WORDS = new Set(
    ('a an the and or but in on at to of for is are was were be been being have has had do does ' +
     'did will would could should may might shall can this that these those with from by into out ' +
     'up as it its if not no so i we you he she they their them our my your his her its what which ' +
     'who when where how all just also only more over than then').split(' ')
  );

  /** Content words, deduplicated and lower-cased. */
  function extractKeywords(text) {
    return [...new Set(
      String(text || '').toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    )];
  }

  /** Weight given to a term found in the title rather than the body. */
  const TITLE_WEIGHT = 1.6;

  /**
   * Lexical overlap between a query's keywords and a stored chunk.
   *
   * Word length stands in for inverse document frequency: a real IDF needs
   * corpus statistics this store does not keep, and longer words are rarer and
   * more informative often enough for the approximation to earn its keep.
   *
   * The title is searched as well as the body, not merely used to multiply a
   * body match. Previously a term had to appear in `chunk.keywords` — which is
   * built from the body text alone — before the title could boost it, so a
   * chunk titled "Permission Guard" whose body never repeated those words
   * could not be found by searching for them at all. Titles are usually the
   * most informative field in a chunk, so that lost exactly the matches most
   * worth having. Reading the title at query time rather than at ingest means
   * chunks stored by earlier builds are fixed too, with no migration.
   */
  function keywordScore(queryKeywords, chunk) {
    if (!queryKeywords.length || !chunk) return 0;
    const inBody = new Set(chunk.keywords || []);
    const inTitle = new Set(extractKeywords(chunk.title || ''));
    if (!inBody.size && !inTitle.size) return 0;
    let score = 0;
    let total = 0;
    for (const word of queryKeywords) {
      const weight = Math.log(2 + word.length);
      total += weight;
      if (inTitle.has(word)) score += weight * TITLE_WEIGHT;
      else if (inBody.has(word)) score += weight;
    }
    return total > 0 ? score / total : 0;
  }

  /**
   * Cosine similarity. Vectors are L2-normalised when produced, so this is a
   * dot product. Mismatched widths score 0 rather than throwing: a chunk
   * embedded by an older build belongs to a different vector space, and
   * comparing across spaces produces confident nonsense.
   */
  function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  /** The constant from the original Reciprocal Rank Fusion paper. */
  const RRF_K = 60;

  function defaultKey(chunk) {
    return String(chunk.title || '').trim().toLowerCase() + '|' + String(chunk.text || '').slice(0, 80);
  }

  /**
   * Reciprocal Rank Fusion over any number of ranked lists.
   *
   * Each list contributes 1/(K + rank) to every chunk it ranked. A chunk that
   * several rankers liked beats one that a single ranker put first.
   *
   * The point is that no score from one ranker is ever compared with a score
   * from another. A cosine similarity of 0.68 and a keyword score of 0.68 mean
   * entirely different things, and any scheme that adds or weighs them is
   * comparing quantities that share no scale. Position is the only thing the
   * two lists have in common, so position is all this uses.
   */
  function fuseByRank(lists, keyOf) {
    const key = keyOf || defaultKey;
    const scores = new Map();
    const items = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      list.forEach((chunk, rank) => {
        if (!chunk) return;
        const k = key(chunk);
        scores.set(k, (scores.get(k) || 0) + 1 / (RRF_K + rank + 1));
        if (!items.has(k)) items.set(k, chunk);
      });
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(entry => Object.assign({}, items.get(entry[0]), { _rrf: entry[1] }));
  }

  window.HCRagSearch = { STOP_WORDS, extractKeywords, keywordScore, cosineSim, fuseByRank, RRF_K };
})();
