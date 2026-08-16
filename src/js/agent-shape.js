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
            image_url: { url: `data:image/jpeg;base64,${b64}` },
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
      })),
    });
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
   */
  function extractPythonFence(text) {
    if (!text) return '';
    const fences = [];
    const re = /```(?:python|py)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(text)) !== null) fences.push(m[1]);
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
    if (provider === 'gemini') return { kind: 'gemini', model: modelId };
    if (provider === 'anthropic') return { kind: 'anthropic', model: modelId };
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
  function routeModelTurn({ modelValue, adapter, messages, tools, temperature, signal }, fns, deps) {
    const route = adapter || selectAgentAdapter(modelValue, deps);
    const list = typeof tools === 'function' ? tools(route.kind) : (tools || []);
    // Gemini is the one provider whose tool list is shaped differently, and a
    // caller handing over the OpenAI array is the normal case rather than a
    // mistake worth failing on. Shaped here so no mode has to remember.
    const shaped = route.kind === 'gemini' ? toGeminiTools(list) : list;
    const base = { model: route.model, messages, tools: shaped, temperature, signal };
    if (route.kind === 'ollama') return fns.ollama(base);
    if (route.kind === 'gemini') return fns.gemini(base);
    if (route.kind === 'anthropic') return fns.anthropic(base);
    if (route.kind === 'openai') return fns.openai({ ...base, provider: route.provider });
    // Never fall through to the OpenAI client. That default is exactly what
    // sent Anthropic the wrong body: a provider nobody routed became one
    // silently shaped like OpenAI, and the failure looked like a bad key.
    throw new Error(`No client for model adapter: ${route.kind}`);
  }

  window.HCAgentShape = {
    toOpenAIVision,
    toTextOnly,
    agentToolNames,
    buildOpenAITools,
    buildGeminiTools,
    toGeminiTools,
    appendAssistantToolCallTurn,
    appendToolResult,
    safeJsonParse,
    extractPythonFence,
    selectAgentAdapter,
    routeModelTurn,
  };
})();
