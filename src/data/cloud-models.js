// ==============================================================
// Cloud model catalogue — the fallback lists
//
// What the model picker offers before any provider has been asked.
//
// The app fetches each provider's real catalogue from its /models endpoint as
// soon as a key is present, and replaces these. They are what the user sees
// when there is no key yet, when the network is down, or when a provider
// answers with something unusable — which is most of the first run.
//
// It is a table, and it changes on someone else's schedule: providers add and
// retire models constantly, and every one of those edits used to mean opening
// the largest file in the app and scrolling to line 3,860.
//
// Each entry is:
//   value       "cloud:<provider>:<modelId>" — the id the send path parses
//   label       full name with provider suffix, for compare and workbench
//   shortLabel  compact name, for the dropdown
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  const CLOUD_FALLBACK = {
    // Groq — free, ultra-fast inference. IDs are the raw model slugs from console.groq.com/docs/models
    // Two Groq models and two Gemini 2.0 models were taken out of these lists
    // after their providers' deprecation pages listed them as shut down.
    groq: [
      { value: "cloud:groq:openai/gpt-oss-120b",           label: "GPT OSS 120B · Groq",            shortLabel: "GPT OSS 120B" },
      { value: "cloud:groq:openai/gpt-oss-20b",            label: "GPT OSS 20B · Groq",             shortLabel: "GPT OSS 20B (fast)" },
      { value: "cloud:groq:llama-3.3-70b-versatile",       label: "Llama 3.3 70B · Groq",           shortLabel: "Llama 3.3 70B" },
      { value: "cloud:groq:llama-3.1-8b-instant",          label: "Llama 3.1 8B · Groq",            shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // Gemini — generous free tier. Stable non-preview model IDs only.
    gemini: [
      { value: "cloud:gemini:gemini-2.5-flash",                          label: "Gemini 2.5 Flash · Google",     shortLabel: "Gemini 2.5 Flash" },
      { value: "cloud:gemini:gemini-2.5-pro",                            label: "Gemini 2.5 Pro · Google",       shortLabel: "Gemini 2.5 Pro" },
      { value: "cloud:gemini:gemini-2.5-flash-lite",                     label: "Gemini 2.5 Flash Lite · Google",shortLabel: "Gemini 2.5 Flash Lite (fast)" },
      { value: "cloud:gemini:gemini-2.0-flash-preview-image-generation", label: "Gemini Image Gen · Google",     shortLabel: "Gemini Image Gen ✦", imageGen: true },
    ],
    // OpenRouter — free models, checked against the live list.
    //
    // This list rots faster than anything else in the app: OpenRouter retires
    // free models constantly, and seven of the eight here were already gone
    // both times it has been checked. `npm run models` asks OpenRouter, which
    // needs no key, and names the ones that have since died.
    openrouter: [
      { value: "cloud:openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",  label: "Nemotron 3 Ultra (free) · OpenRouter",   shortLabel: "Nemotron 3 Ultra (free)" },
      { value: "cloud:openrouter:thinkingmachines/inkling:free",           label: "Inkling (free) · OpenRouter",            shortLabel: "Inkling (free)" },
      { value: "cloud:openrouter:nvidia/nemotron-3-super-120b-a12b:free",  label: "Nemotron 3 Super (free) · OpenRouter",   shortLabel: "Nemotron 3 Super (free)" },
      { value: "cloud:openrouter:google/gemma-4-31b-it:free",              label: "Gemma 4 31B (free) · OpenRouter",        shortLabel: "Gemma 4 31B (free)" },
      { value: "cloud:openrouter:qwen/qwen3.8-27b:free",                   label: "Qwen3.8 27B (free) · OpenRouter",        shortLabel: "Qwen3.8 27B (free)" },
      { value: "cloud:openrouter:inclusionai/ling-3.0-flash-vl:free",      label: "Ling 3.0 Flash VL (free) · OpenRouter",  shortLabel: "Ling 3.0 Flash VL (free)" },
      { value: "cloud:openrouter:nvidia/nemotron-3.5-lightning:free",      label: "Nemotron 3.5 Lightning (free) · OpenRouter", shortLabel: "Nemotron 3.5 Lightning (free)" },
      { value: "cloud:openrouter:z-ai/glm-5.2:free",                       label: "GLM 5.2 (free) · OpenRouter",            shortLabel: "GLM 5.2 (free)" },
    ],
    // Cerebras — confirmed stable model IDs from cerebras.ai/models
    cerebras: [
      { value: "cloud:cerebras:llama-3.3-70b", label: "Llama 3.3 70B · Cerebras",  shortLabel: "Llama 3.3 70B" },
      { value: "cloud:cerebras:llama3.1-8b",   label: "Llama 3.1 8B · Cerebras",   shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // SambaNova. Its servers refuse a web page, so the app asks for it; the
    // live list (public, with each model's limits) replaces these at once.
    samba: [
      { value: "cloud:samba:gpt-oss-120b",                label: "GPT-OSS 120B · SambaNova",   shortLabel: "GPT-OSS 120B" },
      { value: "cloud:samba:DeepSeek-V3.1",               label: "DeepSeek V3.1 · SambaNova",  shortLabel: "DeepSeek V3.1" },
      { value: "cloud:samba:Meta-Llama-3.3-70B-Instruct", label: "Llama 3.3 70B · SambaNova",  shortLabel: "Llama 3.3 70B" },
    ],
    // NVIDIA. Reached through the app for the same reason; its live list
    // replaces these.
    nvidia: [
      { value: "cloud:nvidia:openai/gpt-oss-20b",                       label: "GPT-OSS 20B · NVIDIA",            shortLabel: "GPT-OSS 20B" },
      { value: "cloud:nvidia:nvidia/llama-3.1-nemotron-ultra-253b-v1",  label: "Nemotron Ultra 253B · NVIDIA",    shortLabel: "Nemotron Ultra 253B" },
      { value: "cloud:nvidia:meta/llama-3.2-90b-vision-instruct",      label: "Llama 3.2 90B Vision · NVIDIA",   shortLabel: "Llama 3.2 90B Vision" },
    ],
    // OpenAI — paid, frontier models
    openai: [
      { value: "cloud:openai:gpt-4o",            label: "GPT-4o · OpenAI",            shortLabel: "GPT-4o" },
      { value: "cloud:openai:gpt-4o-mini",       label: "GPT-4o Mini · OpenAI",       shortLabel: "GPT-4o Mini" },
      { value: "cloud:openai:gpt-4-turbo",       label: "GPT-4 Turbo · OpenAI",       shortLabel: "GPT-4 Turbo" },
      { value: "cloud:openai:o3-mini",           label: "o3 Mini · OpenAI",           shortLabel: "o3 Mini" },
    ],
    // Anthropic Claude — paid, strong reasoning.
    //
    // Current ids carry no date suffix. The three that were here named the
    // Claude 4 generation and one from 3.5, each with the dated spelling that
    // generation used, so all three were two things at once: an older family
    // and a form of id that is no longer how these are written.
    anthropic: [
      { value: "cloud:anthropic:claude-opus-5",   label: "Claude Opus 5 · Anthropic",   shortLabel: "Claude Opus 5" },
      { value: "cloud:anthropic:claude-sonnet-5", label: "Claude Sonnet 5 · Anthropic", shortLabel: "Claude Sonnet 5" },
      { value: "cloud:anthropic:claude-haiku-4-5", label: "Claude Haiku 4.5 · Anthropic", shortLabel: "Claude Haiku 4.5 (fast)" },
    ],
    // Moonshot AI (Kimi) — OpenAI-compatible API. The live /models call replaces
    // this list whenever a key is available; keep the fallback on current public IDs.
    moonshot: [
      { value: "cloud:moonshot:kimi-k2.6",                 label: "Kimi K2.6 · Moonshot",              shortLabel: "Kimi K2.6" },
      { value: "cloud:moonshot:kimi-k2.5",                 label: "Kimi K2.5 · Moonshot",              shortLabel: "Kimi K2.5" },
      { value: "cloud:moonshot:kimi-k2-thinking-turbo",    label: "Kimi K2 Thinking Turbo · Moonshot", shortLabel: "Kimi K2 Thinking Turbo" },
      { value: "cloud:moonshot:kimi-k2-thinking",          label: "Kimi K2 Thinking · Moonshot",       shortLabel: "Kimi K2 Thinking" },
      { value: "cloud:moonshot:kimi-k2-turbo-preview",     label: "Kimi K2 Turbo Preview · Moonshot",  shortLabel: "Kimi K2 Turbo" },
      { value: "cloud:moonshot:kimi-k2-0905-preview",      label: "Kimi K2 0905 Preview · Moonshot",   shortLabel: "Kimi K2 0905" },
      { value: "cloud:moonshot:moonshot-v1-128k",          label: "Moonshot v1 128K · Kimi",           shortLabel: "Kimi 128K" },
      { value: "cloud:moonshot:moonshot-v1-32k",           label: "Moonshot v1 32K · Kimi",            shortLabel: "Kimi 32K" },
      { value: "cloud:moonshot:moonshot-v1-8k",            label: "Moonshot v1 8K · Kimi",             shortLabel: "Kimi 8K" },
    ],
    // DeepSeek — strong reasoning, cheap
    deepseek: [
      { value: "cloud:deepseek:deepseek-chat",     label: "DeepSeek V3 · DeepSeek",     shortLabel: "DeepSeek V3" },
      { value: "cloud:deepseek:deepseek-reasoner", label: "DeepSeek R1 · DeepSeek",     shortLabel: "DeepSeek R1" },
    ],
    // Mistral AI — European provider, strong coding
    mistral: [
      { value: "cloud:mistral:mistral-large-latest", label: "Mistral Large · Mistral", shortLabel: "Mistral Large" },
      { value: "cloud:mistral:codestral-latest",     label: "Codestral · Mistral",     shortLabel: "Codestral" },
      { value: "cloud:mistral:mistral-medium-latest", label: "Mistral Medium · Mistral", shortLabel: "Mistral Medium" },
    ],

    // ── Nine providers with no list written here, on purpose ──────────────
    //
    // Every one of them answers with its own catalogue the moment there is a
    // key to ask with, and the app asks on its own from then on — at launch,
    // on a timer, and whenever the window comes back to the front
    // (js/model-refresh.js). A list typed in here would only be a guess at
    // what they offered on the day it was typed, and this file exists as a
    // record of how quickly such a guess goes wrong: seven of the eight
    // OpenRouter models above were already dead both times they were checked.
    //
    // So these carry nothing. A provider appears in the menu when its own
    // list arrives, a second or so after a key is saved, and what it shows is
    // what that provider actually serves that day. Nobody has to maintain it,
    // and nobody is ever offered a model that stopped existing in July.
    xai: [],
    together: [],
    fireworks: [],
    zai: [],
    qwen: [],
    huggingface: [],
    deepinfra: [],
    novita: [],
    venice: [],
    cloudflare: [],
  };

  window.HCCloudModels = { CLOUD_FALLBACK };
})();
