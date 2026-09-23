// ============================================================
// chat/decide.js — a local agent decides, the app acts, then the model answers
//
// Offered its tools the usual way, a local model is asked to do two things
// at once: decide whether the request needs a tool, and write the call in
// the one form its server reads. Small models do the second well and the
// first badly. Measured on twelve everyday requests with an agent's own
// instructions and tools, a 7B coding model called the right tool for three:
// it answered questions about recent events from what it was trained on,
// worked out a percentage in its head and got it wrong, and said "noted"
// without saving anything.
//
// So a local agent's turn is taken in steps. First the model DECIDES, and
// only that: which tool, or none, with its arguments, in an answer held to a
// schema, so it cannot come back in any other shape. The app runs the tool
// and hands back the result, and the model decides again with the result in
// front of it. When it decides none, it ANSWERS, with no tools in play, so
// the answer streams into the chat as it is written. Asked this way, on those
// twelve requests and four more, the same 7B model chose right for fifteen of
// the sixteen, a 3B model for fifteen and a 4B model for all sixteen.
//
// When the request plainly needs one tool, or plainly none, the app takes
// that first step itself (js/chat/intent.js) and the model writes only the
// tool's arguments, or goes straight to its answer.
//
// Both steps are sent the same instructions and the same conversation, and
// differ only in the last message, so the model server reuses the work it
// did reading the shared part. What changes with each request — what is
// remembered — goes just before the request, not into the instructions.
//
// The loop takes its model calls and its tool runner as arguments, so it is
// pure and is checked without a network. Published as window.HCDecide.
// Run the checks with: npm run check:decide
// ============================================================
(function () {
  "use strict";

  /** When each of the app's tools is the one to choose. A tool not named here is described by its own words. */
  const WHEN = {
    web_search: "anything current, recent, or that may have changed since you were trained: news, prices, versions, results, who holds a post",
    wikipedia: "a settled fact about a person, place or subject",
    fetch_url: "a web address the person gave, to read it",
    pubmed_search: "medical or scientific research papers",
    search_knowledge: "the person's own documents and notes",
    current_datetime: "today's date, the time now, or the day of the week",
    calculate: "any arithmetic at all, however simple: sums, percentages, powers, dates apart",
    execute_python: "running code, or making a file, table, chart or document",
    remember_fact: "something the person tells you to remember, or states about themselves",
    recall_facts: "what you already know about the person",
  };

  const namesOf = (tools) => (tools || []).map((t) => (t && t.function) || t).filter((f) => f && f.name);

  /** The tools as the model is told them: what each takes, what it does, and when it is the one. */
  function guide(tools) {
    const lines = namesOf(tools).map((f) => {
      const props = (f.parameters && f.parameters.properties) || {};
      const req = new Set((f.parameters && f.parameters.required) || []);
      const args = Object.keys(props).map((k) => `${k}${req.has(k) ? "" : "?"}`).join(", ");
      const what = String(f.description || "").split("\n")[0];
      return `- ${f.name}(${args}): ${what}${WHEN[f.name] ? ` Choose it for ${WHEN[f.name]}.` : ""}`;
    });
    return [
      "You have tools, which the app runs for you. Your own knowledge stops at a date in the past, and you cannot do exact arithmetic in your head: use a tool whenever the request needs one.",
      "Tools:",
      ...lines,
    ].join("\n");
  }

  /**
   * The shape a decision must take: one tool the agent has, with arguments in
   * that tool's own shape, or none. `only` narrows it to one tool the app has
   * already chosen, so the model writes only its arguments; `none: false`
   * leaves none out, when the app knows the request needs a tool but not which.
   */
  function schema(tools, only, { none = true } = {}) {
    const one = (name, params) => ({
      type: "object",
      properties: { tool: { type: "string", enum: [name] }, arguments: params && typeof params === "object" ? params : { type: "object" } },
      required: ["tool", "arguments"],
    });
    const list = namesOf(tools).filter((f) => !only || f.name === only);
    const shapes = list.map((f) => one(f.name, f.parameters));
    if (!only && none) shapes.push(one("none", { type: "object" }));
    return shapes.length === 1 ? shapes[0] : { anyOf: shapes };
  }

  const DECIDE = "Before you answer my last message: does it need one of your tools now? Reply with the tool and its arguments. Reply with the tool none when you can answer it yourself: when I ask you to write, rewrite, explain, summarise, plan or give an opinion, for knowledge that does not change, or when the tool results above already answer it.";
  const MUST = "My last message needs what one of your tools returns. Reply with the tool that returns it and its arguments.";
  const ANSWER = "Now answer my last message, using the tool results above where they help. Say only what answers it: the figures, names and dates it asks for, exactly as the tools gave them, in your own words and full sentences.";

  /** A decision read from the model's answer, or null when it is not one. */
  function read(text, tools) {
    let v = null;
    try { v = JSON.parse(String(text || "").trim()); } catch { return null; }
    if (!v || typeof v !== "object" || typeof v.tool !== "string") return null;
    const known = new Set(namesOf(tools).map((f) => f.name));
    if (v.tool === "none") return { tool: "none", arguments: {} };
    if (!known.has(v.tool)) return null;
    return { tool: v.tool, arguments: v.arguments && typeof v.arguments === "object" && !Array.isArray(v.arguments) ? v.arguments : {} };
  }

  /**
   * One agent turn taken in steps. `messages` is the conversation, its first
   * message the agent's instructions and its last message from the person the
   * request; `ask(messages, schema)` returns a decision's raw text;
   * `answer(messages, toolsRun)` streams the answer and returns it; `runTool(call)` runs
   * a tool and returns its result as text; `shape` is js/agent-shape.js;
   * `route(text)` is the app's own first step when the request is plain
   * (js/chat/intent.js); `context` is what changes from one request to the
   * next, such as what is remembered, and goes just before the request, so
   * everything before it stays the same and is read only once; `onEvent(kind,
   * detail)` hears each step; `needsTool` says the app knows the request needs
   * a tool, so the first decision must name one — answering a question about a
   * connected system's records without reading them could only invent them.
   * Returns { text, calls }.
   */
  async function run({ messages, tools, ask, answer, runTool, shape, route, context, onEvent = () => {}, maxSteps = 6, needsTool = false }) {
    const convo = messages.slice();
    const sys = convo.findIndex((m) => m.role === "system");
    const told = guide(tools);
    if (sys >= 0) convo[sys] = { ...convo[sys], content: `${convo[sys].content}\n\n${told}` };
    else convo.unshift({ role: "system", content: told });
    let at = convo.length - 1;
    while (at >= 0 && convo[at].role !== "user") at--;
    const request = at >= 0 ? String(convo[at].content || "") : "";
    if (context && at >= 0) convo.splice(at, 0, { role: "system", content: context });

    const names = namesOf(tools).map((f) => f.name);
    const done = new Set();
    const calls = [];
    const act = async (call) => {
      onEvent("tool_call", call);
      shape.appendAssistantToolCallTurn(convo, "", [call]);
      shape.appendToolResult(convo, call, await runTool(call));
      calls.push(call);
    };
    const plain = route ? route(request) : null;
    for (let step = 1; step <= maxSteps; step++) {
      let decision;
      if (step === 1 && plain && plain.tool === "none") break;
      if (step === 1 && plain && plain.arguments) decision = { tool: plain.tool, arguments: plain.arguments };
      else {
        onEvent("deciding", step);
        const only = step === 1 && plain ? plain.tool : undefined;
        const must = needsTool && !calls.length;
        decision = read(await ask([...shape.toolTurnsInWords(convo), { role: "user", content: must ? MUST : DECIDE }], schema(tools, only, { none: !must })), tools);
      }
      if (!decision || decision.tool === "none") break;
      const key = `${decision.tool} ${JSON.stringify(decision.arguments)}`;
      if (done.has(key)) break;   // the same call again: its result is already here
      done.add(key);
      await act({ id: `call_${step}_${decision.tool}`, name: decision.tool, arguments: decision.arguments });
    }
    const tail = () => (calls.length ? [{ role: "user", content: ANSWER }] : []);
    onEvent("answering", calls.length);
    let text = await answer([...shape.toolTurnsInWords(convo), ...tail()], calls.length);
    // An answer that is itself a call, written in words: run it once and answer again.
    const late = shape.toolCallsInText(text, names)[0];
    if (late && calls.length < maxSteps && !done.has(`${late.name} ${JSON.stringify(late.arguments)}`)) {
      await act({ id: `call_late_${late.name}`, name: late.name, arguments: late.arguments || {} });
      onEvent("answering", calls.length);
      text = await answer([...shape.toolTurnsInWords(convo), ...tail()], calls.length);
    }
    return { text, calls };
  }

  /**
   * An answer shown as it streams, except one that opens like a call, which is
   * held back until it is whole: shown then if it is not a call. `show(text)`
   * adds text to the reply on screen.
   */
  function shower(show) {
    let shown = 0;
    return {
      onToken: (delta, full) => {
        if (!shown && full.length < 400 && /^\s*(?:[{[<]|`{3}(?:json|tool))/i.test(full)) return;
        show(full.slice(shown));
        shown = full.length;
      },
      finish: (text, isCall) => { if (!isCall && text.length > shown) show(text.slice(shown)); },
    };
  }

  /** What the person is told each step is doing. */
  const statusOf = (kind, n) => (kind === "deciding"
    ? (n === 1 ? "Deciding what the request needs…" : `Deciding the next step (${n})…`)
    : (n ? "Writing the answer from the results…" : "Writing the answer…"));

  /** The reply that stands: the answer, unless it is a call or empty, when the tools that ran are named instead. */
  function replyOf(text, names, used, shape) {
    if (text && !shape.toolCallsInText(text, names).length) return text;
    return used ? `The agent used ${used} tool${used === 1 ? "" : "s"} but did not write an answer. Ask again, or pick another model.` : "";
  }

  window.HCDecide = { shower, statusOf, replyOf, guide, schema, read, run, WHEN, DECIDE, MUST, ANSWER };
})();
