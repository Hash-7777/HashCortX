// ==============================================================
// Making pictures, by provider
//
// Three providers make pictures from words, and each asks for it its own way:
//
//   gemini      a picture model answers the conversation itself, pictures
//               and words together, and reads the pictures in it
//   openai      a separate address for pictures: one that makes them from
//               words, and one that changes the pictures it is given
//   openrouter  one address for every picture model it serves, taking the
//               pictures to work from beside the words
//
// What the person attached to their request goes with it, so "make this
// logo blue" is done to the logo rather than to a logo the model imagines.
// A provider that cannot take one is told in words that it was not sent.
//
// Pure: no DOM, no network. app.js sends what this builds and hands back
// what came, and scripts/checks/picture-make.mjs checks both directions.
// Published as window.HCPictureMake.
// ==============================================================

(function () {
  'use strict';

  /** The models that change a picture they are given, on OpenAI's own address for it. */
  const OPENAI_EDITS = /^gpt-image/i;

  const mimeOf = (b64) => {
    const head = String(b64 || '').slice(0, 16);
    if (head.startsWith('iVBORw0KGgo')) return 'image/png';
    if (head.startsWith('R0lGOD')) return 'image/gif';
    if (head.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg';
  };
  const dataUrl = (b64) => `data:${mimeOf(b64)};base64,${b64}`;

  /** The request the person made: their last message, and the pictures on it. */
  function askOf(messages) {
    const last = [...(messages || [])].reverse().find((m) => m && m.role === 'user') || {};
    return { prompt: String(last.content || '').trim(), pictures: Array.isArray(last.images) ? last.images.filter(Boolean) : [] };
  }

  /**
   * What to send. Returns `{ url, json }` for a JSON body, or `{ url, form }`
   * with `form` a list of [name, value] pairs, a picture's value being
   * `{ base64, type, name }` for the caller to turn into a file. `note` says
   * what was left out, for the caller to show beside the answer.
   */
  function requestFor(provider, modelId, messages) {
    const { prompt, pictures } = askOf(messages);
    if (!prompt && !pictures.length) throw new Error('Say what picture to make.');
    const text = prompt || 'Make a picture from this one.';
    if (provider === 'gemini') {
      // The conversation itself, with each message's pictures beside its words.
      const contents = (messages || [])
        .filter((m) => m && m.role !== 'system')
        .map((m) => {
          const parts = [];
          if (m.content) parts.push({ text: String(m.content) });
          if (m.role === 'user' && Array.isArray(m.images)) m.images.forEach((b64) => parts.push({ inlineData: { mimeType: mimeOf(b64), data: b64 } }));
          return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts.length ? parts : [{ text: '' }] };
        });
      const system = (messages || []).filter((m) => m && m.role === 'system').map((m) => m.content).join('\n\n');
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
        json: { contents, generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) },
      };
    }
    if (provider === 'openai') {
      if (pictures.length && OPENAI_EDITS.test(modelId)) {
        const field = pictures.length > 1 ? 'image[]' : 'image';
        return {
          url: 'https://api.openai.com/v1/images/edits',
          form: [['model', modelId], ['prompt', text], ...pictures.map((b64, i) => [field, { base64: b64, type: mimeOf(b64), name: `picture-${i + 1}.${mimeOf(b64).split('/')[1]}` }])],
        };
      }
      // The GPT picture models always answer with the picture itself; the
      // older ones send a link unless asked for it, and a link is an address
      // the app cannot fetch.
      return {
        url: 'https://api.openai.com/v1/images/generations',
        json: { model: modelId, prompt: text, n: 1, ...(/^dall-e/i.test(modelId) ? { response_format: 'b64_json' } : {}) },
        note: pictures.length ? 'This model makes pictures from words only, so the attached picture was not sent.' : '',
      };
    }
    if (provider === 'openrouter') {
      return {
        url: 'https://openrouter.ai/api/v1/images',
        json: { model: modelId, prompt: text, ...(pictures.length ? { input_references: pictures.map((b64) => ({ type: 'image_url', image_url: { url: dataUrl(b64) } })) } : {}) },
      };
    }
    throw new Error(`${provider} does not make pictures in this app.`);
  }

  /** The pictures and words a provider sent back: `{ text, images }`, each picture a data address. */
  function answerOf(provider, data) {
    const images = [];
    let text = '';
    if (provider === 'gemini') {
      for (const part of (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || []) {
        if (part.text) text += part.text;
        const inline = part.inlineData || part.inline_data;
        if (inline && inline.data) images.push(`data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`);
      }
    } else {
      for (const item of (data && data.data) || []) {
        if (item && item.b64_json) images.push(`data:${item.media_type || mimeOf(item.b64_json)};base64,${item.b64_json}`);
        if (item && item.revised_prompt) text = text || `Made from: ${item.revised_prompt}`;
      }
    }
    return { text: text.trim(), images };
  }

  window.HCPictureMake = { requestFor, answerOf, askOf };
})();
