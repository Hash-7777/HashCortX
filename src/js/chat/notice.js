// ==============================================================
// A notice the app puts under an agent's answer
//
// Some agents must always close with the same words, such as a medical
// agent telling the person to check with a pharmacist. Asking the model to
// write them does not hold: a model may leave them out, and an answer that
// repeats its instructions word for word is not kept as written
// (js/prompt-privacy.js), so the words it was given to copy are the very
// words taken away. An agent that needs them carries them as its notice,
// and the app adds them itself, under the finished answer:
//
//   · once, in italics, apart from the answer;
//   · only under an answer that has something in it;
//   · never for an agent with no notice.
//
// Pure but for the reply it is handed. Published as window.HCAgentNotice.
// Checked by scripts/checks/chat-notice.mjs.
// ==============================================================
(function () {
  'use strict';

  /** Add `agent`'s notice under `assistant`'s answer; true when it was added. */
  function add(agent, assistant) {
    const text = String((agent && agent.notice) || '').trim();
    if (!text || !assistant) return false;
    const content = String(assistant.content || '');
    if (!content.trim() || content.includes(text)) return false;
    assistant.content = `${content.trimEnd()}\n\n*${text}*`;
    return true;
  }

  window.HCAgentNotice = { add };
})();
