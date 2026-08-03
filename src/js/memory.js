// ==============================================================
// What the app remembers about you, and how it finds it again
//
// Two pieces of pure logic that were buried in app.js:
//
//   extractFacts   reads a message and picks out the things worth keeping
//   rankMemories   given the stored facts and a question, orders them
//
// Both are worth testing, and neither was. Extraction is where a past defect
// lived: the patterns ran to the end of the clause, so "my name is seif save
// it" stored the name as "seif save it". Ranking is worse to get wrong and
// harder to notice — a fact that is stored but never surfaces makes the model
// deny knowing something it was told, which reads as the app forgetting.
//
// The saving is deliberately NOT here. extractFacts returns what it found and
// app.js decides what to store, so this file can be run over any text without
// writing to anyone's memory.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCMemory.
// Checked by scripts/checks/memory.mjs.
// ==============================================================

(function () {
  'use strict';

  // ── Recall ───────────────────────────────────────────────────────────────

  /**
   * Words that should find each other.
   *
   * A question rarely uses the words a fact was stored with: someone who said
   * "I love cats" asks "what animal do I like". Without these, that fact
   * scores nothing and the model answers that it does not know.
   */
  const MEM_SYNONYMS = [
    ['love', 'loves', 'loved', 'loving', 'like', 'likes', 'liked', 'liking', 'favorite', 'favourite', 'favorites', 'favourites', 'favored', 'prefer', 'prefers', 'preferred', 'preference', 'preferences', 'enjoy', 'enjoys', 'enjoyed', 'fan', 'into', 'adore', 'adores'],
    ['hate', 'hates', 'hated', 'dislike', 'dislikes', 'disliked', 'loathe', 'loathes', 'despise', 'despises'],
    ['animal', 'animals', 'pet', 'pets', 'creature', 'creatures'],
    ['work', 'works', 'working', 'job', 'jobs', 'career', 'employer', 'company', 'employed', 'occupation', 'profession'],
    ['live', 'lives', 'living', 'home', 'city', 'town', 'reside', 'resides', 'based', 'located', 'location', 'address'],
    ['name', 'named', 'called', 'calls'],
    ['birthday', 'birth', 'born', 'dob', 'age'],
    ['family', 'spouse', 'wife', 'husband', 'partner', 'kid', 'kids', 'child', 'children', 'son', 'daughter', 'mom', 'dad', 'mother', 'father', 'brother', 'sister'],
    ['food', 'foods', 'eat', 'eats', 'cuisine', 'meal', 'dish', 'snack'],
    ['drink', 'drinks', 'beverage', 'coffee', 'tea', 'alcohol'],
    ['music', 'song', 'songs', 'band', 'artist', 'genre'],
    ['movie', 'movies', 'film', 'films', 'show', 'shows', 'series'],
    ['color', 'colors', 'colour', 'colours'],
    ['language', 'languages', 'speak', 'speaks', 'spoken'],
    ['project', 'projects', 'building', 'builds', 'working_on'],
    ['deadline', 'deadlines', 'due', 'by', 'ship', 'launch'],
    ['goal', 'goals', 'aim', 'aims', 'plan', 'plans', 'target', 'targets'],
    ['allergy', 'allergies', 'allergic', 'intolerant'],
  ];

  const MEM_SYN_MAP = (() => {
    const m = new Map();
    for (const group of MEM_SYNONYMS) for (const w of group) m.set(w, group);
    return m;
  })();

  /** Cheap suffix stemmer — collapses plurals and tenses to a common stub. */
  function memStem(w) {
    const word = String(w || '').toLowerCase();
    if (word.length <= 3) return word;
    return word
      .replace(/(?:ing|edly|edness|ies|ied|ily|ment|ness|tion|sion)$/, '')
      .replace(/(?:ed|es|ly|er|or|al)$/, '')
      .replace(/s$/, '');
  }

  /** A word, its stem, and anything that means the same. */
  function memExpand(token) {
    const base = memStem(token);
    const out = new Set([token, base]);
    const grp = MEM_SYN_MAP.get(token) || MEM_SYN_MAP.get(base);
    if (grp) for (const w of grp) { out.add(w); out.add(memStem(w)); }
    return Array.from(out).filter((t) => t.length >= 2);
  }

  /**
   * Order stored facts against a question.
   *
   * A word the user actually typed is worth more than a synonym of it, which
   * is why the original token scores its full length and an expansion scores
   * less. Recent facts get a small floor so that something learned in the last
   * week still surfaces when nothing matches by keyword — which is what makes
   * "what did I just tell you" work at all.
   *
   * `now` is a parameter so the recency rule can be checked without waiting.
   */
  function rankMemories(facts, query, opts) {
    const limit = (opts && opts.limit) || 6;
    const now = (opts && opts.now) || Date.now();
    const arr = Array.isArray(facts) ? facts : [];
    if (!arr.length) return [];

    const q = String(query || '').toLowerCase();
    // No question: the most recent facts, newest first.
    if (!q) return arr.slice(-limit).reverse();

    const rawTokens = q.split(/[^a-z0-9_]+/i).filter((t) => t.length >= 2);
    const expanded = new Map();
    for (const t of rawTokens) {
      for (const e of memExpand(t)) {
        const w = e === t ? t.length : Math.max(2, e.length * 0.7);
        expanded.set(e, Math.max(expanded.get(e) || 0, w));
      }
    }

    const scored = arr.map((f) => {
      const blob = `${f.key} ${f.value}`.toLowerCase();
      const blobStem = blob.split(/[^a-z0-9_]+/).map(memStem).join(' ');
      let score = 0;
      for (const [tok, w] of expanded) {
        if (blob.includes(tok) || blobStem.includes(memStem(tok))) score += w;
      }
      const ageDays = (now - f.ts) / 86400000;
      const recency = 2 - ageDays * 0.05;
      score += ageDays < 7 ? Math.max(0.1, recency) : Math.max(0, recency);
      return { ...f, _score: score };
    });

    return scored.filter((f) => f._score > 0).sort((a, b) => b._score - a._score).slice(0, limit);
  }

  // ── Extraction ───────────────────────────────────────────────────────────

  /**
   * Words that end a name.
   *
   * A name is at most a few words and the sentence usually carries on past it.
   * Patterns that ran to the end of the clause stored "my name is seif save
   * it" as the name "seif save it", and "my name is seif and i work at acme"
   * as everything after "is".
   */
  const NOT_A_NAME = new Set([
    'and', 'but', 'so', 'then', 'also', 'please', 'save', 'remember', 'store', 'keep',
    'it', 'that', 'this', 'ok', 'okay', 'thanks', 'thank', 'now', 'too', 'as', 'well',
    'i', 'im', 'my', 'me', 'you', 'we', 'they', 'he', 'she', 'is', 'are', 'was', 'from',
    'who', 'what', 'when', 'where', 'why', 'how', 'for', 'with', 'by', 'in', 'on', 'at',
  ]);

  function cleanName(raw) {
    const words = String(raw || '').trim().split(/\s+/);
    const kept = [];
    for (const word of words) {
      if (kept.length >= 3) break;
      if (NOT_A_NAME.has(word.toLowerCase().replace(/[^a-z']/g, ''))) break;
      kept.push(word);
    }
    return kept.join(' ');
  }

  /** Longest a remembered value may be, before it is prose rather than a fact. */
  const MAX_VALUE_CHARS = 200;
  /** Longest a message may be before extraction is skipped entirely. */
  const MAX_MESSAGE_CHARS = 1200;

  /**
   * Read a message and return the facts worth keeping, without storing any of
   * them — the caller decides that.
   *
   * `now` is a parameter only so the keys generated for free-form notes are
   * predictable when checked.
   */
  function extractFacts(text, opts) {
    const now = (opts && opts.now) || Date.now();
    const t = String(text || '').trim();
    if (!t || t.length > MAX_MESSAGE_CHARS) return [];

    const found = [];
    const push = (key, value) => {
      const v = String(value || '').trim().replace(/[.!?]+$/, '');
      if (!v || v.length > MAX_VALUE_CHARS) return;
      found.push({ key, value: v });
    };
    const noteKey = () => `note_${now.toString(36)}`;

    const patterns = [
      // Identity
      [/\bmy\s+name\s+is\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, (m) => push('name', cleanName(m[1]))],
      [/\bi(?:'m|\s+am)\s+called\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, (m) => push('name', cleanName(m[1]))],
      [/\bcall\s+me\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, (m) => push('name', cleanName(m[1]))],
      [/\bthis\s+is\s+([A-Za-z][A-Za-z'\- ]{1,40})\s+speaking/i, (m) => push('name', cleanName(m[1]))],
      // Preferences
      [/\bi\s+(?:love|like|enjoy|adore|prefer|am\s+a\s+fan\s+of)\s+([^,.;!?\n]{2,80})/i, (m) => push('likes', m[1])],
      [/\bmy\s+favou?rite\s+([a-z ]{2,30}?)\s+(?:is|are)\s+([^,.;!?\n]{2,80})/i, (m) => push(`favorite_${m[1].trim().replace(/\s+/g, '_')}`, m[2])],
      [/\bi\s+(?:hate|dislike|can'?t\s+stand|loathe|despise)\s+([^,.;!?\n]{2,80})/i, (m) => push('dislikes', m[1])],
      [/\bi\s+(?:always|usually|tend\s+to)\s+([^,.;!?\n]{4,100})/i, (m) => push('habits', m[1])],
      [/\bi\s+(?:never|don'?t|do\s+not)\s+([^,.;!?\n]{4,100})/i, (m) => push('avoids', m[1])],
      // Work
      [/\bi\s+(?:work|am\s+working)\s+(?:at|for)\s+([^,.;!?\n]{2,80})/i, (m) => push('employer', m[1])],
      [/\bi(?:'m|\s+am)\s+(?:a|an)\s+([a-z ]{2,40}?)(?:\s+(?:at|for|in)\s+([^,.;!?\n]{2,80}))?/i, (m) => { push('role', m[1]); if (m[2]) push('employer', m[2]); }],
      [/\bi(?:'m|\s+am)\s+(?:building|making|developing|creating)\s+([^,.;!?\n]{4,120})/i, (m) => push('current_project', m[1])],
      // Place / origin
      [/\bi\s+live\s+in\s+([^,.;!?\n]{2,80})/i, (m) => push('location', m[1])],
      [/\bi(?:'m|\s+am)\s+(?:from|based\s+in)\s+([^,.;!?\n]{2,80})/i, (m) => push('origin', m[1])],
      [/\bi\s+speak\s+([^,.;!?\n]{2,80})/i, (m) => push('languages', m[1])],
      // Health
      [/\bi(?:'m|\s+am)\s+allergic\s+to\s+([^,.;!?\n]{2,80})/i, (m) => push('allergies', m[1])],
      [/\bmy\s+(birthday|dob)\s+(?:is\s+)?([^,.;!?\n]{2,40})/i, (m) => push('birthday', m[2])],
      [/\bi(?:'m|\s+am)\s+(\d{1,2})\s+years?\s+old/i, (m) => push('age', m[1])],
      // Project / paths, which Coder mode benefits from
      [/\bmy\s+project\s+(?:is\s+(?:at|in|located\s+at)\s+|root\s+is\s+)([^\s,.;!?\n]{4,200})/i, (m) => push('project_root', m[1])],
      [/\bworking\s+(?:directory|dir)\s+(?:is\s+)?([^\s,.;!?\n]{4,200})/i, (m) => push('workdir', m[1])],
      [/\bcheck\s+(?:the\s+)?file\s+(?:at\s+)?([^\s,.;!?\n]{4,200})/i, (m) => push('recent_file', m[1])],
      // Tech preferences
      [/\bi\s+(?:use|prefer|code\s+in|write\s+in)\s+([A-Za-z0-9+#./\- ]{2,40})\s+(?:for|as|when)/i, (m) => push('preferred_tech', m[1])],
      [/\bmy\s+stack\s+is\s+([^,.;!?\n]{4,160})/i, (m) => push('stack', m[1])],
      // Explicit "remember"
      [/\bremember\s+(?:that\s+)?([^,.;!?\n]{2,160})/i, (m) => push(noteKey(), m[1])],
      [/\bplease\s+(?:remember|note|save)\s+(?:that\s+)?([^,.;!?\n]{2,160})/i, (m) => push(noteKey(), m[1])],
      // Transliterated Arabic, which comes up in ordinary use here
      [/\bana\s+esmi\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, (m) => push('name', cleanName(m[1]))],
      [/\bismi\s+([A-Za-z][A-Za-z'\- ]{1,40})/i, (m) => push('name', cleanName(m[1]))],
    ];

    for (const [re, fn] of patterns) {
      const m = t.match(re);
      // One bad pattern must not stop the rest from running.
      if (m) try { fn(m); } catch { /* skip this one */ }
    }
    return found;
  }

  /**
   * The same, for what the assistant says back.
   *
   * A model often confirms a fact rather than calling the tool that stores it
   * — "got it, I'll remember you live in Cairo" — and without this those
   * confirmations are the one place the fact appears and then it is lost. The
   * ceiling is higher than for a user message because replies are longer.
   */
  const MAX_REPLY_CHARS = 4000;

  function extractFactsFromAssistant(text, opts) {
    const now = (opts && opts.now) || Date.now();
    const t = String(text || '').trim();
    if (!t || t.length > MAX_REPLY_CHARS) return [];

    const found = [];
    const push = (key, value) => {
      const v = String(value || '').trim().replace(/[.!?,]+$/, '');
      if (!v || v.length > MAX_VALUE_CHARS) return;
      found.push({ key, value: v });
    };

    const patterns = [
      [/(?:I'?ll|I\s+will|let\s+me)\s+remember\s+(?:that\s+)?(?:your|you'?re|you\s+are)\s+([^,.;!?\n]{2,160})/i, (m) => push(`note_${now.toString(36)}`, m[1])],
      [/(?:got\s+it|noted|saved)[\s,.\-—]+(?:your|you'?re)\s+(?:name\s+is\s+)?([A-Za-z][A-Za-z'\- ]{1,40})\b/i, (m) => push('name', cleanName(m[1]))],
      [/(?:noted|saved|remembered)\s+(?:that\s+)?you\s+(?:work\s+at|are\s+at)\s+([^,.;!?\n]{2,80})/i, (m) => push('employer', m[1])],
      [/(?:noted|saved)\s+(?:that\s+)?you\s+(?:live\s+in|are\s+in|are\s+from)\s+([^,.;!?\n]{2,80})/i, (m) => push('location', m[1])],
    ];

    for (const [re, fn] of patterns) {
      const m = t.match(re);
      if (m) try { fn(m); } catch { /* skip this one */ }
    }
    return found;
  }

  window.HCMemory = {
    MEM_SYNONYMS,
    MAX_REPLY_CHARS,
    extractFactsFromAssistant,
    MAX_VALUE_CHARS,
    MAX_MESSAGE_CHARS,
    memStem,
    memExpand,
    rankMemories,
    cleanName,
    extractFacts,
  };
})();
