// ==============================================================
// Agent context budgeting
//
// Decides what the model actually sees of a long agent run.
//
// WHAT STAYS WHOLE
// ----------------
// The newest tool results arrive whole: they are what the agent is reasoning
// about, and a file it has just asked to read is no use to it cut short. The
// request is never taken away, however long the run.
//
// WHAT GIVES WAY, AND WHEN
// ------------------------
// Output the agent has already acted on gives way first. An older result is
// replaced by a line saying what it was and how to see it again, the long
// arguments of the call that produced it are not repeated, and a picture it
// opened long ago is not sent again. Older requests in a long conversation
// roll into a note that keeps what each of them asked.
//
// All of that happens in STEPS, never one message per turn. A model reads
// a request from the start, and a provider or a model on this computer can
// reuse the work of reading everything up to the first thing that changed
// since the previous request. Hiding one more result at every turn changed
// something near the start at every turn, so the whole run was read again at
// every turn. Here a result is hidden only when the results shown pass the
// budget, and then enough of them go at once to bring what is shown down to
// half of it; by count, several at once. Between those steps each request is
// the previous one with more on the end.
//
// The rules are worked out from the messages alone, with no state kept
// between turns: the same conversation always comes out the same way, and a
// message's hidden or cut form depends only on its own content and position.
//
// Pure functions: no DOM, no storage, no network. Checked by
// scripts/checks/agent-context.mjs.
// ==============================================================

(function () {
  'use strict';

  const DEFAULTS = {
    /** Characters of tool output shown whole; past this, older results are hidden. */
    toolBudget: 60000,
    /** A step of hiding brings what is shown down to this share of the budget. */
    hideTo: 0.5,
    /** One result longer than this is cut to it, its head and tail kept. */
    maxResult: 60000,
    /** No more than this many newest results... */
    keepResults: 10,
    /** ...counting from the last step, older ones hidden this many at a time. */
    hideStep: 6,
    /** Requests kept with everything that followed them; older ones roll into a note. */
    keepRequests: 3,
    /** Older requests roll into the note this many at a time. */
    requestStep: 2,
    /** An argument longer than this, in a call whose result is hidden, is not repeated. */
    longArgument: 300,
  };

  // ── Sized to the model ──────────────────────────────────────────────────
  //
  // How much a model is shown follows what it can use. A small model on this
  // computer reads slowly and loses the thread in a long request, so it is
  // shown the newest few results and a command's output in short; a large
  // cloud model is shown the most. `shellOutput` is how much of a command's
  // output is given before it is shortened (js/code/digest.js).
  const TIERS = {
    small: { toolBudget: 12000, maxResult: 10000, keepResults: 4, hideStep: 4, hideTo: 0.4, shellOutput: 3000 },
    mid: { toolBudget: 24000, maxResult: 16000, keepResults: 5, hideStep: 5, hideTo: 0.4, shellOutput: 6000 },
    local: { toolBudget: 40000, maxResult: 30000, keepResults: 8, hideStep: 5, shellOutput: 12000 },
    cloud: { toolBudget: 60000, maxResult: 60000, keepResults: 10, hideStep: 6, shellOutput: 20000 },
  };

  /**
   * The options for a model of this size ('small', 'mid' or 'full', as
   * hashcoder.js sizeOf gives it), `local` when it runs on this computer.
   */
  function optionsFor(size, local) {
    const tier = size === 'small' ? TIERS.small : size === 'mid' ? TIERS.mid : local ? TIERS.local : TIERS.cloud;
    return Object.assign({}, DEFAULTS, tier);
  }

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
   * Every tool result longer than `maxResult` cut to it, head and tail kept.
   * A result's cut form depends on nothing but its own text, so it is the
   * same at every turn. Returns a new array; inputs are never mutated,
   * because the caller keeps the untrimmed history for the UI and for the
   * next turn.
   */
  function budgetToolResults(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    if (!Array.isArray(messages)) return [];
    return messages.map((m) => (m && m.role === 'tool' && typeof m.content === 'string' && m.content.length > opts.maxResult
      ? Object.assign({}, m, { content: truncateResult(m.content, opts.maxResult) })
      : m));
  }

  /**
   * How many of the oldest of `n` things to set aside when the newest `keep`
   * are kept, `step` at a time: none until there are `keep + step`, then
   * enough to leave `keep`, and the same number until `step` more arrive.
   */
  const inSteps = (n, keep, step) => {
    const s = Math.max(1, Math.floor(step) || 1);
    return n < keep + s ? 0 : Math.floor((n - keep) / s) * s;
  };

  /**
   * How many of the oldest `lengths` (tool results, oldest first) are hidden.
   *
   * By count: `inSteps`. By size: nothing while the results total no more
   * than the budget; past it, every result that starts before a mark is
   * hidden, where the mark moves on in whole steps of the budget less the
   * share kept. What is shown is then under the budget, and a step leaves
   * about that share. The larger of the two, never the newest result.
   */
  function hiddenCount(lengths, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const n = lengths.length;
    if (n < 2) return 0;
    const byCount = inSteps(n, opts.keepResults, opts.hideStep);
    const high = opts.toolBudget;
    const low = Math.floor(high * Math.min(Math.max(Number(opts.hideTo) || 0, 0), 0.9));
    const total = lengths.reduce((t, l) => t + l, 0);
    let bySize = 0;
    if (total > high) {
      const stride = Math.max(1, high - low);
      const mark = Math.floor((total - low) / stride) * stride;
      let end = 0;
      while (bySize < n && end < mark) end += lengths[bySize++];
    }
    return Math.min(Math.max(byCount, bySize), n - 1);
  }

  // ── Hiding what is old, keeping what was asked ──────────────────────────

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
   * Hide the oldest tool results (hiddenCount), slim the calls that asked
   * for them, and take the pictures out of image messages up to the last
   * one hidden. Returns a new array; no message is removed, so every result
   * still follows the call it answers.
   */
  function hideOldResults(messages, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const out = messages.slice();
    const at = [];
    out.forEach((m, i) => { if (m && m.role === 'tool') at.push(i); });
    const lengths = at.map((i) => Math.min(typeof out[i].content === 'string' ? out[i].content.length : 0, opts.maxResult));
    const hide = hiddenCount(lengths, opts);
    if (!hide) return out;
    const cutoff = at[hide - 1];   // results at or before this index are hidden
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

  // A request is a user message the app did not add: the pictures an agent
  // opened arrive as a user message of their own, marked `opened`, inside a
  // request, and so does a note sending the agent back before it finishes,
  // marked `note`: counted as requests, three notes in one run rolled the
  // person's own request away. A request may carry pictures the person
  // attached.
  const isRequest = (m) => !!m && m.role === 'user' && !m.opened && !m.note;

  /**
   * A request as the model reads it: the person's words, then what the app
   * adds for that request alone (`context`: the file open, remembered facts,
   * the bar a site is held to). Kept on the message rather than in the
   * instructions, so the instructions stay the same from one request to the
   * next and the start of every request can be reused.
   */
  function withContext(m) {
    if (!m || m.role !== 'user' || typeof m.context !== 'string') return m;
    const out = Object.assign({}, m);
    delete out.context;
    if (m.context.trim()) out.content = `${m.content || ''}\n\n${m.context}`;
    return out;
  }

  /**
   * What the model is sent of a conversation: the newest requests (at least
   * `keepRequests`, older ones rolling into a note `requestStep` at a time)
   * with all that followed them, older tool results hidden (hideOldResults),
   * and any one result longer than `maxResult` cut.
   *
   * The note goes on the system message — there is only ever one system
   * turn, as several providers refuse more — and keeps what each earlier
   * request asked. The newest request is never rolled away.
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
    const roll = Math.min(inSteps(starts.length, opts.keepRequests, opts.requestStep), Math.max(0, starts.length - 1));
    if (roll) {
      const cut = starts[roll];
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
    // The project's notes (`notes` on the system message, js/code/context.js
    // projectNotes) are read at the start of the first request kept: text
    // from the project goes where the person's words do, not among the
    // instructions, and stays in the same place until earlier requests roll.
    const bare = systemMsg && 'notes' in systemMsg ? Object.assign({}, systemMsg) : systemMsg;
    if (bare !== systemMsg) delete bare.notes;
    const head = bare
      ? [note ? Object.assign({}, bare, { content: bare.content + '\n' + note }) : bare]
      : (note ? [{ role: 'system', content: note }] : []);
    const shown = kept.map(withContext);
    const notes = systemMsg && typeof systemMsg.notes === 'string' ? systemMsg.notes.trim() : '';
    const first = notes ? shown.findIndex(isRequest) : -1;
    if (first >= 0) shown[first] = Object.assign({}, shown[first], { content: `${notes}\n\n${shown[first].content || ''}` });
    return budgetToolResults(hideOldResults(head.concat(shown), opts), opts);
  }

  window.HCAgentContext = { DEFAULTS, TIERS, optionsFor, budgetToolResults, hiddenCount, hideOldResults, withContext, compressHistory };
})();
