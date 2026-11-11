// ==============================================================
// Hidden characters: found, taken out, or shown as codes
//
// Some characters draw nothing at all and are still read by a model: the
// tag block, which can spell out a whole sentence no one can see; the
// supplementary variation selectors; the marks that turn text the other way;
// the zero-width ones; the soft hyphen. A page, a search result or a
// connected system's tool can carry words a person never sees and a model
// takes as written, and a permission question can show one thing while the
// command holds another.
//
// So there are three answers. Material a model reads that is not a project
// file has them taken out (`strip`), with a line saying how many (`note`). A
// project file keeps its exact text, and the kinds that can change what it
// means are shown as codes (`reveal`), which `unreveal` turns back into the
// characters when a change is matched against the file. What the person is
// asked about is shown with codes too.
//
// What a script needs is never touched: the non-joiner and joiner that
// Arabic, Persian and Indic writing and joined marks use, the two direction
// marks, the ordinary variation selector, and a byte-order mark at the very
// start of a text.
//
// Pure. Published as window.HCTextSafety. Checked by scripts/checks/text-safety.mjs.
// ==============================================================
(function () {
  "use strict";

  /** The characters that are hidden, each range with its kind. */
  const HIDDEN = [
    [0xE0000, 0xE007F, "tag"],
    [0xE0100, 0xE01EF, "selector"],
    [0x202A, 0x202E, "direction"],
    [0x2066, 0x2069, "direction"],
    [0x200B, 0x200B, "zero-width"],
    [0x2060, 0x2064, "zero-width"],
    [0xFEFF, 0xFEFF, "zero-width"],
    [0x00AD, 0x00AD, "soft-hyphen"],
    [0x180E, 0x180E, "zero-width"],
  ];

  const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  const ANY = new RegExp(`[${HIDDEN.map(([a, b]) => (a === b ? `\\u{${hex(a)}}` : `\\u{${hex(a)}}-\\u{${hex(b)}}`)).join("")}]`, "gu");
  const kindOf = (cp) => { for (const [a, b, k] of HIDDEN) if (cp >= a && cp <= b) return k; return ""; };
  /** A byte-order mark at the very start of a text belongs to the file, not to its words. */
  const kept = (offset, cp) => offset === 0 && cp === 0xFEFF;
  const asText = (t) => (t == null ? "" : String(t));

  /** How many hidden characters `text` holds, of which kinds, and on which lines (from 1). */
  function scan(text) {
    const t = asText(text);
    const kinds = {};
    const lines = [];
    let count = 0;
    ANY.lastIndex = 0;
    for (const m of t.matchAll(ANY)) {
      const cp = m[0].codePointAt(0);
      if (kept(m.index, cp)) continue;
      count++;
      const k = kindOf(cp);
      kinds[k] = (kinds[k] || 0) + 1;
      const line = t.slice(0, m.index).split("\n").length;
      if (lines[lines.length - 1] !== line) lines.push(line);
    }
    return { count, kinds, lines };
  }

  /** The text with every hidden character taken out, and how many were. */
  function strip(text) {
    const t = asText(text);
    let count = 0;
    const out = t.replace(ANY, (c, offset) => (kept(offset, c.codePointAt(0)) ? c : (count++, "")));
    return { text: count ? out : t, count };
  }

  /** The line said under material from which `count` hidden characters were taken. */
  const note = (count) => (count > 0 ? `[${count} hidden character${count === 1 ? " was" : "s were"} removed from this text]` : "");

  /** Each hidden character of the `kinds` given (all when none are) written as its code: \u{E0041}. */
  function reveal(text, kinds) {
    const t = asText(text);
    const only = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
    return t.replace(ANY, (c, offset) => {
      const cp = c.codePointAt(0);
      if (kept(offset, cp) || (only && !only.has(kindOf(cp)))) return c;
      return `\\u{${hex(cp)}}`;
    });
  }

  /**
   * The kinds a project file shows as codes: those that can make it read one
   * way and mean another. The rest of a file stays exactly as it is.
   */
  const FILE_KINDS = ["tag", "selector", "direction"];

  /** Each code `reveal` writes turned back into the hidden character it stands for; any other is left as written. */
  function unreveal(text) {
    return asText(text).replace(/\\u\{([0-9A-Fa-f]{4,6})\}/g, (code, digits) => {
      const cp = parseInt(digits, 16);
      return kindOf(cp) ? String.fromCodePoint(cp) : code;
    });
  }

  window.HCTextSafety = { HIDDEN, FILE_KINDS, scan, strip, note, reveal, unreveal };
})();
