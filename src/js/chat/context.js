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
   * What to call a conversation, from the first thing that was said in it.
   *
   * Three words, because the list it appears in is narrow and a title that is
   * cut off mid-word by the column reads worse than one that was short on
   * purpose.
   */
  function deriveTitle(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const first = list.find((m) => m && m.role === "user" && m.content);
    if (!first) return "New chat";
    const words = String(first.content).trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
    if (!words.length) return "New chat";
    return words.length > 3 ? `${words.slice(0, 3).join(" ")}…` : words.join(" ");
  }

  window.HCChatContext = { buildAttachedFileContext, estimatePromptTokens, deriveTitle, MIN_PER_FILE };
})();
