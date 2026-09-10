// ==============================================================
// Talking to the agents who made a run
//
// In the Swarm Workspace a person can message the team about what it made —
// "make the header darker", "@Designer try a warmer palette" — and the agent
// it is for answers in the conversation and, when it changes files, those
// changes become a new version. This decides who a message is for, what that
// agent is given, and what its answer does to the run.
//
// A message that names nobody goes to the run's lead agent: the one the
// blueprint says produces the final output, or failing that its supervisor,
// or the agent at the end of the chain.
//
// What an agent is given is bounded. The conversation and the files are
// trimmed to budgets, most recent first, with a note wherever something was
// left out, so a long run cannot push the actual question out of the model's
// window and nothing is cut without the agent being told.
//
// Pure: takes a run and a message, returns decisions. No DOM, no network.
//
// Loaded after js/fences.js and js/swarm/runs.js, before the
// Agent Swarm, and published as window.HCSwarmTalk.
// Checked by scripts/checks/swarm-workspace.mjs.
// ==============================================================

(function () {
  'use strict';

  const BUDGET = { turnChars: 2000, conversationChars: 16000, fileChars: 60000 };

  /** The agent a message with no name in it goes to. */
  function leadAgentId(run) {
    const agents = run?.agents || [];
    if (!agents.length) return '';
    if (run.leadAgentId && agents.some((a) => a.id === run.leadAgentId)) return run.leadAgentId;
    const supervisor = agents.find((a) => a.role === 'supervisor');
    if (supervisor) return supervisor.id;
    const sends = new Set((run.edges || []).map((e) => e.from));
    const ends = agents.filter((a) => !sends.has(a.id));
    return (ends[ends.length - 1] || agents[agents.length - 1]).id;
  }

  /**
   * Who a message is for, and what it says once the name is taken off.
   *
   * "@Name" at the start picks an agent, matching the longest name so "@Code
   * Reviewer" is not read as "@Code". An @ that matches nobody is left in the
   * text and the message goes to the lead.
   */
  function addressee(run, text) {
    const raw = String(text || '').trim();
    const agents = (run?.agents || []).slice().sort((a, b) => b.name.length - a.name.length);
    if (raw.startsWith('@')) {
      const rest = raw.slice(1);
      for (const a of agents) {
        for (const label of [a.name, a.id]) {
          if (rest.toLowerCase().startsWith(label.toLowerCase())) {
            const after = rest.slice(label.length);
            if (after === '' || /^[\s,:]/.test(after)) {
              return { agentId: a.id, text: after.replace(/^[\s,:]+/, '').trim(), named: true };
            }
          }
        }
      }
    }
    return { agentId: leadAgentId(run), text: raw, named: false };
  }

  const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n[… ${s.length - n} more characters left out]` : s);

  /** The conversation so far, newest turns kept first when it has to be cut. */
  function transcript(run) {
    const name = (who) => (who === 'you' ? 'The person' : who === 'team' ? 'Team result' : (run.agents.find((a) => a.id === who)?.name || who));
    const parts = [];
    let used = 0;
    let dropped = 0;
    for (let i = run.turns.length - 1; i >= 0; i--) {
      const t = run.turns[i];
      const piece = `${name(t.who)}${t.status !== 'ok' ? ` (${t.status})` : ''}:\n${clip(String(t.text), BUDGET.turnChars)}`;
      if (used + piece.length > BUDGET.conversationChars && parts.length) { dropped = i + 1; break; }
      parts.unshift(piece);
      used += piece.length;
    }
    return (dropped ? `[${dropped} earlier turn${dropped === 1 ? '' : 's'} left out]\n\n` : '') + parts.join('\n\n');
  }

  /** The current files, whole where they fit and listed by name where they do not. */
  function fileContext(files) {
    const names = Object.keys(files || {});
    if (!names.length) return 'There are no files yet.';
    const whole = [];
    const listed = [];
    let used = 0;
    for (const n of names) {
      const f = files[n];
      const block = '```' + (f.lang || '') + ' ' + n + '\n' + f.content + '\n```';
      if (used + block.length > BUDGET.fileChars) { listed.push(n); continue; }
      whole.push(block);
      used += block.length;
    }
    return whole.join('\n\n') + (listed.length ? `\n\n[Also in the project, not shown here to save space: ${listed.join(', ')}]` : '');
  }

  /**
   * What the agent is sent: its own instructions and how to answer, then the
   * task, the conversation, the files as they are on screen, and the message.
   */
  function messagesFor(run, agentId, text, files) {
    const agent = (run.agents || []).find((a) => a.id === agentId) || {};
    const system = [
      agent.systemPrompt || `You are ${agent.name || 'an agent'}, a ${agent.role || 'helpful'} member of a team.`,
      '',
      'You are continuing work your team has already done. A person is reviewing it and has a request for you.',
      'If the request needs files changed, reply with each file you change, complete, in a fenced code block',
      'labelled with its language and path, like ```html index.html, and leave out the files you do not change.',
      'Only a labelled block changes a file, so never label an example. Say in a sentence or two what you',
      'changed. If the request needs no change to the files, just answer it.',
    ].join('\n');
    const request = [
      `The task the team was given:\n${run.task || '(none recorded)'}`,
      `The conversation so far:\n${transcript(run)}`,
      `The project's files as they are now:\n${fileContext(files)}`,
      `The request:\n${String(text)}`,
    ].join('\n\n---\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: request }];
  }

  /**
   * The run with the person's message and the agent's answer added, and a new
   * version if the answer changed any files. `base` is the version the person
   * was looking at, so a change asked of v1 is made to v1.
   *
   * Returns the run, the names of the files that changed, and whether the
   * answer had code in it that named no file — so the person can be told why
   * nothing changed instead of wondering.
   */
  function withReply(run, { agentId, message, reply, at, base }) {
    const R = window.HCSwarmRuns;
    let r = R.withTurn(run, { who: 'you', text: message, at });
    r = R.withTurn(r, { who: agentId, text: reply, at });
    const found = R.filesFromText(reply, { guess: false });
    const before = r.versions.length;
    r = R.withVersion(r, { by: agentId, at, changed: found, base });
    const changed = r.versions.length > before ? r.versions[r.versions.length - 1].changed : [];
    const unnamedCode = !Object.keys(found).length
      && window.HCFences.splitFences(String(reply)).some((p) => p.type === 'code');
    return { run: r, changed, unnamedCode };
  }

  window.HCSwarmTalk = { leadAgentId, addressee, messagesFor, withReply, transcript, fileContext, BUDGET };
})();
