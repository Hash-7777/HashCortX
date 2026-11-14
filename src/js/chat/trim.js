// ==============================================================
// A chat agent's conversation fitted to its model's window
//
// An agent not on the shared loop, which is an agent on a model on this
// computer, was shown the conversation cut to a fixed guess of eight
// thousand tokens. A model with a small window could not hold that with its
// instructions, and the request was refused; one with a large window lost
// history it could have read. Its conversation is now fitted to the model:
//
//   · the budget is the model's own window, less room for its tool steps
//     and its answer (js/model-limits.js JOB_ROOM), or for its answer alone
//     when it has no tools, never more than half of it, so a small window
//     keeps half for the conversation;
//   · the oldest messages go first; the instructions and the latest
//     exchanges are always kept, and a request that still does not fit is
//     refused in words where it is sent (js/local-context.js);
//   · the model is told, in its instructions, how many earlier messages it
//     cannot see, so it does not answer as if it had read them; a small
//     model may answer about them anyway, so the person is told too, under
//     the answer (tell).
//
// Published as window.HCChatTrim. Checked by scripts/checks/chat-trim.mjs.
// ==============================================================
(function () {
  'use strict';

  /** The window taken when a model's own is not known: the smallest a model is given. */
  const UNKNOWN = 4096;
  /** The latest messages, after the instructions, that are always kept. */
  const KEEP_LAST = 4;
  const ROOM = { work: 4096, answer: 1024 };
  /** The room an agent with no tools keeps, for its answer alone: what js/local-context.js keeps for a reply. */
  const ANSWER_ROOM = 2048;

  /** The tokens a conversation may take in a window of `size`; an agent with no tools keeps room for its answer alone. */
  function budgetFor(size, { tools = true } = {}) {
    const w = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : UNKNOWN;
    const job = (window.HCModelLimits && window.HCModelLimits.JOB_ROOM) || ROOM;
    return w - Math.min(tools ? job.work + job.answer : ANSWER_ROOM, Math.floor(w / 2));
  }

  /** A count of a conversation's tokens on the safe side, for when none is handed in. */
  const roughly = (messages) => Math.ceil(messages.reduce((n, m) => n + String((m && m.content) || '').length + 16, 0) / 3.2);

  const noteOf = (n) => `[${n === 1 ? 'One earlier message' : `${n} earlier messages`} of this conversation ${n === 1 ? 'is' : 'are'} not shown here, to fit this model. If the person refers to ${n === 1 ? 'it' : 'them'}, say you cannot see ${n === 1 ? 'it' : 'them'}; do not answer as if you had read ${n === 1 ? 'it' : 'them'}.]`;

  /**
   * Fit `messages` in place to the budget of `window`, counting with
   * `tokensOf` (js/local-context.js), for an agent with `tools` or none.
   * Returns { budget, dropped }.
   */
  function fit(messages, { window: size, tokensOf, tools = true } = {}) {
    const count = typeof tokensOf === 'function' ? tokensOf : roughly;
    const budget = budgetFor(size, { tools });
    let dropped = 0;
    while (count(messages) > budget && messages.filter((m) => m && m.role !== 'system').length > KEEP_LAST) {
      messages.splice(messages.findIndex((m) => m && m.role !== 'system'), 1);
      dropped++;
    }
    if (dropped) {
      const first = messages.find((m) => m && m.role === 'system');
      if (first) first.content = `${String(first.content || '')}\n\n${noteOf(dropped)}`;
      else messages.unshift({ role: 'system', content: noteOf(dropped) });
    }
    return { budget, dropped };
  }

  /**
   * Say under `assistant`'s answer how many earlier messages its model could
   * not see (`leftOut`, kept from fit), once, in italics. A small model may
   * answer about them anyway; the person is told. True when it was said.
   */
  function tell(assistant) {
    const n = assistant && Number(assistant.leftOut);
    const content = String((assistant && assistant.content) || '');
    if (!(n > 0) || !content.trim() || content.includes('could not see')) return false;
    const line = n === 1
      ? 'This model could not see one earlier message of this conversation, to fit its window; an answer about it may be missing what it said.'
      : `This model could not see ${n} earlier messages of this conversation, to fit its window; an answer about them may be missing what they said.`;
    assistant.content = `${content.trimEnd()}\n\n*${line}*`;
    return true;
  }

  window.HCChatTrim = { UNKNOWN, KEEP_LAST, ANSWER_ROOM, budgetFor, fit, tell };
})();
