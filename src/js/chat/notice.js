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
// A copy of an agent saved before agents carried a notice is repaired
// when it is loaded (repair).
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

  /** Medical Lexi-Check's notice (js/app.js), and what a copy of it is given when repaired. */
  const PHARMACIST = 'This report is for information only. Check it with a licensed pharmacist or physician before making any medication decision.';
  // The closing sentence a copy of that agent made before agents carried a
  // notice still holds in its instructions, matched by its shape: the model
  // was told to write it, and an answer repeating its instructions loses it.
  const OLD_CLOSING = /^[ \t]*\*This report is for informational purposes only\. Verify with a licensed pharmacist or physician and [^\n*]{1,80} before making any medication decisions\.\*[ \t]*$/m;

  /**
   * A saved agent as it should run: a copy whose instructions still ask the
   * model for that sentence has it taken out and is given the notice
   * instead. Anything else is returned as it is.
   */
  function repair(agent) {
    if (!agent || agent.builtin || typeof agent.systemPrompt !== 'string' || !OLD_CLOSING.test(agent.systemPrompt)) return agent;
    const systemPrompt = agent.systemPrompt.replace(OLD_CLOSING, '').replace(/\n{3,}/g, '\n\n').trim();
    return { ...agent, systemPrompt, notice: agent.notice || PHARMACIST };
  }

  window.HCAgentNotice = { PHARMACIST, add, repair };
})();
