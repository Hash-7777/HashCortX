// ==============================================================
// Editing a file in place — the text work behind patch_file
//
// patch_file replaces one exact passage of a file with another and writes the
// file back. Three things decide whether that leaves the rest of the file as
// it was, and all three live here, where they can be checked:
//
//   · It starts from the file's real contents. What read_file hands the model
//     is for reading: a long file is cut at 100,000 characters with a note on
//     the end, and a binary file becomes a sentence describing it. Patched and
//     written back, either one would replace the file with that.
//   · The replacement goes in exactly as written. String.prototype.replace
//     reads $$, $& and $` in a replacement string as instructions, so code
//     containing them would be saved as something else.
//   · Line endings stay as they were. In a file written with CRLF, a search
//     written with LF is matched in its CRLF form, rather than the whole file
//     being rewritten with LF.
//
// Pure: takes strings and bytes, returns strings. No DOM, no storage.
//
// Loaded before the Coder mode and published as window.HCCodePatch.
// Checked by scripts/checks/code-patch.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many times `needle` occurs in `hay`, not overlapping. */
  function count(hay, needle) {
    if (!needle) return 0;
    let n = 0;
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
    return n;
  }

  /** `hay` with its first `needle` replaced by `text`, taken literally. */
  function spliceOnce(hay, needle, text) {
    const i = hay.indexOf(needle);
    return hay.slice(0, i) + text + hay.slice(i + needle.length);
  }

  /** Bytes from base64, as fs_read_base64 sends them. */
  function bytesFromBase64(b64) {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * A file's bytes as text, or an error saying why it cannot be patched.
   *
   * Only UTF-8 text is edited. Anything else would be decoded with its
   * unreadable characters replaced and written back that way, changing parts
   * of the file the patch never touched. A byte-order mark is kept, so it is
   * written back too.
   */
  function textOf(bytes, name) {
    if (bytes.includes(0)) {
      throw new Error(`"${name}" is not a text file, so it cannot be patched.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`"${name}" is not UTF-8 text, so patching it would change characters outside the edit. ` +
        'Leave it, or rewrite it whole with write_file if that is what is wanted.');
    }
  }

  /**
   * `content` with its one occurrence of `search` replaced by `replace`.
   *
   * Tried as written first; then, in a file with CRLF endings, with the
   * search in CRLF form; then with every line ending compared as LF, which is
   * only reached in a file that mixes the two, and writes that file with LF.
   * Throws a message the model can act on when the passage is missing or is
   * not unique.
   */
  function applyPatch(content, search, replace, name) {
    const unique = (text, find, repl, how) => {
      const n = count(text, find);
      if (n === 1) return spliceOnce(text, find, repl);
      if (n > 1) throw new Error(`search string found ${n} times in "${name}"${how}. Add more surrounding lines to make it unique.`);
      return null;
    };
    let out = unique(content, search, replace, '');
    if (out != null) return out;
    if (content.includes('\r\n')) {
      const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
      out = unique(content, crlf(search), crlf(replace), ' with its line endings matched');
      if (out != null) return out;
    }
    const lf = (s) => s.replace(/\r\n?/g, '\n');
    out = unique(lf(content), lf(search), lf(replace), ' with line endings ignored');
    if (out != null) return out;
    throw new Error(
      `search string not found in "${name}".\n` +
      `File begins with:\n${content.slice(0, 600)}\n\n` +
      'Re-read the file with read_file, copy the exact text you want to replace ' +
      '(preserving every space and indent), then retry.'
    );
  }

  window.HCCodePatch = { applyPatch, textOf, bytesFromBase64, count };
})();
