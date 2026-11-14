// ==============================================================
// What a chat agent's answer is held to before it is shown
//
// On the shared loop (js/agent-loop.js) a run ends when the model answers
// in words, unless a finishing check finds something to send it back for.
// HashCoder's checks are about files, tests and sites. A chat agent changes
// none of those, so its answer gets the three that fit a chat:
//
//   · the request's asks: a question of several parts whose answer leaves
//     some out is sent back once with the missing parts restated;
//   · a search it says it made: an answer that says it searched or read a
//     site, when no search or page read ran, is sent back once
//     (js/code/verify.js claimNote);
//   · details nothing read says: an address, a phone number, an email,
//     opening hours or a year (js/code/facts.js), or a paper cited by its
//     PMID, DOI, PMC or arXiv number, that neither the person nor anything
//     the agent's tools returned gives is sent back once to be found, taken
//     out or said to be unconfirmed, and what is still unconfirmed is said
//     under the answer. An agent that may answer from what it knows has
//     its details held to a source only once it has searched or read
//     something; a paper it cites, always.
//
// Each reads the app's record of the run, never the agent's word for it.
//
// Pure. Published as window.HCChatFinish. Checked by scripts/checks/chat-finish.mjs.
// ==============================================================
(function () {
  'use strict';

  const ASKS_STEP = 'Sent back: parts of the question the answer does not cover';
  const FACTS_STEP = 'Sent back: details nothing given or read says';
  const asking = (reply) => /\?\s*$/.test(String(reply || '').trim());

  /** Words that ask, rather than say what is asked about. */
  const QUESTION = new Set(['what', 'when', 'where', 'which', 'whose', 'does', 'did', 'could', 'would', 'should', 'there', 'tell', 'please', 'with', 'that', 'this', 'from', 'about', 'have', 'into']);
  const keyOf = (w) => w.slice(0, 5);
  const wordsOf = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !QUESTION.has(w));
  /**
   * Whether an answer covers an ask: most of the ask's words, each matched by
   * its start, so "costs" covers "cost" and "families" covers "family". An
   * answer says a thing in its own words, which the brief's stricter test
   * (every word, exactly) does not allow for.
   */
  function covers(reply, ask) {
    const want = [...new Set(wordsOf(ask).map(keyOf))];
    if (!want.length) return true;
    const said = wordsOf(reply);
    const hits = want.filter((k) => said.some((w) => w.startsWith(k))).length;
    return want.length <= 2 ? hits === want.length : hits >= Math.ceil(want.length * 0.6);
  }

  // ── A paper cited that nothing found ─────────────────────────────────
  //
  // A paper named by its identifier reads as checked, and a made-up one
  // looks exactly like a real one. A PMID, a DOI, a PMC number or an arXiv
  // number in the answer is looked for in what the person gave and what the
  // agent's tools returned; one found in neither is a detail nothing gave,
  // sent back with the others. The app's own notes and the agent's earlier
  // answers are not sources.
  const CITE_FORMS = [
    { re: /\bPMID\s*:?\s*#?\s*(\d{4,9})\b/gi, kind: 'pmid' },
    { re: /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})/gi, kind: 'pmid' },
    { re: /\b(10\.\d{4,9}\/[^\s"'<>]+)/g, kind: 'doi' },
    { re: /\bPMC\s?(\d{4,9})\b/g, kind: 'pmc' },
    { re: /\barxiv\s*:\s*(\d{4}\.\d{4,5})/gi, kind: 'arxiv' },
    { re: /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/gi, kind: 'arxiv' },
  ];
  /** A DOI as written, without the punctuation of the sentence around it. */
  const doiOf = (raw) => {
    let d = String(raw).replace(/[.,;:]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']']]) while (d.endsWith(close) && d.split(close).length > d.split(open).length) d = d.slice(0, -1).replace(/[.,;:]+$/, '');
    return d.toLowerCase();
  };
  const SHOWN = { pmid: (v) => `PMID ${v}`, doi: (v) => `DOI ${v}`, pmc: (v) => `PMC${v}`, arxiv: (v) => `arXiv ${v}` };

  /** The papers an answer names by identifier, outside its code blocks, each once, in order. */
  function citesIn(reply) {
    const H = window.HCFences;
    const prose = H && H.splitFences ? H.splitFences(String(reply || '')).filter((p) => p.type !== 'code').map((p) => p.text).join('\n') : String(reply || '');
    const hits = [];
    for (const f of CITE_FORMS) for (const m of prose.matchAll(f.re)) hits.push({ at: m.index, kind: f.kind, value: f.kind === 'doi' ? doiOf(m[1]) : m[1] });
    const seen = new Set();
    return hits.sort((a, b) => a.at - b.at).filter((h) => !seen.has(`${h.kind}:${h.value}`) && seen.add(`${h.kind}:${h.value}`))
      .map((h) => ({ kind: h.kind, value: h.value, shown: SHOWN[h.kind](h.value) }));
  }

  /** What the person gave and the tools returned, as one text to look in: not the app's notes, not the agent's answers. */
  function sourceText(messages) {
    const V = window.HCCodeVerify;
    const note = (m) => !!m.note || !!(V && V.isAppNote && V.isAppNote(m.content));
    return (Array.isArray(messages) ? messages : [])
      .filter((m) => m && (m.role === 'tool' || m.role === 'system' || (m.role === 'user' && !note(m))))
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''))).join('\n').toLowerCase();
  }

  /** The papers an answer cites that nothing the person gave or a tool returned names, as details for the list. */
  function unreadCites(reply, messages) {
    const cites = citesIn(reply);
    if (!cites.length) return [];
    const text = sourceText(messages);
    const has = (c) => (c.kind === 'doi' || c.kind === 'arxiv' ? text.includes(c.value)
      : new RegExp(`${c.kind === 'pmc' ? 'pmc\\s?' : '(?:^|\\D)'}${c.value}(?!\\d)`).test(text));
    return cites.filter((c) => !has(c)).map((c) => ({ path: 'answer.md', kind: 'cite', shown: c.shown }));
  }

  /**
   * The finishing checks of one chat run, as the shared loop takes them:
   * { finish, left, wrap }. `messages` the run's conversation (read as it
   * grows), `sent` how often the run was sent back for each reason,
   * `request` the person's request with what they added while it worked,
   * `knowledge` true for an agent that may answer from what it knows: its
   * details are held to what it found only once it has searched or read
   * something; a paper it cites, always.
   */
  function checks({ messages, sent, request, knowledge = false } = {}) {
    const V = window.HCCodeVerify, A = window.HCCodeAsks, Fa = window.HCCodeFacts;
    const s = sent || {};
    const note = (V && V.APP_NOTE) || 'Note from HashCortX, not from the person:';
    let found = null;

    const asksLook = async (reply) => {
      if ((s.asks || 0) >= 1 || !A || asking(reply)) return null;
      const asks = A.split(String(request || ''));   // nothing for a request of fewer than three asks (js/code/asks.js)
      if (!Array.isArray(asks) || !asks.length) return null;
      const open = asks.filter((a) => !covers(reply, a));
      if (!open.length) return null;
      return { kind: 'asks', step: ASKS_STEP,
        message: `${note} before you finish, your answer does not seem to cover every part of the question. Answer each of these, using your tools where a fact is needed, or say plainly why one cannot be answered:\n${open.map((a, i) => `${i + 1}. ${a}`).join('\n')}` };
    };

    const claimLook = async (reply) => (V && V.claimNote ? V.claimNote(reply, messages, s.claim || 0) : null);

    const factsLook = async (reply) => {
      const looked = !knowledge || !V || !V.searchedSince || V.searchedSince(messages);
      const seen = Fa && looked ? Fa.check({ files: [{ path: 'answer.md', text: String(reply || '') }], messages }) : { unsourced: [] };
      const unsourced = [...seen.unsourced, ...unreadCites(reply, messages)];   // a paper cited that nothing found is one more
      found = unsourced.length ? { unsourced } : null;   // square brackets in a chat answer are links, not unfinished text
      if (!found || (s.facts || 0) >= 1) return null;
      return { kind: 'facts', step: FACTS_STEP,
        message: `${note} your answer states details that nothing the person gave or you read says: ${Fa ? Fa.listOf(found.unsourced) : found.unsourced.map((x) => x.shown).join(', ')}. Find each with your tools, take it out, or say plainly that it is not confirmed.` };
    };

    return {
      finish: [{ id: 'asks', words: true, run: asksLook }, { id: 'claim', words: true, run: claimLook }, { id: 'facts', words: true, run: factsLook }],
      // The loop's own lines are about pages and files; the chat says what is left in its own words (leftLine).
      left: () => ({ unconfirmed: null, gone: null, outside: null, found }),
      wrap: async () => null,
    };
  }

  /** What is said under a chat answer about details still unconfirmed, or ''. */
  function leftLine(found) {
    const Fa = window.HCCodeFacts;
    if (!found || !Array.isArray(found.unsourced) || !found.unsourced.length) return '';
    return `Not confirmed by anything you gave or the agent read: ${Fa ? Fa.listOf(found.unsourced) : found.unsourced.map((x) => x.shown).join(', ')}. Check before relying on ${found.unsourced.length === 1 ? 'it' : 'them'}.`;
  }

  window.HCChatFinish = { ASKS_STEP, FACTS_STEP, covers, citesIn, unreadCites, checks, leftLine };
})();
