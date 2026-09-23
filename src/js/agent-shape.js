// ==============================================================
// The shape of what an agent sends and reads back
//
// Every provider wants the same conversation described differently: images as
// content blocks, tools as a function list or as functionDeclarations, tool
// results as their own role. These are the translations.
//
// They are worth testing rather than trusting because a mistake here does not
// throw — it produces a request the provider accepts and answers badly. A
// dropped image is a model that says it cannot see an attachment; a tool list
// built for the wrong provider is a model that never calls a tool and gives a
// vaguer answer instead. Neither looks like a bug from the outside.
//
// The tool table is passed in rather than imported: the definitions in app.js
// carry the functions that run them, which are not this file's business.
//
// Pure: no DOM, no storage, no network.
// Loaded before app.js and published as window.HCAgentShape.
// Checked by scripts/checks/agent-shape.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * What kind of image this actually is, read from its own first bytes.
   *
   * Images travel through this app as bare base64 with no type beside them,
   * and every provider was told "image/jpeg" regardless. OpenAI sniffs the
   * bytes and forgives it; Anthropic validates media_type against the data and
   * rejects a mismatch outright. So a PNG — which is what a screenshot is —
   * was being sent to Anthropic labelled as a JPEG and refused, and the reply
   * read as a provider problem rather than as this app mislabelling the file.
   *
   * Base64 encodes three bytes into four characters, so a file's magic number
   * lands in a fixed prefix of the string and can be recognised without
   * decoding anything.
   */
  function imageMimeFromBase64(base64) {
    const head = String(base64 || '').slice(0, 16);
    if (head.startsWith('iVBORw0KGgo')) return 'image/png';
    if (head.startsWith('R0lGOD')) return 'image/gif';
    if (head.startsWith('UklGR')) return 'image/webp';
    if (head.startsWith('PHN2Zy') || head.startsWith('PD94bW')) return 'image/svg+xml';
    // JPEG, and the fallback: it is the most common of these by far, and it is
    // what everything was labelled as before, so an unknown format is no worse
    // off than it already was.
    return 'image/jpeg';
  }

  /**
   * Rewrite messages into the content-block form providers use for vision.
   *
   * A message with no image keeps the plain string form — some providers
   * reject a content array on a text-only message, and it reads better in a
   * log. A message WITH images becomes a text block plus one block per image.
   */
  function toOpenAIVision(messages) {
    return (messages || []).map((m) => {
      if (!m.images?.length) return { role: m.role, content: m.content || '' };
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content || 'Describe what you see.' },
          ...m.images.map((b64) => ({
            type: 'image_url',
            image_url: { url: `data:${imageMimeFromBase64(b64)};base64,${b64}` },
          })),
        ],
      };
    });
  }

  /** Drop images and keep only the text, for a provider that cannot see. */
  function toTextOnly(messages) {
    return (messages || []).map((m) => ({ role: m.role, content: m.content || '' }));
  }

  /**
   * The tool names an agent's selections actually map to.
   *
   * Some of what the user picks is a bundle rather than a tool: choosing
   * "memory" enables both remembering and recalling, and several others are
   * stored under a friendlier name than the tool carries. A Set is used
   * because two selections can expand to the same tool, and offering a
   * provider the same function twice is an error on several of them.
   */
  function agentToolNames(agent, toolTable) {
    if (!agent || !Array.isArray(agent.tools) || !toolTable) return [];
    const out = new Set();
    for (const t of agent.tools) {
      if (t === 'memory') { out.add('remember_fact'); out.add('recall_facts'); }
      else if (t === 'datetime') out.add('current_datetime');
      else if (t === 'pubmed') out.add('pubmed_search');
      else if (t === 'knowledge') out.add('search_knowledge');
      else if (t === 'code_interpreter' || t === 'python') out.add('execute_python');
      else if (toolTable[t]) out.add(t);
    }
    // A name that survived the mapping but has no definition would be sent to
    // the provider as a function with no description, so drop it here.
    return [...out].filter((name) => toolTable[name]);
  }

  /** The OpenAI tools array. Ollama accepts this shape unchanged. */
  function buildOpenAITools(agent, toolTable) {
    return agentToolNames(agent, toolTable).map((name) => ({
      type: 'function',
      function: {
        name,
        description: toolTable[name].description,
        parameters: toolTable[name].parameters,
      },
    }));
  }

  /** Gemini wants the same list wrapped in functionDeclarations. */
  function buildGeminiTools(agent, toolTable) {
    const decls = agentToolNames(agent, toolTable).map((name) => ({
      name,
      description: toolTable[name].description,
      parameters: toolTable[name].parameters,
    }));
    // An empty tools array is not the same as no tools: some providers reject
    // it outright rather than reading it as "none".
    return decls.length ? [{ functionDeclarations: decls }] : [];
  }

  /**
   * The message that puts an opened image in front of the model.
   *
   * A tool hands back text, and no provider looks at an image that arrives as
   * text — it is only seen when it is part of a message. So view_image queues
   * what it read and the agent loop attaches it here, straight after the tool
   * results, which puts the picture in front of the model on the very next
   * turn rather than a turn later.
   *
   * A user message rather than a tool one, because a tool result carrying an
   * image is rejected by several providers, and this is the form all of them
   * already accept.
   */
  function visionMessage(items) {
    const list = (items || []).filter((v) => v && v.base64);
    const names = list.map((v) => v.name || 'image').join(', ');
    return {
      role: 'user',
      content: list.length === 1
        ? `This is ${names}, the image you opened.`
        : `These are the images you opened: ${names}.`,
      images: list.map((v) => v.base64),
    };
  }

  /**
   * The Gemini form of a tool list, whatever form it arrives in.
   *
   * Gemini does not take the OpenAI array. It wants one entry holding a
   * `functionDeclarations` list, and it rejects the OpenAI shape outright with
   * "Unknown name \"type\" at 'tools[0]'" — which surfaces as a 400 from the
   * provider and reads like a bad key or a bad model, not like a body this app
   * built wrong.
   *
   * That is what happened: modes build their tools in OpenAI shape, because
   * most providers take it, and hand the array straight through. Every Gemini
   * call carrying tools failed, and failover to Gemini could never succeed.
   *
   * Converting here rather than in each caller is the same reasoning as
   * routeModelTurn itself: a provider that needs its own shape needs it
   * written down once. Already-Gemini input passes through unchanged, so a
   * caller that builds the right shape itself is not punished for it.
   */
  function toGeminiTools(tools) {
    const list = Array.isArray(tools) ? tools : [];
    if (!list.length) return [];
    if (list.some((t) => t && Array.isArray(t.functionDeclarations))) return list;
    const decls = list
      .map((t) => (t && t.type === 'function' && t.function) ? t.function : t)
      .filter((f) => f && typeof f.name === 'string' && f.name)
      .map((f) => ({
        name: f.name,
        description: f.description || '',
        parameters: f.parameters || { type: 'object', properties: {} },
      }));
    return decls.length ? [{ functionDeclarations: decls }] : [];
  }

  /**
   * Record the assistant's turn that asked for tools.
   *
   * Arguments are serialised because that is how the providers send them back
   * and expect to see them again; passing the object through produces a
   * request that is accepted and then misread.
   */
  function appendAssistantToolCallTurn(messages, content, toolCalls) {
    messages.push({
      role: 'assistant',
      content: content || '',
      tool_calls: (toolCalls || []).map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
        ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
      })),
    });
  }

  /**
   * Gemini 3 signs each tool call it makes and refuses the next turn unless
   * the signature comes back with the call ("Function call is missing a
   * thought_signature"), so every Gemini agent failed at its second step. The
   * signature is kept on the call for Gemini; a call another model made has
   * none, and Google's documented stand-in lets Gemini carry on from it.
   */
  const FOREIGN_CALL_SIGNATURE = 'skip_thought_signature_validator';
  const signatureFor = (call) => (call && call.thoughtSignature) || FOREIGN_CALL_SIGNATURE;

  /**
   * A tool call a model wrote as text, in any of the ways local models write
   * one (js/tool-text.js), to tools the agent has. The raw call used to be
   * shown as the answer for every way but three.
   */
  function toolCallsInText(text, names) {
    return window.HCToolText.callsIn(text, names).map((c) => ({ name: c.name, arguments: safeJsonParse(c.arguments) || {} }));
  }

  /**
   * What Ollama is sent: a call's arguments as an object, which is how it reads
   * them, where the conversation keeps the string the cloud APIs send.
   */
  function forOllama(messages) {
    return withoutSignatures(messages).map((m) => (Array.isArray(m.tool_calls)
      ? { ...m, tool_calls: m.tool_calls.map((c) => ({ ...c, function: { ...c.function, arguments: safeJsonParse(c.function && c.function.arguments) || {} } })) }
      : m));
  }

  /**
   * The calls and results in a conversation written as words: a call as the
   * tagged call it was, a result as a message in the person's turn. Every
   * model's template reads that, including one that drops tool turns.
   */
  const markSource = (text) => (typeof window !== 'undefined' && window.HCSources ? window.HCSources.mark(text) : text);

  function toolTurnsInWords(messages) {
    const out = [];
    for (const m of withoutSignatures(messages)) {
      // A result is material, not instructions: a sentence in it speaking to the model is marked (js/chat/sources.js).
      if (m.role === 'tool') { out.push({ role: 'user', content: `Result of ${m.name || 'the tool'}:\n${markSource(m.content || '')}` }); continue; }
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const calls = m.tool_calls.map((c) => `<tool_call>${JSON.stringify({ name: c.function && c.function.name, arguments: safeJsonParse(c.function && c.function.arguments) || {} })}</tool_call>`);
        out.push({ role: 'assistant', content: [m.content, ...calls].filter(Boolean).join('\n') });
        continue;
      }
      out.push({ role: m.role, content: m.content || '', ...(m.images ? { images: m.images } : {}) });
    }
    return out;
  }

  /**
   * A conversation for a model that cannot take tools: the tools described in
   * its instructions, with one way to call them, and the calls and results so
   * far written as words. Such a model's template drops a tool-result turn
   * altogether, so each result goes back as a message in the person's turn.
   * Its calls are then read from its answer (js/tool-text.js).
   */
  function toolsInWords(messages, tools) {
    const list = (tools || []).map((t) => (t && t.function) || t).filter((f) => f && f.name);
    if (!list.length) return forOllama(messages);
    const line = (f) => {
      const props = (f.parameters && f.parameters.properties) || {};
      const req = new Set((f.parameters && f.parameters.required) || []);
      const args = Object.entries(props).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${(v && v.type) || 'string'}`).join(', ');
      return `- ${f.name}(${args}): ${String(f.description || '').split('\n')[0]}`;
    };
    const guide = [
      'You can use these tools. To use one, reply with only the call, in exactly this form, and nothing else:',
      '<tool_call>{"name": "tool_name", "arguments": {"argument": "value"}}</tool_call>',
      'Its result comes back to you in the next message. Use one tool at a time. When you need no tool, answer in plain words.',
      '',
      'Tools:',
      ...list.map(line),
    ].join('\n');
    const out = toolTurnsInWords(messages);
    const sys = out.findIndex((m) => m.role === 'system');
    if (sys >= 0) out[sys] = { ...out[sys], content: `${out[sys].content}\n\n${guide}` };
    else out.unshift({ role: 'system', content: guide });
    return out;
  }

  /**
   * Ollama's reply as the loop reads it: the calls in the field for them, or
   * failing that, a reply that is nothing but calls written as text.
   */
  function ollamaReply(msg, tools) {
    const given = Array.isArray(msg && msg.tool_calls) ? msg.tool_calls : [];
    const written = given.length ? [] : toolCallsInText(msg && msg.content, (tools || []).map((t) => t && t.function && t.function.name));
    const calls = [...given, ...written].map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`,
      name: (c.function && c.function.name) || c.name,
      // Ollama returns an object where the cloud APIs return a JSON string.
      arguments: typeof (c.function && c.function.arguments) === 'string'
        ? safeJsonParse(c.function.arguments)
        : ((c.function && c.function.arguments) || c.arguments || {}),
    }));
    return { content: written.length ? '' : ((msg && msg.content) || ''), calls };
  }

  /**
   * Whether a reply that shows Python, when nothing was run, speaks as if it
   * had been: a file it says it saved, code that writes one, or a result
   * stated under code that prints it — or any code that prints, when the
   * person asked for it to be run. Such code is run, and the model answers
   * again from what really happened; code merely shown is left alone.
   */
  function claimsItRan(text, code, asked = '') {
    const t = String(text || '');
    const c = String(code || '');
    if (/\/output\//.test(c)) return true;
    if (/\bprint\s*\(/.test(c) && /\b(?:run|execute)\b[^.\n]{0,30}\b(?:it|this|code|python)\b|\bin python\b/i.test(String(asked))) return true;
    if (/\b(downloaded|saved|created|generated|exported)\b/i.test(t) && /\/output\//.test(t)) return true;
    const after = window.HCFences.splitFences(t).filter((p) => p.type === 'text').pop();
    return /\bprint\s*\(/.test(c) && !!after && /\b(?:result|output)\s*(?:is\b|:)/i.test(after.text);
  }

  /**
   * Every system message as one, for the providers that take the rules apart
   * from the conversation (Gemini, Anthropic). They read only the first, so a
   * note added later in a conversation — what an automatic Python run really
   * printed, the text of a pasted link — was dropped without a word.
   */
  function systemOf(messages) {
    const all = (messages || []).filter((m) => m && m.role === 'system' && m.content);
    return all.length ? { role: 'system', content: all.map((m) => m.content).join('\n\n') } : null;
  }

  /** A conversation's tool calls without what only Gemini reads, for every other provider. */
  function withoutSignatures(messages) {
    return (messages || []).map((m) => (m && Array.isArray(m.tool_calls)
      ? { ...m, tool_calls: m.tool_calls.map(({ thoughtSignature, ...c }) => c) }
      : m));
  }

  /** Record what a tool returned, against the call that asked for it. */
  function appendToolResult(messages, call, resultStr) {
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.name,
      content: resultStr,
    });
  }

  /**
   * End a turn that was cut off, so the conversation can carry on.
   *
   * A run stopped or failed between asking for tools and receiving all their
   * results leaves an assistant turn whose tool calls are not all answered,
   * and the providers refuse a conversation in that state, so the next message
   * failed. Each unanswered call gets a result saying why it did not run, and
   * a short assistant note closes the turn. What already ran stays, so the
   * next message still knows what was done.
   */
  function closeInterruptedTurn(messages, why) {
    let open = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role === 'tool') continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) open = i;
      break;
    }
    if (open !== -1) {
      const answered = new Set(messages.slice(open + 1).map((m) => m && m.tool_call_id));
      for (const c of messages[open].tool_calls) {
        if (!answered.has(c.id)) {
          messages.push({ role: 'tool', tool_call_id: c.id, name: c.function?.name || c.name, content: JSON.stringify({ error: why }) });
        }
      }
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || Array.isArray(last.tool_calls)) {
      messages.push({ role: 'assistant', content: `(${why})` });
    }
    return messages;
  }

  /**
   * Read tool arguments that arrive as a JSON string.
   *
   * Providers disagree: some send an object, some a string. A string that does
   * not parse becomes an empty object rather than throwing, because a model
   * writing malformed arguments should cost one bad tool call, not the run.
   */
  function safeJsonParse(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return {}; }
  }

  /**
   * Pull python out of the fenced blocks in a reply.
   *
   * Two mangles are undone because models produce them constantly: markdown
   * auto-linking turns `wb.save(...)` into `[wb.save](http://wb.save)`, and
   * smart quotes arrive instead of straight ones. Both make the code fail to
   * run for a reason that has nothing to do with the code.
   *
   * Blocks are found by src/js/fences.js. The pattern that stood here took the
   * closing fence of a block in another language for an opening one, so a
   * reply that showed some JavaScript and then the Python ran the sentence in
   * between as the program and dropped the Python.
   */
  function extractPythonFence(text) {
    if (!text) return '';
    const fences = window.HCFences.blocksIn(text, ['python', 'py', 'python3', '']);
    if (!fences.length) return '';
    let code = fences.join('\n\n');
    code = code.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    code = code.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    return code.trim();
  }

  /**
   * Which adapter a selected model needs.
   *
   * The provider list comes from the provider table rather than being written
   * out again here: this used to carry its own copy of "these eight are
   * OpenAI-shaped", which is a list that goes stale the moment a provider is
   * added anywhere else.
   */
  function selectAgentAdapter(modelValue, { parseCloudModel, providers }) {
    const value = String(modelValue || '');
    if (!value.startsWith('cloud:')) return { kind: 'ollama', model: value };
    const { provider, modelId } = parseCloudModel(value);
    // The provider is kept on every cloud adapter, because a failed call names
    // its model from it (tagged, below). Without it a Gemini or Anthropic
    // failure named a bare "gemini-2.5-pro", which the routing reads as a local
    // model — and a local job is never handed to the cloud, so nothing took over.
    if (provider === 'gemini') return { kind: 'gemini', provider, model: modelId };
    if (provider === 'anthropic') return { kind: 'anthropic', provider, model: modelId };
    if (providers && providers.get(provider)) return { kind: 'openai', provider, model: modelId };
    throw new Error(`Unknown cloud provider for agent mode: ${provider}`);
  }

  /**
   * Send one turn to whichever client the selected model needs.
   *
   * This decision was written out five times — in chat, Coder, Finance, ERP,
   * Swarm and Virtual OS — and three of those copies were wrong in the same
   * way: they sent everything that was not Gemini to the OpenAI client,
   * including Anthropic. That posts an OpenAI body to /v1/messages, which
   * requires max_tokens and never answers with `choices`, so the call failed
   * every single time a Claude model was picked. ERP looked like it hung
   * because a failure there is a failover, so it walked the whole provider
   * list twice before giving up.
   *
   * The clients arrive as `fns` so this stays pure and the routing can be
   * checked without a network. `tools` may be a function of the adapter kind,
   * because each client takes a different tool shape and Swarm builds them
   * per call.
   */
  /**
   * A failed call says which model failed. A run can ask several models in
   * turn, and js/model-routes.js retires the model an error names — blaming
   * the wrong one retires a model that works.
   */
  function tagged(result, model) {
    if (!result || typeof result.then !== 'function') return result;
    return result.then((turn) => {
      if (turn && typeof turn === 'object') turn.cutOff = wasCutOff(turn);
      return turn;
    }, (err) => {
      if (err && typeof err === 'object' && !err.model) err.model = model;
      throw err;
    });
  }

  /**
   * Whether an answer stopped because it hit the length limit rather than
   * because it was finished. Each provider says so differently: OpenAI and
   * Ollama "length", Gemini "MAX_TOKENS", Anthropic "max_tokens". Nothing read
   * it, so a web page cut off mid-tag was taken as the finished file.
   */
  function wasCutOff(turn) {
    const raw = (turn && turn.raw) || {};
    const why = (turn && turn.finish) || (raw.candidates && raw.candidates[0] && raw.candidates[0].finishReason) || raw.stop_reason || '';
    return /^(length|max_tokens)$/i.test(String(why));
  }

  const CONTINUE = 'Your answer was cut off by the length limit. Continue exactly where it stopped: no repeating, no introduction, and do not open again a code block that is already open.';

  /**
   * An answer that was cut off, carried on until it is finished or `max` more
   * turns have been asked for. `ask(messages)` makes one more call on the same
   * model. The result says whether it is still cut off, so a caller can say so
   * rather than pass half a file on as a whole one.
   */
  async function finishCutOff(ask, messages, first, max = 3) {
    let turn = first;
    let text = (first && first.content) || '';
    let more = 0;
    while (turn && turn.cutOff && !turn.tool_calls && more < max) {
      more++;
      turn = await ask([...messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE }]);
      text += (turn && turn.content) || '';
    }
    return { ...(turn || {}), content: text, cutOff: !!(turn && turn.cutOff), continued: more };
  }

  /**
   * `untilFinished` carries on an answer that hit the length limit (see
   * finishCutOff) and says on the result whether it had to, and whether it
   * is still cut off.
   */
  function routeModelTurn(request, fns, deps) {
    const started = Date.now();
    const first = routeLearning(request, fns, deps);
    if (!first || typeof first.then !== 'function') return first;
    // A continuation is the rest of an answer, not a whole one: not held to JSON.
    const again = (messages) => routeOnce({ ...request, messages, json: undefined }, fns, deps);
    const whole = request.untilFinished ? first.then((turn) => (turn && turn.cutOff ? finishCutOff(again, request.messages, turn) : turn)) : first;
    // How long the answer took is kept, so a model is chosen by how it answers
    // as well as by its name — js/model-speed.js.
    return whole.then((turn) => {
      const S = typeof window !== 'undefined' && window.HCModelSpeed;
      const text = String((turn && turn.content) || '');
      if (S && request.modelValue && text.trim()) S.record(request.modelValue, { ms: Date.now() - started, chars: text.length });
      return turn;
    });
  }

  /**
   * A refusal that names a limit — a per-minute budget, a longest answer, a
   * parameter the model will not take — is learnt (js/model-limits.js) and the
   * request sent once more, sized by it. Only when what is left still holds
   * the question and an answer of `request.need` tokens; otherwise the error
   * stands and the job goes to another model.
   */
  function routeLearning(request, fns, deps) {
    const call = routeOnce(request, fns, deps);
    const L = typeof window !== 'undefined' && window.HCModelLimits;
    if (!L || !call || typeof call.then !== 'function') return call;
    return call.catch((err) => {
      const value = err && err.model;
      if (!value || !L.learn(value, err, L.estimateTokens([request.messages, request.tools]), request.need || 0).retry) throw err;
      return routeOnce(request, fns, deps);
    });
  }

  // `json`: the answer must be JSON — true, or the JSON schema it must match.
  // Honoured by Ollama, where the small models that most often answer in the
  // wrong shape run; a cloud model is only told so in its prompt.
  function routeOnce({ modelValue, adapter, messages, tools, temperature, signal, json, need }, fns, deps) {
    const route = adapter || selectAgentAdapter(modelValue, deps);
    const list = typeof tools === 'function' ? tools(route.kind) : (tools || []);
    // Gemini is the one provider whose tool list is shaped differently, and a
    // caller handing over the OpenAI array is the normal case rather than a
    // mistake worth failing on. Shaped here so no mode has to remember.
    const shaped = route.kind === 'gemini' ? toGeminiTools(list) : list;
    const base = { model: route.model, messages, tools: shaped, temperature, signal, ...(json ? { json } : {}), ...(need ? { need } : {}) };
    const who = modelValue || (route.provider ? `cloud:${route.provider}:${route.model}` : route.model);
    if (route.kind === 'ollama') return tagged(fns.ollama(base), who);
    if (route.kind === 'gemini') return tagged(fns.gemini(base), who);
    if (route.kind === 'anthropic') return tagged(fns.anthropic(base), who);
    if (route.kind === 'openai') return tagged(fns.openai({ ...base, provider: route.provider }), who);
    // Never fall through to the OpenAI client. That default is exactly what
    // sent Anthropic the wrong body: a provider nobody routed became one
    // silently shaped like OpenAI, and the failure looked like a bad key.
    throw new Error(`No client for model adapter: ${route.kind}`);
  }

  window.HCAgentShape = {
    closeInterruptedTurn,
    wasCutOff,
    finishCutOff,
    imageMimeFromBase64,
    visionMessage,
    toOpenAIVision,
    toTextOnly,
    agentToolNames,
    buildOpenAITools,
    buildGeminiTools,
    toGeminiTools,
    appendAssistantToolCallTurn,
    appendToolResult,
    signatureFor,
    withoutSignatures,
    toolCallsInText,
    systemOf,
    claimsItRan,
    forOllama,
    toolsInWords,
    toolTurnsInWords,
    ollamaReply,
    FOREIGN_CALL_SIGNATURE,
    safeJsonParse,
    extractPythonFence,
    selectAgentAdapter,
    routeModelTurn,
  };
})();
