// ==============================================================
// The asks in a request, as a checklist
//
// A request of several parts, joined with "also", semicolons or new lines,
// was often finished in part: one ask done, the next forgotten, and the
// person asking again. The request is split into its asks here, with no
// model: new lines and list items first, then sentences, then the joins
// people put between asks ("also", "and also", "and I want"). A piece is an
// ask when it asks for something, a verb of change or "I want", "can you";
// a piece that only describes the situation is left out of the list, and
// the request itself always goes whole.
//
// With three asks or more, the list goes with the request
// (js/code/context.js forRequest), and the agent is sent back once before
// it finishes to go through it ask by ask (js/code/verify.js asksCheck).
//
// Pure; code blocks are found by js/fences.js. Loaded before the Coder mode
// and published as window.HCCodeAsks.
// Checked by scripts/checks/code-asks.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Fewer asks than this are one request, not a list. */
  const MIN_ASKS = 3;
  /** No more than this many are listed. */
  const MOST_ASKS = 12;
  /** An ask is cut to this many characters. */
  const LONGEST_ASK = 160;
  /** A request longer than this is mostly pasted material, and is not split. */
  const LONGEST_REQUEST = 4000;

  /** Verbs that ask for something to be done. */
  const VERBS = 'fix|add|change|make|remove|delete|drop|build|create|write|update|rename|move|replace|use|put|show|hide|set|turn|implement|improve|redesign|refactor|check|test|clean|convert|translate|increase|reduce|align|centre|center|enable|disable|support|keep|give|bring|swap|resize|shorten|lengthen|simplify|tell|explain|find|investigate|look';
  const ASKING = new RegExp(`\\b(?:${VERBS}|want|need|should|must|can (?:you|we|u)|could you|please|let me know)\\b`, 'i');
  /** A question is an ask too: it wants an answer. */
  const QUESTION = /\?\s*$|^(?:why|how|what|where|when|which|who|does|do|is|are|can|could|should|will|would)\b/i;

  /** The joins people put between asks, inside one sentence. */
  const JOINS = [
    /\s*[,;]?\s*\b(?:and\s+)?also\b[\s,]*/i,
    /\s*,\s+and\s+/i,
    /\s+and\s+(?=(?:i|we)\s+(?:want|need|would like)\b)/i,
    /\s*;\s*/,
  ];
  /** "fix the menu and add a footer": two asks, each of three words or more. */
  const AND_VERB = new RegExp(`\\s+and\\s+(?=(?:${VERBS})\\b)`, 'i');
  function andVerb(piece) {
    const parts = piece.split(AND_VERB);
    return parts.length > 1 && parts.every((p) => p.trim().split(/\s+/).length >= 3) ? parts : [piece];
  }

  const tidy = (s) => String(s).replace(/\s+/g, ' ').trim()
    .replace(/^(?:[-*•·]|\d{1,2}[.)])\s*/, '')
    .replace(/^(?:and|also|then|plus|and also)\b[\s,]*/i, '')
    .replace(/[\s,;:.]+$/, '');

  /**
   * The asks in `request`, in the person's words, or [] when there are
   * fewer than three: a request of one or two parts is its own checklist.
   */
  function split(request) {
    let text = String(request == null ? '' : request);
    if (!text.trim() || text.length > LONGEST_REQUEST) return [];
    const F = window.HCFences;   // code is not split into asks (js/fences.js)
    if (F && F.splitFences) text = F.splitFences(text).map((p) => (p.type === 'code' ? '\n' : p.text)).join('');
    const pieces = [];
    for (const line of text.split(/\r?\n/)) {
      // Items numbered on one line, then sentences.
      const sentences = line.replace(/\s(?=\d{1,2}[.)]\s)/g, '\n').replace(/([.!?])\s+(?=[A-Za-z])/g, '$1\n').split('\n');
      for (const sentence of sentences) {
        let parts = [sentence];
        for (const join of JOINS) parts = parts.flatMap((p) => p.split(join));
        parts = parts.flatMap(andVerb);
        pieces.push(...parts);
      }
    }
    const seen = new Set();
    const asks = [];
    for (const raw of pieces) {
      const ask = tidy(raw);
      if (ask.split(' ').length < 2 || !(ASKING.test(ask) || QUESTION.test(ask))) continue;
      const key = ask.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      asks.push(ask.length > LONGEST_ASK ? `${ask.slice(0, LONGEST_ASK - 1)}…` : ask);
      if (asks.length === MOST_ASKS) break;
    }
    return asks.length >= MIN_ASKS ? asks : [];
  }

  /** The asks as a numbered list: "1. fix the menu". */
  const numbered = (asks) => (asks || []).map((a, i) => `${i + 1}. ${a}`).join('\n');

  /** What goes with the request when it has several asks, or ''. */
  function checklist(asks) {
    if (!Array.isArray(asks) || asks.length < MIN_ASKS) return '';
    return `The request has ${asks.length} separate asks, in the person's words. Do every one of them:\n${numbered(asks)}`;
  }

  window.HCCodeAsks = { MIN_ASKS, MOST_ASKS, LONGEST_REQUEST, split, numbered, checklist };
})();
