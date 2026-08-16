// ==============================================================
// Reading a PDF as text
//
// The app could already do this for a file you attached to a chat. The coding
// agent could not: `read_file` answers for a PDF with a sentence saying it is
// a PDF, because the bytes are not text and returning them as lossy UTF-8
// would hand the model a screenful of noise. So the agent could see that a
// PDF existed, know its size, and never read a word of it.
//
// The extraction is the same work in both cases, so it lives here once rather
// than twice. app.js hands it a File; the agent hands it bytes read from disk.
//
// pdf.js is vendored (js/vendor/pdf.min.js) and loads as a plain script, so it
// arrives on `window` whenever it arrives — hence the wait rather than an
// import. Nothing here reaches the network.
//
// Published as window.HCPdfText. Checked by scripts/checks/pdf-text.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Pages read from one document.
   *
   * A cap, because a long PDF is not a reason to build a prompt nothing can
   * answer. What is dropped is stated in the returned text rather than left
   * for the model to notice, so it can say the document was longer instead of
   * answering as though it had read all of it.
   */
  const MAX_PAGES = 120;

  /** Base64 from Rust back into the bytes pdf.js wants. */
  function base64ToBytes(base64) {
    const binary = atob(String(base64 || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function waitForPdfJs(timeoutMs = 6000) {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        if (Date.now() - started >= timeoutMs) {
          return reject(new Error('pdf.js did not finish loading'));
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  /**
   * Join one page's text items.
   *
   * pdf.js returns positioned fragments, not lines, so nothing separates the
   * end of one from the start of the next. Joined with nothing they run words
   * together; joined with a space they read as prose. `hasEOL` marks a
   * fragment that ended a line, and honouring it keeps a table or a code block
   * from collapsing onto one line.
   */
  function pageToText(items) {
    let out = '';
    for (const item of items || []) {
      if (!item || typeof item.str !== 'string') continue;
      out += item.str;
      out += item.hasEOL ? '\n' : ' ';
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  /** The message for a PDF that holds no selectable text at all. */
  function noTextNote(label, pages) {
    return `[PDF: ${label} · ${pages} page${pages === 1 ? '' : 's'} — no selectable text. ` +
      `This is almost certainly a scanned or image-only document, so the words are ` +
      `pixels and reading it needs OCR. Say so rather than guessing at its contents.]`;
  }

  /**
   * Extract the text of a PDF.
   *
   * `data` is anything pdf.js accepts — a Uint8Array or an ArrayBuffer.
   * Returns `extracted: false` when there was nothing to read, with `text`
   * already set to a sentence explaining why, so a caller can pass it straight
   * to a model without having to phrase the failure itself.
   */
  async function extractFromData(data, label = 'document.pdf') {
    const pdfjs = await waitForPdfJs();
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages = doc.numPages;
    const readable = Math.min(pages, MAX_PAGES);

    const chunks = [];
    for (let i = 1; i <= readable; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      chunks.push(`--- Page ${i} ---\n${pageToText(content.items)}`);
    }

    const body = chunks.join('\n\n').trim();
    if (!body.replace(/--- Page \d+ ---/g, '').trim()) {
      return { text: noTextNote(label, pages), pages, extracted: false };
    }
    const dropped = pages > readable
      ? `\n\n[… ${pages - readable} further page${pages - readable === 1 ? '' : 's'} not read. ` +
        `Say the document is longer than what you have seen.]`
      : '';
    return { text: body + dropped, pages, extracted: true };
  }

  /** The same, starting from base64 as Rust returns it. */
  async function extractFromBase64(base64, label) {
    return extractFromData(base64ToBytes(base64), label);
  }

  window.HCPdfText = {
    extractFromData, extractFromBase64, base64ToBytes,
    pageToText, noTextNote, MAX_PAGES,
  };
})();
