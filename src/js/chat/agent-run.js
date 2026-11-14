// ==============================================================
// A chat agent's run on the shared loop
//
// The chat's agents had a loop of their own: the conversation cut to a
// fixed guess of eight thousand tokens by dropping the oldest messages,
// tools run one at a time, calls taken as written, and no check of the
// answer. HashCoder's loop (js/agent-loop.js) already sizes what a model is
// shown to the model itself, runs reads together, puts a call's arguments
// right, and holds an answer to finishing checks. This hands a chat agent's
// run to it, with a state of its own so nothing of HashCoder's is read or
// changed:
//
//   · its tools are the agent's, each made by the chat's own tool runner;
//   · it is shown the conversation sized from the model's window and its
//     allowance a minute (js/model-limits.js, js/agent-context.js);
//   · its answer gets the chat's finishing checks (js/chat/finish.js), and
//     Python it says ran, when none ran, is sent back once to be run;
//   · what it does is written into the reply's record of the run, as before;
//   · a model that refuses tools on its first step falls back as it did, and
//     a run that ends at its limit with nothing said is asked once, with no
//     tools, for its answer.
//
// Agents move onto it one at a time (ON_LOOP), on a cloud model; a model on
// this computer keeps its own way of taking steps (js/chat/decide.js).
//
// Pure but for what it is handed. Published as window.HCChatAgentRun.
// Checked by scripts/checks/chat-agent-run.mjs.
// ==============================================================
(function () {
  'use strict';

  /** The agents that run on the shared loop, moved one at a time. */
  const ON_LOOP = ['builtin_url_reader', 'builtin_researcher', 'builtin_papers', 'builtin_deep_research'];
  const RAN_STEP = 'Sent back: Python it says ran, and none ran';
  /** The agents that may answer from what they know: their details are held to a source only once they have searched (js/chat/finish.js). */
  const FROM_KNOWLEDGE = ['builtin_hash_ai', 'builtin_coder'];

  /** Whether this agent, on this model, runs on the shared loop. */
  const onLoop = (agent, model) => !!agent && ON_LOOP.includes(agent.id) && !agent.lite && /^cloud:/.test(String(model || ''));

  const nameOf = (t) => (t && t.function ? t.function.name : t && t.name);
  const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

  /**
   * One run. `d`: agent, assistant (the reply), messages (built as the chat
   * builds them, memory in), tools (the agent's, shaped), tracker, temperature,
   * signal, onStatus, onFinalToken, model, request; call(messages, tools,
   * temperature, signal) one model turn through the chat's failover;
   * runTool(name, args, onStatus, tracker) the chat's tool runner, which
   * answers in JSON; record(assistant, type, label, data); typewriter(text,
   * onToken, signal); fallback() the run without tools; closing, the words
   * asking for an answer when no tool may be used.
   */
  async function run(d) {
    const loop = window.HCAgentLoop, F = window.HCChatFinish, Ctx = window.HCAgentContext, Lim = window.HCModelLimits, S = window.HCAgentShape, V = window.HCCodeVerify;
    const messages = d.messages, tools = d.tools || [], names = tools.map(nameOf);
    const request = String(d.request || '');
    const scope = {
      request, firstRequest: request, plan: null,
      asks: window.HCCodeAsks ? window.HCCodeAsks.split(request) : [],
      // Each tool through the chat's runner; an answer of { error } is a failed call.
      TOOL_DEFINITIONS: names.map((name) => ({ name, fn: async (args) => {
        const text = await d.runTool(name, args, d.onStatus, d.tracker);
        const r = parse(text);
        if (r && typeof r === 'object' && !Array.isArray(r) && typeof r.error === 'string' && Object.keys(r).length === 1) throw new Error(r.error);
        return text;
      } })),
    };
    const fixed = String((messages.find((m) => m && m.role === 'system') || {}).content || '').length + JSON.stringify(tools).length;
    const sized = Ctx && Ctx.optionsFor ? Ctx.optionsFor('full', false, Lim && Lim.forContext ? Lim.forContext(d.model, fixed) : null) : {};
    const compress = (msgs) => (Ctx && Ctx.compressHistory ? Ctx.compressHistory(msgs, sized) : msgs);
    const python = names.includes('execute_python');
    let found = null;
    const ui = {
      trace: () => {}, terminal: () => {}, changed: () => {}, added: () => {},
      status: (text, kind) => { if (d.onStatus) d.onStatus(text, kind === 'thinking' ? 'thinking' : 'running'); },
      wait: () => ({ finish() {}, remove() {} }),
      step: (s) => { if (s && s.verb === 'CHECK') { d.record(d.assistant, 'thinking', s.object); if (d.onStatus) d.onStatus(s.object, 'warn'); } },
      tool: (name, args) => { d.record(d.assistant, 'tool_call', name, args || {}); return { name }; },
      toolDone: (el, result) => d.record(d.assistant, 'tool_result', el && el.name, parse(result)),
      answer: () => {},
      error: (e) => d.record(d.assistant, 'error', String((e && e.message) || e)),
    };
    const checks = ({ sent }) => {
      const c = F.checks({ messages, sent, request: scope.request, knowledge: FROM_KNOWLEDGE.includes(d.agent && d.agent.id) });
      // Python the answer says ran, when none ran: sent back once to run it with the tool.
      const ran = { id: 'ran', words: true, run: async (reply) => {
        if (!python || sent.said || !S || !S.extractPythonFence || !S.claimsItRan) return null;
        const code = S.extractPythonFence(reply);
        if (!code || !S.claimsItRan(reply, code, request)) return null;
        return { kind: 'said', step: RAN_STEP, message: `${(V && V.APP_NOTE) || 'Note from HashCortX, not from the person:'} your answer shows Python code and says it ran, and none ran. Run it now with execute_python, then answer from what it printed, without showing the code again.` };
      } };
      return { finish: [...c.finish, ran], left: () => { const l = c.left(); found = l.found; return l; }, wrap: c.wrap };
    };
    let text;
    try {
      text = await loop.run({ scope, messages, tools, label: '', signal: d.signal, ui, temperature: d.temperature,
        state: { size: 'full', local: false, light: false, projectRoot: null, projectChecks: null, codeMap: null },
        prefs: () => ({ prove: true }), call: (m, t, temp, s) => d.call(m, t, temp, s), compress,
        queue: () => null, conversation: () => null, opened: () => {}, baseName: (p) => String(p || ''), toolObject: (name) => name, checks });
    } catch (e) {
      // A model that refuses tools, before any ran, answers without them as it did.
      if (!(d.signal && d.signal.aborted) && /tool|function/i.test(String((e && e.message) || '')) && !(d.tracker || []).length && d.fallback) {
        if (d.onStatus) d.onStatus("Model doesn't support tools — falling back to context injection", 'warn');
        return d.fallback();
      }
      throw e;
    }
    // Stopped with nothing said: asked once, with no tools, for its answer.
    if (!String(text || '').trim() && !(d.signal && d.signal.aborted) && d.closing) {
      try { text = ((await d.call([...messages, { role: 'user', content: d.closing }], [], d.temperature, d.signal)) || {}).content || ''; } catch (e) { d.record(d.assistant, 'error', `Could not write the final answer: ${(e && e.message) || e}`); }
    }
    const left = F.leftLine(found);
    let final = String(text || '');
    if (!final && (d.tracker || []).length) final = `The agent used ${d.tracker.length} tool${d.tracker.length === 1 ? '' : 's'} but did not write an answer. Ask again, or pick another model.`;
    if (final && left) final = `${final}\n\n*${left}*`;
    d.record(d.assistant, 'final', `Final answer · ${final.length} chars`);
    if (window.HCRanCode && d.tracker) d.assistant.ranCode = window.HCRanCode.keep(d.tracker.map((t) => t.output));
    if (final && d.typewriter) await d.typewriter(final, d.onFinalToken, d.signal);
    return final;
  }

  window.HCChatAgentRun = { ON_LOOP, FROM_KNOWLEDGE, RAN_STEP, onLoop, run };
})();
