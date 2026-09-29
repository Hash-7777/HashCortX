// ==============================================================
// A command's output as the model is given it
//
// A test or build run can print thousands of lines, nearly all of them
// saying that something passed or is under way. The model needs the lines
// that report a failure or an error and say where, the summary, and how the
// run ended; the rest fills its window and pushes out what it read before.
// So output longer than the limit for the model in use is given as its
// first lines, every line that reports a failure, an error or a missing
// program with a little around it, and its last lines, with a count of what
// was left out. The person sees all of it in the terminal.
//
// The same output always comes out the same way, so a request that holds it
// can be reused at the next step (js/agent-context.js).
//
// Pure: takes strings and records, returns strings and records.
//
// Loaded before the Coder mode and published as window.HCCodeDigest.
// Checked by scripts/checks/code-digest.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Output of a run no longer than this is given whole. */
  const DEFAULT_LIMIT = 20000;

  /** A line that reports something went wrong, or where. */
  const MARK = new RegExp([
    '\\b(fail(ed|ure|ures|ing|s)?|errors?|exception|traceback|panic(ked)?|assert(ion)?(error)?|not ok|expected|received|unexpected|cannot|denied|refused|timed? ?out|segmentation fault|not found|not recognized|missing script|undefined)\\b',
    '[\\u2717\\u2716\\u00d7]',                       // the crosses test runners print
    '^\\s*at .+:\\d+',                              // a JavaScript stack line
    '^\\s*File ".+", line \\d+',                    // a Python one
    '^\\s*-->\\s',                                  // a Rust one
    '\\S+\\.[a-z]{1,4}:\\d+(:\\d+)?',               // file:line
  ].join('|'), 'i');

  const HEAD = 8;
  const TAIL = 30;
  const AROUND = 2;

  /**
   * `text` no longer than `limit`: whole when it fits, otherwise its first
   * lines, each marked line with the lines around it, and its last lines,
   * a line saying how many were left out where they were.
   */
  function digestText(text, limit = DEFAULT_LIMIT) {
    const whole = String(text == null ? '' : text);
    if (whole.length <= limit) return whole;
    const lines = whole.split('\n');
    const n = lines.length;
    const keep = new Uint8Array(n);
    for (let i = 0; i < Math.min(HEAD, n); i++) keep[i] = 1;
    for (let i = Math.max(0, n - TAIL); i < n; i++) keep[i] = 1;
    for (let i = 0; i < n; i++) {
      if (!MARK.test(lines[i])) continue;
      for (let k = Math.max(0, i - AROUND); k <= Math.min(n - 1, i + AROUND); k++) keep[k] = 1;
    }
    const out = [];
    let left = 0;
    for (let i = 0; i < n; i++) {
      if (keep[i]) {
        if (left) { out.push(`… [${left} line${left === 1 ? '' : 's'} left out] …`); left = 0; }
        out.push(lines[i]);
      } else left++;
    }
    const shown = keep.reduce((t, k) => t + k, 0);
    const note = `[Shortened for the model: ${shown} of ${n} lines, the first and last and every line reporting a failure or an error. Run a narrower command to see more.]`;
    let body = out.join('\n');
    // Still too long (a run where nearly every line reports a failure): its
    // start and end, cut on line boundaries.
    const room = Math.max(0, limit - note.length - 64);
    if (body.length > room) {
      const headPart = body.slice(0, Math.floor(room * 0.4));
      const tailPart = body.slice(body.length - Math.ceil(room * 0.6));
      body = headPart.slice(0, headPart.lastIndexOf('\n') + 1) + '… [more left out] …\n' + tailPart.slice(tailPart.indexOf('\n') + 1);
    }
    return `${note}\n${body}`;
  }

  /**
   * What shell_run hands the model: the same record, its output shortened
   * when the two streams together pass `limit`. The error stream is given
   * room first, since that is where a failure is usually said.
   */
  function shellResult(result, limit = DEFAULT_LIMIT) {
    if (!result || typeof result !== 'object') return result;
    const out = String(result.stdout || '');
    const err = String(result.stderr || '');
    const max = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;
    if (out.length + err.length <= max) return result;
    const errRoom = Math.min(err.length, Math.max(Math.floor(max / 2), max - out.length));
    const outRoom = Math.max(0, max - errRoom);
    return Object.assign({}, result, { stdout: digestText(out, outRoom), stderr: digestText(err, errRoom) });
  }

  window.HCCodeDigest = { DEFAULT_LIMIT, MARK, digestText, shellResult };
})();
