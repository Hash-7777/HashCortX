// ==============================================================
// What an agent is shown of the work that came before it
//
// THE DEFECT THIS FIXES. Everything every earlier agent had said was pasted
// in, whole, for the agent that checks the work and the agent that delivers
// it. On a website that is the same page five times over: five pages sharing
// one header, one nav and one footer, two coders who each wrote their own
// version of the same page, and two stylesheets. A real run sent all of it to
// its validator and got back "Request too large" from every provider it tried,
// so the run ended with the two agents that were there to check and finish the
// work having done neither — and the trace still said the task was done.
//
// WHAT HAPPENS INSTEAD. An agent that needs the whole of its inputs is shown
// the PROJECT rather than the conversation: every file the team has written,
// each one once, the latest version of each, named. That is smaller than the
// transcript and truer than it — an agent used to be shown two different
// index.html files with nothing to say which was the current one. Answers
// that produced no files keep their words, since that is all they are.
//
// And there is a ceiling on the whole context, not only on each piece of it.
// A per-piece limit multiplied by the number of agents is not a limit.
//
// Pure: answers in, text out. No DOM, no storage, no network.
//
// Loaded after js/swarm/project-files.js, before the Agent Swarm, and
// published as window.HCSwarmContext.
// Checked by scripts/checks/swarm-context.mjs.
// ==============================================================

(function () {
  'use strict';

  const DEFAULT_PER = 2000;
  const DEFAULT_TOTAL = 60000;
  const LANG = { html: 'html', htm: 'html', css: 'css', js: 'javascript', mjs: 'javascript', json: 'json', svg: 'svg', md: 'markdown', py: 'python' };

  const cutNote = (name, whole, given) =>
    `\n[...cut here. ${name} wrote ${whole} characters and you were given the first ${given}. `
    + 'Do not treat this as the whole of it, and do not rewrite the missing part from guesswork — '
    + 'work from what is here and say what you could not see.]';

  /**
   * The project the answers add up to, and the answers that were not files.
   *
   * Read in the order given, so a later correction replaces what it corrects,
   * and with each answer told what the ones before it produced — an agent that
   * pastes an unnamed page does not displace the page the team agreed on.
   *
   * Only an answer with no code in it at all counts as words. An answer whose
   * blocks were all ranked out is a second copy of something already here.
   */
  function projectFrom(answers) {
    const files = new Map();
    const prose = [];
    for (const { name, text } of answers || []) {
      const body = String(text || '');
      let found = new Map();
      try {
        found = window.HCSwarmProjectFiles.extractProjectFiles(body, { existing: [...files.keys()] });
      } catch { found = new Map(); }
      if (found.size) { for (const [n, f] of found) files.set(n, f); continue; }
      // An answer whose blocks were all ranked out — a second copy of a page
      // another agent already named — is not prose. Pasting it back in whole
      // would return exactly the duplication this is here to remove.
      let hadCode = false;
      try { hadCode = window.HCFences.splitFences(body).some((p) => p.type === 'code'); } catch { hadCode = false; }
      if (!hadCode) prose.push({ name, text: body });
    }
    return { files, prose };
  }

  /** One file, fenced and named the way the agents are asked to write them. */
  function fenceOf(name, file) {
    const ext = String(name).split('.').pop().toLowerCase();
    return `\n\n\`\`\`${LANG[ext] || ''} ${name}\n${String((file && file.content) || '')}\n\`\`\``;
  }

  /**
   * The files as fenced blocks, named the way the agents are asked to write
   * them, stopping before `limit`. What is left out is named, so an agent is
   * never shown part of a project as though it were the whole of it.
   */
  function fencesOf(filesIn, limit = DEFAULT_TOTAL) {
    const files = filesIn && typeof filesIn.get === 'function' ? filesIn : new Map(Object.entries(filesIn || {}));
    let body = '';
    let left = Math.max(0, limit);
    const dropped = [];
    for (const [name, file] of files) {
      const piece = fenceOf(name, file);
      if (piece.length > left) { dropped.push(name); continue; }
      body += piece;
      left -= piece.length;
    }
    if (dropped.length) body += `\n\n[${dropped.join(', ')} would not fit and ${dropped.length === 1 ? 'is' : 'are'} not here.]`;
    return body;
  }

  /**
   * What an agent is shown of the work before it.
   *
   * `whole` asks for the project rather than the transcript, for the agent
   * that checks the files or assembles them. Everything is held under
   * `totalLimit` however it is built, and whatever is left out says so.
   */
  function contextFor(depResults, { whole = false, perLimit = DEFAULT_PER, totalLimit = DEFAULT_TOTAL } = {}) {
    const answers = Object.entries(depResults || {})
      .filter(([, v]) => v)
      .map(([name, out]) => ({ name, text: String(out) }));
    if (!answers.length) return '';

    let body = '';
    let left = Math.max(0, totalLimit);
    const dropped = [];

    if (whole) {
      const { files, prose } = projectFrom(answers);
      if (files.size) {
        body += '\n\n--- The project as it stands, every file the team has written ---';
        for (const [name, file] of files) {
          const piece = fenceOf(name, file);
          if (piece.length > left) { dropped.push(name); continue; }
          body += piece;
          left -= piece.length;
        }
      }
      for (const { name, text } of prose) {
        const piece = `\n\n[${name}]:\n${text}`;
        if (piece.length > left) { dropped.push(name); continue; }
        body += piece;
        left -= piece.length;
      }
      if (dropped.length) {
        body += `\n\n[${dropped.join(', ')} would not fit and ${dropped.length === 1 ? 'is' : 'are'} not here. `
          + 'Say so rather than writing them from guesswork.]';
      }
      return body;
    }

    body = '\n\n--- Input from prior agents ---';
    for (const { name, text } of answers) {
      const limit = Math.min(perLimit, left);
      if (limit <= 0) { dropped.push(name); continue; }
      const cut = text.length > limit;
      const piece = `\n[${name}]:\n${text.slice(0, limit)}` + (cut ? cutNote(name, text.length, limit) : '');
      body += piece;
      left -= piece.length;
    }
    if (dropped.length) body += `\n\n[${dropped.join(', ')} would not fit and ${dropped.length === 1 ? 'is' : 'are'} not here.]`;
    return body;
  }

  window.HCSwarmContext = { contextFor, projectFrom, fencesOf, DEFAULT_PER, DEFAULT_TOTAL };
})();
