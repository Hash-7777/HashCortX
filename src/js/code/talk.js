// ==============================================================
// Small talk, and a model that reads its tools back
//
// A model on a modest computer reads a request's instructions and tools
// before it writes a word, and for a small model they are most of what it
// reads. "hi" does not need them. Two things follow:
//
//   • A greeting, a thanks or a one-line question about what HashCoder is
//     (and nothing else: no file, no code, no task) is answered by a small or
//     mid-sized model without tools and with a one-line instruction, so the
//     reply comes in seconds and not after the whole of the tools is read.
//   • A small model given tools sometimes answers by writing them back: the
//     list of tool definitions, as JSON, in place of a reply. That is not an
//     answer. It is recognised, set aside, and the model is asked again
//     without tools.
//
// Pure: strings in, a verdict out. Published as window.HCCodeTalk.
// Checked by scripts/checks/code-talk.mjs.
// ==============================================================

(function () {
  'use strict';

  /** What a model without tools is told. */
  const SHORT_SYSTEM = 'You are HashCoder, a coding assistant that works on the person\'s project. Reply in one or two short sentences. For anything that needs a file, a command or a change, ask them to say what they want done.';

  const MOST_CHARS = 60;
  // A greeting, thanks, goodbye, or a question about HashCoder itself, as the whole message.
  const TALK = /^(?:hi+|hello+|hey+|hiya|yo|sup|hola|salam|salaam|good\s+(?:morning|afternoon|evening|night)|thanks?(?:\s+a\s+lot)?|thank\s+you(?:\s+(?:so\s+much|very\s+much))?|thx|ty|ok(?:ay)?|cool|nice|great|awesome|perfect|bye|goodbye|see\s+you|how\s+are\s+you|how\s+is\s+it\s+going|what'?s\s+up|who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|can\s+you\s+help(?:\s+me)?|help|test(?:ing)?|مرحبا|اهلا|أهلا|السلام\s+عليكم|شكرا|شكراً)(?:\s+(?:there|again|hashcoder|everyone|all))?\s*[.!?؟]*$/i;

  /** Whether `text` is only small talk: short, one of the forms above, and no file, path or code in it. */
  function isSmallTalk(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t || t.length > MOST_CHARS || /[\n`\\/]|\.\w{1,5}\b|[{}()<>=;]/.test(t)) return false;
    return TALK.test(t);
  }

  const textOf = (m) => (typeof m.content === 'string' ? m.content : '');

  /**
   * Whether the request in hand is only small talk: the last thing said to the
   * model is the person's own words, they are small talk, and no tool has been
   * used since. A note the app added is not the person's.
   */
  function onlySmallTalk(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m || m.note) continue;
      if (m.role === 'user') return isSmallTalk(textOf(m)) && !(Array.isArray(m.images) && m.images.length);
      return false;   // a reply or a tool result comes after: the request is already being worked on
    }
    return false;
  }

  const nameIn = (item) => (item && item.function && item.function.name) || (item && item.name) || '';

  /**
   * Whether `text` is the list of tools written back as a reply: JSON that is
   * the definitions the model was given (their names, their parameters), with
   * no call in it. `tools` are the definitions it was sent.
   */
  function echoesTools(text, tools) {
    let t = String(text == null ? '' : text).trim();
    if (t.length < 20) return false;
    // Inside a code block, as models often write it (the fence module reads the block).
    const block = window.HCFences && window.HCFences.jsonBlock ? window.HCFences.jsonBlock(t) : null;
    if (block != null) t = block.trim();
    const names = new Set((Array.isArray(tools) ? tools : []).map(nameIn).filter(Boolean));
    if (!names.size) return false;
    let parsed = null;
    try { parsed = JSON.parse(t); } catch { /* cut off, or not JSON */ }
    if (parsed !== null) {
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.length) return false;
      return items.every((it) => it && typeof it === 'object' && names.has(nameIn(it)) && !('arguments' in (it.function || it)) && !!((it.function || it).parameters || (it.function || it).description));
    }
    // A listing that was cut off before it closed: it starts as a list of definitions and names two of the tools.
    const first = /^\[?\s*\{\s*"type"\s*:\s*"function"\s*,\s*"function"\s*:\s*\{\s*"name"\s*:\s*"([a-z_]+)"/.exec(t);
    if (!first || !names.has(first[1])) return false;
    let seen = 0;
    for (const n of names) if (t.includes(`"name":"${n}"`) || t.includes(`"name": "${n}"`)) seen++;
    return seen >= 2 && /"parameters"/.test(t);
  }

  window.HCCodeTalk = { SHORT_SYSTEM, isSmallTalk, onlySmallTalk, echoesTools };
})();
