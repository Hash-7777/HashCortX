// ============================================================
// chat/intent.js — which tool a request plainly needs, decided by the app
//
// A small local model decides badly whether a request needs a tool, and how
// badly depends on the words it is asked with: reworded to stop one model
// searching the web for a haiku, the instruction made another run Python to
// write an email. Some requests leave no room for doubt, and for those the
// app does not ask:
//
//   a web address to read                  fetch_url, with that address
//   code to run, or a file or chart        execute_python
//   the date, the time, the day            current_datetime, and the place
//                                          it was asked about
//   a search, or anything current          web_search
//   a request to write, explain or plan    no tool
//   arithmetic                             calculate
//   a poem, an email, a story              no tool
//
// in that order, so "the date in New York right now" is the clock before it
// is a search, "summarise today's news" is a search before it is writing,
// and an email about a 20% rise is writing, not a sum. What the
// tool is given is still the model's to write, held to that tool's own
// argument schema — except a web address, which the app takes from the
// message itself. Anything else is left to the model's own
// decision. Only English phrasing is recognised; a request in any other
// language goes to the model, as every request did before.
//
// Pure. Published as window.HCIntent. Checked by scripts/checks/intent.mjs.
// ============================================================
(function () {
  "use strict";

  const URL_RX = /\bhttps?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/i;

  const CODE = /\b(?:(?:run|use|using|with|in) python|python (?:to|and) (?:compute|calculate|work out|count|find|make|build|draw|plot)|run (?:it|this|that|the|some|my)? ?(?:code|script)|execute (?:it|this|the code|the script)|spreadsheet|excel|xlsx|csv|docx|word document|pdf file|make (?:me )?(?:a |an )?(?:file|chart|graph|plot)|(?:draw|plot|graph|chart) (?:a|an|the|me)\b|(?:bar|pie|line) chart|save (?:it )?as (?:a )?(?:png|pdf|csv|file))/i;
  const SEARCH = /^(?:please\s+|can you\s+|could you\s+)?(?:search|look up|google|find out)\b|\bsearch (?:the web|online|the internet)\b/i;
  const CURRENT = /\b(?:latest|newest|current(?:ly)?|right now|today'?s? (?:news|price|weather|score|headlines)|this (?:week|month|year)|recent(?:ly)?|news|headlines|weather|forecast|stock price|share price|exchange rate|price of|how much (?:is|does|do) .{1,40}\bcost|who won|who is (?:the )?(?:current|new)|score of|release date|still (?:alive|open|available))\b/i;
  const TIME = /\b(?:what (?:day|date|time|year|month) (?:is it|is today|it is)|what(?:'s| is) (?:the )?(?:date|time|day)(?: today| now| of the week)?|day of the week|today'?s date|the time (?:now|in)|time is it|what time)\b/i;
  const MATH_WORD = /\b(?:percent(?:age)?|times|divided by|multiplied by|plus|minus|squared|cubed|square root|to the power|factorial|average of|sum of|product of|how many (?:days|hours|minutes|weeks) (?:are there )?(?:between|until|from))\b/i;
  // Numbers joined by an operator. A dash or slash counts only with spaces
  // around it, so a range, a date or a size is not a sum.
  const MATH_SIGN = /\d\s*(?:[+*^×÷]|\*\*)\s*\(?\d|\d\s+[-/]\s+\(?\d|\d\s*%\s*(?:of\b|[-+*/])/i;
  const ASK_TO_WRITE = /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:write|rewrite|re-write|draft|compose|translate|summari[sz]e|paraphrase|proofread|edit|polish|improve|shorten|expand|explain|describe|define|brainstorm|outline|suggest|recommend|give me (?:a |an |some )?(?:[\w-]+ )?(?:plan|list|ideas?|outline|examples?|tips|steps|names|reasons)|tell me (?:a|about)|make (?:it|this) (?:more|less|shorter|longer))\b/i;
  const WRITTEN_THING = /\b(?:haiku|poem|limerick|story|essay|cover letter|email|slogan|tagline|joke|lyrics|speech|toast)\b/i;

  /** How many separate numbers a text holds. */
  const numbers = (t) => (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).length;

  /**
   * The step a request plainly needs, or null when it is not plain:
   *   { tool: "none" }                          answer without a tool
   *   { tool, arguments }                       run this, as it is
   *   { tool }                                  this tool; the model writes its arguments
   * `names` are the tools the agent has; a tool it lacks is never chosen.
   */
  function route(text, names) {
    const t = String(text || "").trim();
    const has = new Set(names || []);
    if (!t) return null;
    const url = URL_RX.exec(t);
    if (url && has.has("fetch_url") && !/\bsearch\b/i.test(t)) return { tool: "fetch_url", arguments: { url: url[0] } };
    if (CODE.test(t) && has.has("execute_python")) return { tool: "execute_python" };
    if (TIME.test(t) && has.has("current_datetime")) {
      const place = /\bin\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/.exec(t);
      return { tool: "current_datetime", arguments: place ? { place: place[1] } : {} };
    }
    if ((SEARCH.test(t) || CURRENT.test(t)) && has.has("web_search")) return { tool: "web_search" };
    if (ASK_TO_WRITE.test(t)) return { tool: "none" };
    if ((MATH_SIGN.test(t) || (MATH_WORD.test(t) && numbers(t) >= 1)) && has.has("calculate")) return { tool: "calculate" };
    if (WRITTEN_THING.test(t)) return { tool: "none" };
    return null;
  }

  window.HCIntent = { route };
})();
