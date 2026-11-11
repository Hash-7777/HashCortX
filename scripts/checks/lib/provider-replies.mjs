// ==============================================================
// Invented provider replies, in each provider's own shape
//
// The bodies a model service answers with, written out by hand so a change
// to how the app reads them can be proven with no model and no key: a reply
// carrying the model's thinking in each shape the app reads (the shapes are
// the adapter kinds in js/agent-shape.js), a refusal naming a field, a
// refusal for a sampling setting, a refusal for the limit a minute, and a
// reply with nothing in it.
//
// Each entry says where in its body its parts are, as a path for `at`, so a
// check reads the reply the way the entry describes it and fails when the
// two drift apart. The words, figures and names are all invented.
//
// Checked by scripts/checks/provider-replies.mjs; used by later checks.
// ==============================================================

/** The shapes of reply the app reads: the adapter kinds in js/agent-shape.js. */
export const SHAPES = ['openai', 'anthropic', 'gemini', 'ollama'];

/** The value at `path` (keys and indexes) in `body`, or undefined. */
export const at = (body, path) => (path || []).reduce((v, k) => (v == null ? undefined : v[k]), body);

const THOUGHT = 'Add the two rates first, then round once at the end.';
const ANSWER = 'The total is 42.50.';

/** A reply that carries the model's thinking apart from its answer, one or more for each shape. */
export const thinkingReplies = [
  {
    name: 'openai, thinking as reasoning_content', shape: 'openai', status: 200,
    body: { id: 'reply_1', object: 'chat.completion', model: 'invented-model', choices: [{ index: 0, message: { role: 'assistant', content: ANSWER, reasoning_content: THOUGHT }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 14, total_tokens: 34 } },
    thinking: ['choices', 0, 'message', 'reasoning_content'], answer: ['choices', 0, 'message', 'content'],
  },
  {
    name: 'openai, thinking as reasoning', shape: 'openai', status: 200,
    body: { id: 'reply_2', object: 'chat.completion', model: 'invented-model', choices: [{ index: 0, message: { role: 'assistant', content: ANSWER, reasoning: THOUGHT }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 14, total_tokens: 34 } },
    thinking: ['choices', 0, 'message', 'reasoning'], answer: ['choices', 0, 'message', 'content'],
  },
  {
    name: 'anthropic, a thinking block before the text', shape: 'anthropic', status: 200,
    body: { id: 'reply_3', type: 'message', role: 'assistant', model: 'invented-model', content: [{ type: 'thinking', thinking: THOUGHT, signature: 'invented-signature-1' }, { type: 'text', text: ANSWER }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 14 } },
    thinking: ['content', 0, 'thinking'], answer: ['content', 1, 'text'],
  },
  {
    name: 'gemini, a part marked as thought', shape: 'gemini', status: 200,
    body: { candidates: [{ content: { role: 'model', parts: [{ text: THOUGHT, thought: true }, { text: ANSWER, thoughtSignature: 'invented-signature-2' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 6, thoughtsTokenCount: 8 } },
    thinking: ['candidates', 0, 'content', 'parts', 0, 'text'], answer: ['candidates', 0, 'content', 'parts', 1, 'text'],
  },
  {
    name: 'ollama, thinking beside the content', shape: 'ollama', status: 200,
    body: { model: 'invented-model', message: { role: 'assistant', content: ANSWER, thinking: THOUGHT }, done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 14 },
    thinking: ['message', 'thinking'], answer: ['message', 'content'],
  },
];

/**
 * Refusals, each with the provider whose words it is in, the field it names
 * or the limit it states, and the kind of failure it is (js/model-routes.js
 * failureKind).
 */
export const refusals = [
  {
    name: 'a field the model does not take', provider: 'openai', status: 400, kind: 'other', field: 'max_tokens',
    body: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' } },
  },
  {
    name: 'a sampling setting the model does not take', provider: 'openai', status: 400, kind: 'other', field: 'temperature',
    body: { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } },
  },
  {
    name: 'the limit a minute', provider: 'openai', status: 429, kind: 'limit', tpm: 6000, retryAfter: '7',
    body: { error: { message: 'Rate limit reached for invented-model on tokens per min (TPM): Limit 6000, Used 5800, Requested 900. Please try again in 7s.', type: 'tokens', code: 'rate_limit_exceeded' } },
  },
];

/** A reply that arrived whole and says nothing: no words and no call. */
export const emptyReplies = [
  {
    name: 'openai, an empty message', shape: 'openai', status: 200,
    body: { id: 'reply_4', object: 'chat.completion', model: 'invented-model', choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 } },
    answer: ['choices', 0, 'message', 'content'], calls: ['choices', 0, 'message', 'tool_calls'],
  },
];
