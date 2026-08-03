// ==============================================================
// Knowledge base — how a document becomes chunks
//
// Extracted so it can be tested, because the way this was done lost half of
// every file. Ingest walked the text in 1200-character steps and then stored
// only the first 600 of each step, so characters 600–1199 of every step were
// dropped. Nothing reported it: the file appeared in the store, it was simply
// missing every other passage.
//
// The rule these functions exist to hold: chunking must cover the whole text.
// There is a check for exactly that, over random inputs, in
// scripts/checks/rag-store.mjs.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCRagStore.
// ==============================================================

(function () {
  'use strict';

  /**
   * Characters per chunk.
   *
   * bge-small-en-v1.5 reads 512 tokens, roughly 2,000 characters, so 1,200
   * sits comfortably inside the window while giving a passage enough context
   * to mean something. The old value was 600, which was half of the step the
   * caller was advancing by — that mismatch was the bug.
   */
  const CHUNK_SIZE = 1200;

  /**
   * How much each chunk repeats of the one before it.
   *
   * A sentence that straddles a boundary would otherwise be split across two
   * chunks and be properly present in neither, which is the retrieval failure
   * that is hardest to notice: the text is stored, and no query matches it.
   */
  const CHUNK_OVERLAP = 200;

  /**
   * Split text into overlapping chunks that, between them, contain every
   * character of the input.
   *
   * Prefers to end a chunk at a paragraph or sentence boundary when one is
   * near the limit, so passages read as passages rather than being cut
   * mid-word. The boundary search never moves the split earlier than the
   * overlap allows, which is what keeps progress guaranteed and stops the
   * caller looping forever on text with no punctuation.
   */
  function chunkText(text, opts) {
    const size = (opts && opts.size) || CHUNK_SIZE;
    const overlap = (opts && opts.overlap) != null ? opts.overlap : CHUNK_OVERLAP;
    const s = String(text == null ? '' : text);
    if (!s.trim()) return [];
    if (s.length <= size) return [{ text: s, index: 0, start: 0 }];

    // Overlap is capped at half the chunk, whatever the caller passes, so each
    // chunk always advances by a useful amount rather than crawling forward a
    // character at a time.
    const lap = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
    const chunks = [];
    let start = 0;
    let index = 0;

    while (start < s.length) {
      let end = Math.min(s.length, start + size);

      if (end < s.length) {
        // Look for a natural break in the last quarter of the chunk only, so a
        // chunk is never shortened so far that the next one cannot advance.
        const earliest = start + Math.floor(size * 0.75);
        const window = s.slice(earliest, end);
        const para = window.lastIndexOf('\n\n');
        const line = window.lastIndexOf('\n');
        const stop = Math.max(
          window.lastIndexOf('. '),
          window.lastIndexOf('! '),
          window.lastIndexOf('? ')
        );
        if (para >= 0) end = earliest + para + 2;
        else if (stop >= 0) end = earliest + stop + 2;
        else if (line >= 0) end = earliest + line + 1;
      }

      chunks.push({ text: s.slice(start, end), index, start });
      index++;
      if (end >= s.length) break;
      // The next chunk starts from where this one actually ENDED, not from a
      // fixed stride. Stepping by a stride is what leaves a hole: when the
      // boundary search shortens a chunk, a fixed step lands past its end and
      // the characters in between belong to no chunk at all.
      start = Math.max(start + 1, end - lap);
    }
    return chunks;
  }

  /**
   * The identity of a stored chunk, used to avoid storing the same passage
   * twice. Includes the position, so two different passages of one document
   * are not mistaken for each other.
   */
  function chunkKey(source, title, index) {
    return `${source || 'unknown'}#${index || 0}::${String(title || '').slice(0, 80)}`;
  }

  /**
   * Whether a passage is worth storing at all. Very short fragments carry no
   * retrievable meaning and only dilute the store.
   */
  const MIN_CHUNK_CHARS = 40;
  function isWorthStoring(text) {
    return String(text || '').trim().length >= MIN_CHUNK_CHARS;
  }

  window.HCRagStore = {
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    MIN_CHUNK_CHARS,
    chunkText,
    chunkKey,
    isWorthStoring,
  };
})();
