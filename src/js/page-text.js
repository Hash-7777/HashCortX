// ==============================================================
// Turning a fetched web page into something a model can read
//
// THE LIMIT THIS REPLACES
// -----------------------
// A fetched page was stripped of its markup and then cut to 3,000 characters
// — roughly the first two or three paragraphs. That was the real ceiling on
// the fetch tool, far below anything else in the way: the request itself
// allows a megabyte, and the agent's whole prompt has a 60,000-character
// budget for tool output that is spent newest-first, so a page arriving whole
// was never the thing that would overflow it.
//
// The effect was quiet in the way that matters. The model was handed the top
// of a documentation page, with nothing saying more existed, and answered
// from it — so a fetch that had genuinely retrieved the whole page produced
// an answer based on its introduction.
//
// WHAT REPLACES IT
// ----------------
// A window over the full text, with the model told when there is more and
// where to continue from. It reads a useful amount by default and can ask for
// the next part of a long page instead of guessing at it.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCPageText.
// Checked by scripts/checks/page-text.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * How much of a page the model is given per read.
   *
   * A quarter of the prompt's tool budget, which leaves room for the rest of
   * a run while being enough for most of an ordinary article or reference
   * page. Long pages are not cut off silently — the reply says how much is
   * left and how to ask for it.
   */
  const DEFAULT_LIMIT = 15000;

  /** What a page fetched automatically contributes, rather than on request. */
  const PASSIVE_LIMIT = 6000;

  /**
   * Markup out, readable text in.
   *
   * Script and style elements go first, contents and all: their text is code,
   * and stripping only the tags would leave the model reading a stylesheet as
   * prose. Then tags, then runs of whitespace, which the removals create
   * plenty of.
   */
  function stripHtml(raw) {
    return String(raw || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A readable slice of `text`, and what is needed to continue past it.
   *
   * `nextOffset` is null when the window reaches the end, so "is there more"
   * is one check rather than arithmetic the caller has to get right.
   *
   * Both arguments come from a model, so neither is trusted: a negative,
   * fractional, absent or wildly out-of-range value lands somewhere sensible
   * rather than producing an empty window that reads as an empty page.
   */
  function windowOf(text, offset, limit) {
    const full = String(text || '');
    const size = Math.floor(Number(limit)) > 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;
    const from = Math.min(Math.max(Math.floor(Number(offset)) || 0, 0), full.length);
    const to = Math.min(full.length, from + size);
    return {
      text: full.slice(from, to),
      offset: from,
      nextOffset: to < full.length ? to : null,
      total: full.length,
      truncated: to < full.length,
    };
  }

  /**
   * The sentence the model is given alongside a cut page.
   *
   * Written as an instruction rather than a statistic. "3000 of 84000
   * characters" tells a model a number; being told it is reading part of a
   * page and exactly how to get the next part is what stops it answering
   * from an introduction as though it had read the whole thing.
   */
  function continuationNote(win, url) {
    if (!win || !win.truncated) return '';
    const shown = win.offset + win.text.length;
    return (
      `\n\n[This is characters ${win.offset}–${shown} of ${win.total}. ` +
      `The page continues. To read on, call fetch_url again with url "${url}" ` +
      `and offset ${win.nextOffset}. Do not answer as if you had read the whole ` +
      `page until you have.]`
    );
  }

  /**
   * Sites that show their pages only to someone signed in, and turn an app
   * away. Reading one is not tried around: the note says what is true and
   * the two honest ways to the same facts.
   */
  const SIGNED_IN = [
    { host: /(^|\.)linkedin\.com$/i, name: 'This site', save: ' (on a profile there: its More button, then Save to PDF)' },
    { host: /(^|\.)(facebook|instagram|threads)\.(com|net)$/i, name: 'This site', save: '' },
    { host: /(^|\.)(x|twitter|tiktok)\.com$/i, name: 'This site', save: '' },
  ];

  /**
   * What a model is told when a page could not be read: the reason the
   * fetch gave (`refusal` { refused, status }), and for a site that shows
   * pages only to someone signed in, what to do instead. Never a guess at
   * what the page says.
   */
  function unreadNote(url, refusal) {
    let host = '';
    try { host = new URL(String(url)).hostname; } catch { /* not an address */ }
    const wall = SIGNED_IN.find((w) => w.host.test(host));
    if (wall) {
      return `${url} could not be read: ${wall.name} shows its pages only to people signed in, and turns an app away. Do not guess what it says. ` +
        `Search the web for the name and words from the address: a result may carry a public summary of it; say it is a summary, and use it only when the result's address is this one. ` +
        `Then ask the person to attach the page as a PDF${wall.save} or as screenshots, and work from what they attach.`;
    }
    const why = refusal && refusal.refused ? ` The site's answer: ${String(refusal.refused).replace(/\s+/g, ' ').slice(0, 160)}` : '';
    return `${url} could not be read: it may not exist, may refuse to be read by an app, or may not be a web page.${why} Try the site's home page, or another result.`;
  }

  window.HCPageText = { stripHtml, windowOf, continuationNote, unreadNote, SIGNED_IN, DEFAULT_LIMIT, PASSIVE_LIMIT };
})();
