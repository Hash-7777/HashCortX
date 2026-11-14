// ============================================================
// chat/context.js — what the model is told, and what that costs
//
// Three small things that decide what actually reaches a model and what a
// person is shown about it: how attached files are packed into a message, how
// large the whole thing is reckoned to be, and what a conversation ends up
// called. All three sat in a seven-thousand-line file where nothing could hand
// them an input and ask what came out.
//
// THE BUDGET WAS NOT A BUDGET. Attachments were given a slice each of a
// character allowance, with a floor underneath so that a slice never became
// too small to be worth sending. But the floor won: past about fifteen files
// every one of them got the floor, and the total went straight through the
// allowance — a hundred attachments sent a hundred and eighty thousand
// characters against a budget of twenty-eight thousand. Six times over, with
// nothing said, which on many models is a refused request and on all of them
// is somebody's money.
//
// The floor was right and the consequence was wrong. Too many files now means
// FEWER FILES, not a larger message, and the ones left out are named as left
// out — a model told nothing about the file it was not given will answer about
// the ones it was as though that were all of them.
//
// Pure: values in, strings and numbers out. No DOM, no storage, no network.
//
// Run the checks with: npm run check:chat-context
// ============================================================
(function () {
  "use strict";

  // Below this a slice of a file is not worth sending: a page and a half of a
  // document tells a model almost nothing and costs almost as much as a
  // useful amount would.
  const MIN_PER_FILE = 1800;

  /**
   * The attached files, as text to put in front of a model.
   *
   * Every file that is sent says how much of it was sent, and every file that
   * was not sent is named. Silence about either is the failure worth avoiding:
   * a model that is not told a file was cut short will reason confidently
   * about the part it was given.
   */
  function buildAttachedFileContext(files, maxChars = 28000) {
    const list = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!list.length) return "";

    // How many fit at a slice worth having. At least one, always: a single
    // enormous attachment is cut down rather than dropped, because dropping
    // the only file somebody attached is never the answer they wanted.
    const budget = Math.max(MIN_PER_FILE, Number(maxChars) || 0);
    const room = Math.max(1, Math.floor(budget / MIN_PER_FILE));
    const sent = list.slice(0, room);
    const skipped = list.length - sent.length;
    const perFile = Math.max(MIN_PER_FILE, Math.floor(budget / sent.length));

    const sections = sent.map((f, i) => {
      const raw = String(f.text || "").trim() || "[No extracted text available for this attachment.]";
      const clipped = raw.length > perFile;
      const text = clipped
        ? `${raw.slice(0, perFile)}\n\n[Attachment truncated for context: ${raw.length - perFile} chars omitted.]`
        : raw;
      const meta = [
        `name: ${f.name || `attachment-${i + 1}`}`,
        `kind: ${f.kind || "file"}`,
        f.pages ? `pages: ${f.pages}` : "",
        `extracted_chars: ${raw.length}`,
        clipped ? `sent_chars: ${perFile}` : "",
      ].filter(Boolean).join(", ");
      return `--- Attachment ${i + 1} (${meta}) ---\n${text}`;
    });

    const left = skipped
      ? [`[${skipped} further attachment${skipped === 1 ? " was" : "s were"} not included: `
        + `${list.slice(room).map((f, i) => f.name || `attachment-${room + i + 1}`).join(", ")}. `
        + `Say so if the answer depends on them.]`]
      : [];

    return [
      "",
      "[ATTACHED FILES - use this content when answering]",
      "The user attached the following file text. Treat it as part of the current user message.",
      sections.join("\n\n"),
      ...left,
      "[END ATTACHED FILES]",
    ].join("\n");
  }

  /**
   * Roughly how many tokens a conversation will cost.
   *
   * Characters divided by a constant, which is what an estimate is. It is
   * shown to a person as a guide to whether they are near a limit, never used
   * to decide anything — a real count only exists after the provider has
   * answered, and by then the cost is already spent.
   *
   * Images are counted as their mention rather than their bytes, because what
   * an image costs differs per provider by more than this estimate is worth.
   */
  function estimatePromptTokens(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const chars = JSON.stringify(list.map((m) => ({
      role: m && m.role,
      content: (m && m.content) || "",
      images: m && m.images ? `[${m.images.length} image(s)]` : undefined,
    }))).length;
    return Math.ceil(chars / 3.8);
  }

  /**
   * What to call a conversation, from the first thing that was said in it,
   * until its model names it (js/chat/title.js).
   *
   * Five words at most, the asking words at the start left out ("can you",
   * "tell me about"), a link named by its site rather than spelled out, and
   * no closing question mark: what is left is the subject. The list it
   * appears in is narrow, so a long title is cut on purpose rather than by
   * the column.
   */
  /** A message's own words: after a starter prompt's "My question:", or all of it. */
  const ownWords = (text) => String(text || "").trim().split(/\n\s*(?:My question|The problem|Here it is):[ \t]*\n/i).pop().trim();
  const ASKING = /^(?:(?:hi|hey|hello|ok|okay|so)[,!.]\s*|please\s+|(?:can|could|would|will) you\s+(?:please\s+)?|i(?: would like| want| need)(?: you)? to\s+|help me(?: to)?\s+|tell me(?: about)?\s+|explain\s+|what(?:'s| does| do| is| are| was| were)\s+|how (?:do|can|should) i\s+|how to\s+)/i;
  const TITLE_WORDS = 5;
  function deriveTitle(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const first = list.find((m) => m && m.role === "user" && m.content);
    if (!first) return "New chat";
    // A chat started from a starter prompt opens with the same instructions
    // each time, so every one was titled "Look this up…"; its title is the
    // person's own words, after the prompt's "My question:".
    const text = String(first.content).trim();
    const own = ownWords(text);
    // A link is its site: the rest of an address says nothing to a reader.
    const plain = (own || text).replace(/https?:\/\/(?:www\.)?([^\s/?#]+)\S*/gi, "$1").replace(/\s+/g, " ").trim();
    let subject = plain;
    for (let i = 0; i < 4; i++) { const next = subject.replace(ASKING, ""); if (next === subject) break; subject = next; }
    subject = subject.replace(/[\s,;:]*\b(?:please|thanks|thank you)[.!]?$/i, "");
    // Asking words and nothing else stay as they were said.
    const words = (subject.trim() || plain).split(" ").filter(Boolean);
    if (!words.length) return "New chat";
    const cut = words.length > TITLE_WORDS;
    const kept = words.slice(0, TITLE_WORDS);
    kept[kept.length - 1] = kept[kept.length - 1].replace(/[?!.,;:]+$/, "") || kept[kept.length - 1];
    if (/^[a-z][a-z'-]*$/.test(kept[0])) kept[0] = kept[0][0].toUpperCase() + kept[0].slice(1);
    return kept.join(" ") + (cut ? "…" : "");
  }

  // A plain chat has no tools, and a model asked to search the web answered
  // as though it had, with a result and a date it made up. It is told what it
  // cannot do here, and what the person can turn on that can.
  const PLAIN_CHAT_RULE = 'This conversation has no tools: you cannot search the web or run code in it, and a web page reaches you only when the person links it and it could be read. Never say you are searching, browsing or running anything, and never give a result you did not receive. When asked to search, or for anything current, say that this chat cannot look it up, and that the "Look it up" button turns on an agent that can.';

  window.HCChatContext = { buildAttachedFileContext, estimatePromptTokens, deriveTitle, ownWords, MIN_PER_FILE, PLAIN_CHAT_RULE };
})();
