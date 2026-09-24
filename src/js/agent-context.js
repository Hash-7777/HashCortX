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
    /** The newest tool results shown in full; older ones are hidden. */
    keepResults: 10,
    /** Requests kept with everything that followed them; older ones roll into a note. */
    keepRequests: 3,
    /** An argument longer than this, in a call whose result is hidden, is not repeated. */
    longArgument: 300,
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

  // ── Hiding what is old, keeping what was asked ──────────────────────────
  //
  // Older turns used to be rolled into a one-line count once a conversation
  // passed 18 messages. A single task reaches that in nine steps, and the
  // first message rolled away was the request itself: from there on the model
  // was working on a task nobody had told it about. Now the request is never
  // taken away. What gives way first is the output of tools the agent has
  // already acted on: the newest results stay whole, older ones are replaced
  // by a line saying what they were, and the long arguments of the calls that
  // produced them (a whole file written, a passage replaced) are not repeated.
  // Only when a conversation holds several requests are the earliest ones
  // rolled into a note, and the note keeps the words of each.

  const RESULT_TARGET_KEYS = ['path', 'dir', 'file', 'from', 'query', 'pattern', 'url', 'command'];

  /** What a call was about, in a few words: `read_file src/app.js`. */
  function callLabel(name, args) {
    let a = args;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = {}; } }
    const key = RESULT_TARGET_KEYS.find((k) => a && typeof a[k] === 'string' && a[k]);
    const target = key ? String(a[key]).slice(0, 120) : '';
    return (name || 'a tool') + (target ? ' ' + target : '');
  }

  /** The call's arguments with every long string replaced by its length. */
  function slimArguments(raw, limit) {
    const isText = typeof raw === 'string';
    let args = raw;
    if (isText) { try { args = JSON.parse(raw); } catch { return raw; } }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return raw;
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length > limit) {
        out[k] = `[${v.length.toLocaleString()} characters, sent earlier and not repeated]`;
        changed = true;
      } else out[k] = v;
    }
    if (!changed) return raw;
    return isText ? JSON.stringify(out) : out;
  }

  /**
   * Hide tool results older than the newest `keepResults`, slim the calls that
   * asked for them, and take the pictures out of image messages older than
   * that. Returns a new array; no message is removed, so every result still
   * follows the call it answers.
   */
  function hideOldResults(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const out = messages.slice();
    let seen = 0;
    let cutoff = -1;   // results at or before this index are hidden
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i] && out[i].role === 'tool' && ++seen > opts.keepResults) { cutoff = i; break; }
    }
    if (cutoff < 0) return out;
    const labels = new Map();
    for (let i = 0; i <= cutoff; i++) {
      const m = out[i];
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        for (const c of m.tool_calls) {
          const fn = c && c.function;
          labels.set(c && c.id, callLabel(fn ? fn.name : c && c.name, fn ? fn.arguments : c && c.arguments));
        }
        out[i] = Object.assign({}, m, {
          tool_calls: m.tool_calls.map((c) => {
            if (!c) return c;
            if (c.function) return Object.assign({}, c, { function: Object.assign({}, c.function, { arguments: slimArguments(c.function.arguments, opts.longArgument) }) });
            return 'arguments' in c ? Object.assign({}, c, { arguments: slimArguments(c.arguments, opts.longArgument) }) : c;
          }),
        });
      } else if (m.role === 'tool' && typeof m.content === 'string') {
        const label = labels.get(m.tool_call_id) || callLabel(m.name, null);
        out[i] = Object.assign({}, m, {
          content: `[Earlier result of ${label}, hidden to keep the conversation short. Call the tool again if you need it.]`,
        });
      } else if (m.role === 'user' && Array.isArray(m.images) && m.images.length) {
        const rest = Object.assign({}, m);
        delete rest.images;
        out[i] = Object.assign(rest, { content: `${m.content || ''} [The picture was shown earlier and is not sent again.]`.trim() });
      }
    }
    return out;
  }

  // A request is a user message that carries no picture: the app adds the
  // images an agent opened as a user message of their own, inside a request.
  const isRequest = (m) => !!m && m.role === 'user' && !(Array.isArray(m.images) && m.images.length);

  /**
   * What the model is sent of a conversation: every request of the newest
   * `keepRequests` with all that followed it, tool results older than the
   * newest `keepResults` hidden, and the tool budget spent on the rest.
   *
   * Earlier requests roll into a note on the system message — there is only
   * ever one system turn, as several providers refuse more — and the note
   * keeps what each of them asked. The newest request is never rolled away.
   */
  function compressHistory(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    if (!Array.isArray(messages)) return [];
    const systemMsg = messages[0] && messages[0].role === 'system' ? messages[0] : null;
    const rest = systemMsg ? messages.slice(1) : messages.slice();
    const starts = [];
    rest.forEach((m, i) => { if (isRequest(m)) starts.push(i); });
    let kept = rest;
    let note = '';
    if (starts.length > opts.keepRequests) {
      const cut = starts[starts.length - opts.keepRequests];
      const older = rest.slice(0, cut);
      kept = rest.slice(cut);
      const asked = older.filter(isRequest).map((m) => {
        const text = String(m.content || '').replace(/\s+/g, ' ').trim();
        return `"${text.length > 200 ? text.slice(0, 200) + '…' : text}"`;
      });
      const calls = older.filter((m) => m && m.role === 'tool').length;
      note = `[Earlier in this conversation, not repeated here: ${asked.length} earlier request${asked.length === 1 ? '' : 's'} ` +
        `(${asked.join('; ')}), answered with ${calls} tool call${calls === 1 ? '' : 's'}.]`;
    }
    const head = systemMsg
      ? [note ? Object.assign({}, systemMsg, { content: systemMsg.content + '\n' + note }) : systemMsg]
      : (note ? [{ role: 'system', content: note }] : []);
    return budgetToolResults(hideOldResults(head.concat(kept), opts), opts);
  }

  window.HCAgentContext = { DEFAULTS, budgetToolResults, hideOldResults, compressHistory };
})();
