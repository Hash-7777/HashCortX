// ==============================================================
// The local knowledge base
//
// Retrieval that runs entirely on the machine: passages kept in IndexedDB,
// scored by keyword overlap and by cosine distance against embeddings produced
// natively in Rust from a model that ships inside the app.
//
// Two things in here have failed silently before, which is why the checks
// around this file are as loud as they are.
//
// The embeddings used to be imported from a CDN, with weights fetched from
// huggingface.co — which connect-src does not permit. Every call threw, every
// throw was caught, and semantic search never ran in any shipped build while
// the UI went on saying retrieval was on.
//
// And retrieval's only call on the send path once sat inside a branch guarded
// by an element that had been deleted, so it never ran at all.
//
// The one thing passed in is whether the knowledge base is switched on, and it
// is a getter rather than a value because the toggle changes while the app
// runs — a copy taken at load would be wrong from the first click.
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  let isRagEnabled = () => false;

  function init(deps) {
    isRagEnabled = deps.isRagEnabled;
  }


    const RAG_KEY = "hashgpt_rag";   // the old localStorage store, migrated at boot
    const RAG_DB_NAME = "hashcortx_rag";
    const RAG_STORE = "chunks";
    const RAG_MAX_CHUNKS = 20_000;   // ceiling on the store, by passage count
    const RAG_MAX_CONTEXT = 3;       // chunks injected per query

    // Vectors are 384-wide and come from bge-small-en-v1.5. A chunk embedded by
    // an older build carries a different width and is simply ignored rather than
    // compared — mixing vector spaces produces confident nonsense.
    const RAG_VECTOR_DIM = 384;

    // ── Local embeddings ──────────────────────────────────────────────────
    // The model ships inside the app and runs natively in Rust; see
    // src-tauri/src/commands/embed.rs. This used to import transformers.js from
    // a CDN and fetch weights from huggingface.co, which connect-src does not
    // permit — so every call here threw, was caught, and semantic search
    // silently never ran in any shipped build.
    //
    // `kind` matters: bge is an asymmetric retriever, so a question and a stored
    // passage are encoded differently. Pass "query" for what the user asked and
    // "passage" for anything being stored.
    async function embedTexts(texts, kind = "passage") {
      const list = (Array.isArray(texts) ? texts : [texts])
        .map(t => String(t || "").trim())
        .filter(Boolean);
      if (!list.length) return [];
      if (!window.HC?.isTauri) return [];
      try {
        const vecs = await HC.invoke("embed_texts", { texts: list, kind });
        return Array.isArray(vecs) ? vecs : [];
      } catch (e) {
        console.warn("[embed] failed:", e?.message || e);
        return [];
      }
    }

    async function embedText(text, kind = "passage") {
      const [vec] = await embedTexts([text], kind);
      return vec || null;
    }

    // The ranking maths lives in js/rag-search.js, loaded before this file, so
    // that retrieval quality — the part of a knowledge base that degrades
    // quietly — is covered by scripts/checks/rag.mjs instead of being sealed
    // inside this closure.
    const { extractKeywords: ragExtractKeywords, keywordScore: ragScore, cosineSim, fuseByRank } =
      window.HCRagSearch;

    // How a document becomes passages, in js/rag-store.js so that the rule which
    // matters — chunking must cover the whole text — is checked rather than
    // assumed. It was not, and half of every file was being dropped.
    const HCRagStore = window.HCRagStore;

    // ── Where the knowledge base lives ────────────────────────────────────
    //
    // The store was a single localStorage entry. Every chunk carries a 384-number
    // vector, which as JSON is well over a kilobyte on its own, so a few thousand
    // passages reached the roughly 5 MB quota — and saveRAG dealt with that by
    // dropping the oldest chunks until it fit. Documents disappeared out of the
    // back of the store with no sign that anything had gone.
    //
    // It is IndexedDB now, which has no such ceiling. The store is held in memory
    // and written through in the background, so loadRAG and saveRAG keep the
    // synchronous shape their ten callers expect — including queryRAG, which runs
    // inside retrieval and cannot start awaiting.
    let _ragCache = [];
    let _ragWriteTimer = null;
    let _ragDbPromise = null;

    function ragOpenDb() {
      if (_ragDbPromise) return _ragDbPromise;
      _ragDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(RAG_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(RAG_STORE)) db.createObjectStore(RAG_STORE, { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB failed"));
      });
      return _ragDbPromise;
    }

    function ragRequest(req) {
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
      });
    }

    /**
     * Read the store into memory, once, at boot — migrating a localStorage store
     * from an earlier build if this is the first run on IndexedDB.
     */
    async function ragBootLoad() {
      try {
        const db = await ragOpenDb();
        const all = await ragRequest(db.transaction(RAG_STORE, "readonly").objectStore(RAG_STORE).getAll());
        _ragCache = Array.isArray(all) ? all : [];

        if (!_ragCache.length) {
          const legacy = localStorage.getItem(RAG_KEY);
          if (legacy) {
            const parsed = JSON.parse(legacy || "[]");
            if (Array.isArray(parsed) && parsed.length) {
              // Older entries were keyed without a position; keep them findable.
              _ragCache = parsed.map((c, i) => (c && c.key ? c : { ...c, key: `legacy#${i}` }));
              await ragPersist();
              // Only after the copy is safely readable back does the old one go,
              // and only then — losing a knowledge base to a failed migration is
              // not a trade worth making for a few megabytes of quota.
              const back = await ragRequest(db.transaction(RAG_STORE, "readonly").objectStore(RAG_STORE).getAll());
              if (Array.isArray(back) && back.length >= _ragCache.length) {
                localStorage.removeItem(RAG_KEY);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[rag] could not open the knowledge base:", e?.message || e);
        _ragCache = [];
      }
      updateRagCount();
    }

    async function ragPersist() {
      try {
        const db = await ragOpenDb();
        const tx = db.transaction(RAG_STORE, "readwrite");
        const os = tx.objectStore(RAG_STORE);
        os.clear();
        for (const c of _ragCache) os.put(c);
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch (e) {
        console.warn("[rag] could not save the knowledge base:", e?.message || e);
      }
    }

    function loadRAG() {
      return _ragCache;
    }

    function saveRAG(store) {
      _ragCache = Array.isArray(store) ? store : [];
      // A cap by count rather than by bytes. IndexedDB has room, but an
      // unbounded store makes every query slower, and this is high enough that
      // no ordinary use reaches it.
      if (_ragCache.length > RAG_MAX_CHUNKS) {
        _ragCache = _ragCache.slice(_ragCache.length - RAG_MAX_CHUNKS);
      }
      // Batched: ingesting a document calls this once per passage, and writing
      // the whole store each time would be quadratic.
      clearTimeout(_ragWriteTimer);
      _ragWriteTimer = setTimeout(() => { void ragPersist(); }, 250);
      updateRagCount();
    }

    function updateRagCount() {
      const n = loadRAG().length;
      const el = document.getElementById("ragCount");
      if (el) el.textContent = n;
      const tog = document.getElementById("ragToggle");
      if (tog) tog.classList.toggle("on", isRagEnabled());
    }

    function _ragLocalAdd(title, text, source, index = 0) {
      if (!isRagEnabled()) return;
      if (!HCRagStore.isWorthStoring(text)) return;
      const store = loadRAG();
      const key = HCRagStore.chunkKey(source, title, index);
      if (store.some(c => c.key === key)) return;
      // Stored whole. This used to cut the passage to RAG_CHUNK_MAX while the
      // caller advanced by twice that, so half of every document was dropped.
      // Splitting is the caller's job now, and it covers the whole text.
      const chunk = String(text);
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        key,
        title: (title || "").slice(0, 120),
        text: chunk,
        source: source || "unknown",
        keywords: ragExtractKeywords(chunk),
        addedAt: Date.now(),
      };
      store.push(entry);
      saveRAG(store);
      // Embed and patch asynchronously, so ingestion never blocks the UI. The
      // chunk is searchable by keyword the moment it is stored and gains
      // semantic reach a moment later.
      embedText(`${entry.title}. ${chunk}`, "passage").then(vec => {
        if (!vec) return;
        const cur = loadRAG();
        const i = cur.findIndex(c => c.key === entry.key);
        if (i >= 0) { cur[i].vec = vec; saveRAG(cur); }
      }).catch(() => {});
    }

    function queryRAG(text, topK = RAG_MAX_CONTEXT) {
      if (!isRagEnabled()) return [];
      const store = loadRAG();
      if (!store.length) return [];
      const queryKw = ragExtractKeywords(text);
      if (!queryKw.length) return [];
      return store
        .map(c => ({ ...c, _score: ragScore(queryKw, c) }))
        .filter(c => c._score > 0.14)
        .sort((a, b) => b._score - a._score)
        .slice(0, topK);
    }

    // Vector retrieval — semantic search by cosine similarity.
    //
    // Returns a RANKING, deliberately without a similarity cut-off. Measured
    // against the bundled bge model, a passage about pastry scores 0.41 against
    // a question about shell commands, while a genuinely relevant one scores
    // 0.68 — the numbers live in a high, compressed band where any absolute
    // threshold is either arbitrary or lets everything through. The old 0.32
    // cut-off would admit literally every chunk in the store. What separates
    // results here is position, not score, so ranking is what this returns and
    // fusion is what uses it.
    async function queryRAGVector(text, topK = RAG_MAX_CONTEXT) {
      if (!isRagEnabled()) return [];
      const store = loadRAG();
      const withVec = store.filter(c => Array.isArray(c.vec) && c.vec.length === RAG_VECTOR_DIM);
      if (!withVec.length) return [];
      const qVec = await embedText(text, "query");
      if (!qVec) return [];
      return withVec
        .map(c => ({ ...c, _score: cosineSim(qVec, c.vec) }))
        .sort((a, b) => b._score - a._score)
        .slice(0, topK);
    }

    // RAG card events are wired per-render inside renderAgentsList()

    function addToRAG(title, text, source) {
      _ragLocalAdd(title, text, source);
    }

    /**
     * Add a whole document, split into overlapping passages that between them
     * cover every character of it.
     *
     * The splitting rule lives in js/rag-store.js so it can be checked. It is
     * there because the previous arrangement lost half of every file: this
     * caller advanced 1200 characters at a time while the store kept only the
     * first 600 of each step.
     */
    function ingestIntoRAG(title, text, sourcePrefix) {
      if (!isRagEnabled()) return 0;
      const chunks = HCRagStore.chunkText(text);
      for (const c of chunks) _ragLocalAdd(title, c.text, sourcePrefix, c.index);
      return chunks.length;
    }

    // Hybrid retrieval by Reciprocal Rank Fusion.
    //
    // Semantic search catches paraphrase — "CEO" finding "chief executive" —
    // and keyword search catches the things embeddings blur: rare names, error
    // codes, identifiers. Neither is reliably better, so the question is how to
    // combine them.
    //
    // Concatenating the two lists, which is what this used to do, gives the
    // semantic list absolute priority: its third-best guess outranked the
    // keyword list's perfect match. RRF instead scores each chunk by where it
    // placed in each list, 1/(K + rank), and adds those up. A chunk both
    // rankers liked beats one that only a single ranker put first, and no
    // comparison is ever made between a cosine similarity and a keyword score —
    // two numbers that share no scale and should never be weighed against each
    // other.
    //
    // The fusion itself is in js/rag-search.js, where it can be tested.
    const _queryRAGLocal = queryRAG;

    async function queryRAGMerged(text) {
      if (!isRagEnabled()) return [];
      // Ask each ranker for more than we need: fusion can only reorder what it
      // is given, so a chunk outside both shortlists can never be recovered.
      const depth = RAG_MAX_CONTEXT * 3;
      const vec = await queryRAGVector(text, depth).catch(() => []);
      const kw = _queryRAGLocal(text, depth);
      return fuseByRank([vec, kw]).slice(0, RAG_MAX_CONTEXT + 2);
    }

  window.HCRag = {
    init,
    RAG_KEY,
    addToRAG, ingestIntoRAG, loadRAG, saveRAG, queryRAGMerged, ragBootLoad,

    // What the base holds, so a panel can say "on and empty" rather than
    // leaving someone to guess why nothing comes back. This used to be done by
    // reading the cache array directly from app.js, which is the kind of reach
    // across a boundary that only works while both halves are in one file.
    size() {
      const chunks = _ragCache || [];
      return { passages: chunks.length, sources: new Set(chunks.map((c) => c.source || '')).size };
    },
  };
})();
