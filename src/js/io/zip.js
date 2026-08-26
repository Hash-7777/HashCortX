// ============================================================
// io/zip.js — a zip container, stored rather than compressed
//
// Written for 3MF, which is a zip with three XML members inside it, and used by
// anything here that has to hand somebody an archive. It sat under the 3D mode
// for a while and a second, separate implementation grew in the Virtual OS —
// two ways of writing the same format, one of them checked. A zip container is
// not a feature of either mode, so it lives on its own now and both use it.
//
// It does the smallest possible thing: every member is STORED, not deflated.
//
// WHY NO COMPRESSION. Deflate is a few hundred lines of state machine that
// must be exactly right, and a subtly wrong one produces a file that opens in
// the program it was tested against and fails in the next. Stored entries are
// a length and the bytes, which cannot be subtly wrong — and the zip format
// has always allowed them, so every reader handles them. The cost is size: a
// model's XML is repetitive and would compress well. That is a trade of disk
// space for a file that is certain to open, and for a printed part the second
// matters and the first does not.
//
// WHAT IS DELIBERATELY LEFT OUT. No directories, no zip64, no encryption, no
// data descriptors, no comments. A 3MF has three small members with known
// lengths, and every one of those features exists to solve a problem this does
// not have.
//
// Pure: bytes in, bytes out. No clock either — the timestamp is fixed, so the
// same model written twice produces the same bytes. A file that differs only
// by the second it was written cannot be compared with a previous one.
//
// Run the checks with: npm run check:zip
// ============================================================
(function () {
  "use strict";

  const LOCAL_SIG = 0x04034b50;
  const CENTRAL_SIG = 0x02014b50;
  const END_SIG = 0x06054b50;

  // 1980-01-01 00:00, the earliest a zip can express. Any fixed value would
  // do; what matters is that it does not come from a clock.
  const DOS_TIME = 0;
  const DOS_DATE = 0x0021;

  const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const encode = (text) => new TextEncoder().encode(String(text));

  /**
   * `[{ name, bytes }]` into one zip.
   *
   * Names are written as UTF-8 with the language-encoding flag set, because a
   * member name is not always ASCII and a reader has no other way to know.
   */
  function store(files) {
    const entries = (Array.isArray(files) ? files : []).map((file) => {
      const name = encode(file && file.name);
      const bytes = file && file.bytes ? Uint8Array.from(file.bytes) : new Uint8Array(0);
      return { name, bytes, crc: crc32(bytes) };
    });

    const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.bytes.length, 0);
    const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;

    for (const entry of entries) {
      entry.offset = at;
      view.setUint32(at, LOCAL_SIG, true);
      view.setUint16(at + 4, 20, true);      // version needed
      view.setUint16(at + 6, 0x0800, true);  // the name is UTF-8
      view.setUint16(at + 8, 0, true);       // stored
      view.setUint16(at + 10, DOS_TIME, true);
      view.setUint16(at + 12, DOS_DATE, true);
      view.setUint32(at + 14, entry.crc, true);
      view.setUint32(at + 18, entry.bytes.length, true);
      view.setUint32(at + 22, entry.bytes.length, true);
      view.setUint16(at + 26, entry.name.length, true);
      view.setUint16(at + 28, 0, true);      // no extra field
      out.set(entry.name, at + 30);
      out.set(entry.bytes, at + 30 + entry.name.length);
      at += 30 + entry.name.length + entry.bytes.length;
    }

    const centralAt = at;
    for (const entry of entries) {
      view.setUint32(at, CENTRAL_SIG, true);
      view.setUint16(at + 4, 20, true);      // version made by
      view.setUint16(at + 6, 20, true);      // version needed
      view.setUint16(at + 8, 0x0800, true);
      view.setUint16(at + 10, 0, true);
      view.setUint16(at + 12, DOS_TIME, true);
      view.setUint16(at + 14, DOS_DATE, true);
      view.setUint32(at + 16, entry.crc, true);
      view.setUint32(at + 20, entry.bytes.length, true);
      view.setUint32(at + 24, entry.bytes.length, true);
      view.setUint16(at + 28, entry.name.length, true);
      view.setUint16(at + 30, 0, true);      // extra
      view.setUint16(at + 32, 0, true);      // comment
      view.setUint16(at + 34, 0, true);      // disk number
      view.setUint16(at + 36, 0, true);      // internal attributes
      view.setUint32(at + 38, 0, true);      // external attributes
      view.setUint32(at + 42, entry.offset, true);
      out.set(entry.name, at + 46);
      at += 46 + entry.name.length;
    }

    view.setUint32(at, END_SIG, true);
    view.setUint16(at + 4, 0, true);         // this disk
    view.setUint16(at + 6, 0, true);         // the disk the directory starts on
    view.setUint16(at + 8, entries.length, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 12, centralSize, true);
    view.setUint32(at + 16, centralAt, true);
    view.setUint16(at + 20, 0, true);        // no comment
    return out;
  }

  /**
   * A zip back into its members, read through the CENTRAL DIRECTORY.
   *
   * Not by scanning for local headers, which is how a naive reader does it and
   * how a naive reader gets it wrong: the local header of a compressed entry
   * may carry zeroes for the sizes, with the real ones in a trailing
   * descriptor, and the bytes of one member may contain the signature of
   * another. The directory at the end is the file's own index and is the only
   * part of a zip that is authoritative.
   *
   * A member this cannot read is left out rather than returned as something
   * approximate — a caller reading half an XML file gets a worse error, later.
   */
  function unstore(bytes) {
    const out = new Map();
    if (!bytes || bytes.length < 22) return out;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === END_SIG) { end = i; break; }
    }
    if (end < 0) return out;
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIG) break;
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extraLength + commentLength;
      // Only stored members. Anything deflated is beyond what this reads, and
      // saying so by omission is better than handing back compressed bytes as
      // though they were the file.
      if (method !== 0 || offset + 30 > bytes.length) continue;
      const localNameLength = view.getUint16(offset + 26, true);
      const localExtraLength = view.getUint16(offset + 28, true);
      const from = offset + 30 + localNameLength + localExtraLength;
      if (from + size > bytes.length) continue;
      out.set(name, bytes.slice(from, from + size));
    }
    return out;
  }

  window.HCZip = { store, unstore, crc32 };
})();
