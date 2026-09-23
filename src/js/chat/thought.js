// ============================================================
// chat/thought.js — what a model thought before it answered
//
// A model that thinks first can spend many seconds on it before the first
// word of its answer. The chat showed three dots and the word "Thinking" for
// all of that time and then threw the thinking away, so a local model that
// thinks looked stuck, and there was no way to see how an answer was reached.
//
// While it thinks, the latest of its thinking is shown in the bubble as it
// arrives. Once it answers, the thinking is kept on the reply and shown above
// it, folded, with how long it took.
//
// Pure apart from building elements. Published as window.HCThought.
// Run the checks with: npm run check:thought
// ============================================================
(function () {
  "use strict";

  const LIVE_CHARS = 480;
  const KEEP_CHARS = 20000;

  /** The latest part of the thinking, from a word boundary, for the live view. */
  function tail(text, max = LIVE_CHARS) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(-max);
    const space = cut.indexOf(" ");
    return `…${space >= 0 && space < 40 ? cut.slice(space + 1) : cut}`;
  }

  /** The thinking as it is kept on a reply: trimmed, and bounded so a long one cannot swell a saved chat. */
  function keep(text) {
    const t = String(text || "").trim();
    return t.length > KEEP_CHARS ? `${t.slice(0, KEEP_CHARS)}\n…` : t;
  }

  /** "Thought for 8 s", "Thought for 1 min 5 s", or "Thought" when the time is unknown. */
  function label(ms) {
    const s = Math.round(Number(ms) / 1000);
    if (!Number.isFinite(s) || s <= 0) return "Thought";
    return s < 60 ? `Thought for ${s} s` : `Thought for ${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  }

  /** The live view while the model thinks. Built as text, never markup. */
  function liveElement(text, doc = document) {
    const box = doc.createElement("div");
    box.className = "thought-live";
    const head = doc.createElement("div");
    head.className = "thinking-status-label";
    head.textContent = "Thinking";
    const body = doc.createElement("div");
    body.className = "thought-live-text";
    body.textContent = tail(text);
    box.append(head, body);
    return box;
  }

  /** The folded thinking above a finished reply, or null when there is none. */
  function element(text, ms, doc = document) {
    const t = keep(text);
    if (!t) return null;
    const box = doc.createElement("details");
    box.className = "thought";
    const title = doc.createElement("summary");
    title.textContent = label(ms);
    const body = doc.createElement("div");
    body.className = "thought-text";
    body.textContent = t;
    box.append(title, body);
    return box;
  }

  window.HCThought = { tail, keep, label, liveElement, element, LIVE_CHARS, KEEP_CHARS };
})();
