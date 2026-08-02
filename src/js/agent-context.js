// ==============================================================
// Agent context budgeting
//
// Decides what the model actually sees of a long agent run.
//
// THE BUG THIS REPLACES
// ---------------------
// Every tool result was cut to 800 characters, on every call, at every point
// in the conversation. Not old results — all of them, including the file the
// agent had just asked to read. `fs_read_file` returns up to 100 KB and the
// model saw the first 800 bytes of it, then had to guess at the rest. It is
// the single biggest reason the coding agent felt weaker than it should: it
// was working almost blind, one paragraph at a time, and no amount of
// prompting could fix that because the text was gone before the model ran.
//
// WHAT REPLACES IT
// ----------------
// A budget, spent newest-first. Recent tool results — the ones the agent is
// actually reasoning about — arrive whole. Older ones are trimmed only once
// the budget runs out, because by then their content has usually already been
// acted on and what matters is that the call happened at all.
//
// Truncation says what was dropped and how to get it back, so the model can
// choose to re-read a region instead of inventing what was in it.
//
// Pure functions: no DOM, no storage, no network. Checked by
// scripts/checks/agent-context.mjs.
// ==============================================================

(function () {
  'use strict';

  const DEFAULTS = {
    /** Characters of tool output kept verbatim across the whole prompt. */
    toolBudget: 60000,
    /** No result is trimmed below this, however tight the budget gets. */
    minPerResult: 400,
    /** Verbatim turns kept before older ones roll into a summary line. */
    keepTurns: 16,
    /** Below this many messages, nothing is summarised at all. */
    summariseAfter: 18,
  };

  function truncateResult(content, keep) {
    // Keep the head — for a file read or a directory listing that is the part
    // carrying structure. Keep a little of the tail too, because a command's
    // exit message and a compiler's final error both live at the end, and
    // dropping them turns a diagnosable failure into a mystery.
    const headLen = Math.floor(keep * 0.75);
    const tailLen = keep - headLen;
    const dropped = content.length - keep;
    const head = content.slice(0, headLen);
    const tail = tailLen > 0 ? content.slice(-tailLen) : '';
    return (
      head +
      `\n\n…[${dropped.toLocaleString()} characters omitted from the middle of this result. ` +
      `Re-read the file or re-run with a narrower query to see them.]…\n\n` +
      tail
    );
  }

  /**
   * Spend a character budget on tool results, newest first.
   *
   * Returns a new array; inputs are never mutated, because the caller keeps the
   * untrimmed history for the UI and for the next turn.
   */
  function budgetToolResults(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    if (!Array.isArray(messages)) return [];

    const out = messages.slice();
    let spent = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message || message.role !== 'tool' || typeof message.content !== 'string') continue;

      const remaining = opts.toolBudget - spent;
      if (message.content.length <= remaining) {
        spent += message.content.length;
        continue; // fits whole — the common case, and the one that was broken
      }

      const keep = Math.max(remaining, opts.minPerResult);
      if (keep >= message.content.length) {
        spent += message.content.length;
        continue;
      }
      spent += keep;
      out[i] = Object.assign({}, message, { content: truncateResult(message.content, keep) });
    }
    return out;
  }

  /**
   * Roll turns older than the recent window into one summary line, then apply
   * the tool budget to what remains.
   *
   * The system message stays at index 0 and the summary is appended to it, so
   * there is only ever one system turn — several providers reject more.
   */
  function compressHistory(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    if (!Array.isArray(messages)) return [];
    if (messages.length <= opts.summariseAfter) return budgetToolResults(messages, opts);

    const systemMsg = messages[0] && messages[0].role === 'system' ? messages[0] : null;
    const rest = systemMsg ? messages.slice(1) : messages;

    // Never cut inside a tool-call pair: an orphaned tool result, with no
    // assistant turn that requested it, is rejected outright by most APIs.
    let cut = Math.max(0, rest.length - opts.keepTurns);
    while (cut < rest.length && rest[cut] && rest[cut].role === 'tool') cut++;

    const older = rest.slice(0, cut);
    const tail = rest.slice(cut);
    if (!older.length) return budgetToolResults(messages, opts);

    const users = older.filter(m => m && m.role === 'user').length;
    const assistants = older.filter(m => m && m.role === 'assistant').length;
    const tools = older.filter(m => m && m.role === 'tool').length;
    const summary =
      `[Earlier context compressed: ${users} user message${users !== 1 ? 's' : ''}, ` +
      `${assistants} assistant repl${assistants !== 1 ? 'ies' : 'y'}, ` +
      `${tools} tool call${tools !== 1 ? 's' : ''}.]`;

    const head = systemMsg
      ? Object.assign({}, systemMsg, { content: systemMsg.content + '\n' + summary })
      : { role: 'system', content: summary };

    return budgetToolResults([head].concat(tail), opts);
  }

  window.HCAgentContext = { DEFAULTS, budgetToolResults, compressHistory };
})();
