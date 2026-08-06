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
    groq: [
      { value: "cloud:groq:openai/gpt-oss-120b",           label: "GPT OSS 120B · Groq",            shortLabel: "GPT OSS 120B" },
      { value: "cloud:groq:openai/gpt-oss-20b",            label: "GPT OSS 20B · Groq",             shortLabel: "GPT OSS 20B (fast)" },
      { value: "cloud:groq:llama-3.3-70b-versatile",       label: "Llama 3.3 70B · Groq",           shortLabel: "Llama 3.3 70B" },
      { value: "cloud:groq:deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B · Groq", shortLabel: "DeepSeek R1 Distill 70B" },
      { value: "cloud:groq:qwen-qwq-32b",                  label: "Qwen QwQ 32B · Groq",            shortLabel: "Qwen QwQ 32B" },
      { value: "cloud:groq:llama-3.1-8b-instant",          label: "Llama 3.1 8B · Groq",            shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // Gemini — generous free tier. Stable non-preview model IDs only.
    gemini: [
      { value: "cloud:gemini:gemini-2.5-flash",                          label: "Gemini 2.5 Flash · Google",     shortLabel: "Gemini 2.5 Flash" },
      { value: "cloud:gemini:gemini-2.5-pro",                            label: "Gemini 2.5 Pro · Google",       shortLabel: "Gemini 2.5 Pro" },
      { value: "cloud:gemini:gemini-2.0-flash",                          label: "Gemini 2.0 Flash · Google",     shortLabel: "Gemini 2.0 Flash" },
      { value: "cloud:gemini:gemini-2.0-flash-lite",                     label: "Gemini 2.0 Flash Lite · Google",shortLabel: "Gemini 2.0 Flash Lite (fast)" },
      { value: "cloud:gemini:gemini-2.0-flash-preview-image-generation", label: "Gemini Image Gen · Google",     shortLabel: "Gemini Image Gen ✦", imageGen: true },
    ],
    // OpenRouter — only confirmed :free models with provider/model format
    openrouter: [
      { value: "cloud:openrouter:openai/gpt-oss-120b:free",                        label: "GPT OSS 120B (free) · OpenRouter",         shortLabel: "GPT OSS 120B (free)" },
      { value: "cloud:openrouter:openai/gpt-oss-20b:free",                         label: "GPT OSS 20B (free) · OpenRouter",           shortLabel: "GPT OSS 20B (free)" },
      { value: "cloud:openrouter:deepseek/deepseek-r1:free",                       label: "DeepSeek R1 (free) · OpenRouter",           shortLabel: "DeepSeek R1 (free)" },
      { value: "cloud:openrouter:meta-llama/llama-3.3-70b-instruct:free",          label: "Llama 3.3 70B (free) · OpenRouter",         shortLabel: "Llama 3.3 70B (free)" },
      { value: "cloud:openrouter:meta-llama/llama-4-maverick:free",                label: "Llama 4 Maverick (free) · OpenRouter",      shortLabel: "Llama 4 Maverick (free)" },
      { value: "cloud:openrouter:google/gemma-4-31b-it:free",                      label: "Gemma 4 31B (free) · OpenRouter",           shortLabel: "Gemma 4 31B (free)" },
      { value: "cloud:openrouter:qwen/qwen3-30b-a3b:free",                         label: "Qwen3 30B (free) · OpenRouter",             shortLabel: "Qwen3 30B (free)" },
      { value: "cloud:openrouter:nousresearch/hermes-3-llama-3.1-405b:free",       label: "Hermes 3 405B (free) · OpenRouter",         shortLabel: "Hermes 3 405B (free)" },
    ],
    // Cerebras — confirmed stable model IDs from cerebras.ai/models
    cerebras: [
      { value: "cloud:cerebras:llama-3.3-70b", label: "Llama 3.3 70B · Cerebras",  shortLabel: "Llama 3.3 70B" },
      { value: "cloud:cerebras:llama3.1-8b",   label: "Llama 3.1 8B · Cerebras",   shortLabel: "Llama 3.1 8B (fast)" },
    ],
    // SambaNova — free mega-scale inference. IDs are PascalCase as shown in cloud.sambanova.ai
    samba: [
      { value: "cloud:samba:Llama-4-Maverick-17B-128E-Instruct", label: "Llama 4 Maverick 17B · SambaNova", shortLabel: "Llama 4 Maverick 17B" },
      { value: "cloud:samba:Meta-Llama-3.1-405B-Instruct",       label: "Llama 3.1 405B · SambaNova",      shortLabel: "Llama 3.1 405B" },
      { value: "cloud:samba:Meta-Llama-3.3-70B-Instruct",        label: "Llama 3.3 70B · SambaNova",       shortLabel: "Llama 3.3 70B" },
      { value: "cloud:samba:QwQ-32B",                            label: "Qwen QwQ 32B · SambaNova",        shortLabel: "Qwen QwQ 32B" },
      { value: "cloud:samba:DeepSeek-R1",                        label: "DeepSeek R1 · SambaNova",         shortLabel: "DeepSeek R1" },
      { value: "cloud:samba:DeepSeek-V3-0324",                   label: "DeepSeek V3 · SambaNova",         shortLabel: "DeepSeek V3" },
    ],
    // OpenAI — paid, frontier models
    openai: [
      { value: "cloud:openai:gpt-4o",            label: "GPT-4o · OpenAI",            shortLabel: "GPT-4o" },
      { value: "cloud:openai:gpt-4o-mini",       label: "GPT-4o Mini · OpenAI",       shortLabel: "GPT-4o Mini" },
      { value: "cloud:openai:gpt-4-turbo",       label: "GPT-4 Turbo · OpenAI",       shortLabel: "GPT-4 Turbo" },
      { value: "cloud:openai:o3-mini",           label: "o3 Mini · OpenAI",           shortLabel: "o3 Mini" },
    ],
    // Anthropic Claude — paid, strong reasoning
    anthropic: [
      { value: "cloud:anthropic:claude-sonnet-4-20250514", label: "Claude Sonnet 4 · Anthropic", shortLabel: "Claude Sonnet 4" },
      { value: "cloud:anthropic:claude-opus-4-20250514",   label: "Claude Opus 4 · Anthropic",   shortLabel: "Claude Opus 4" },
      { value: "cloud:anthropic:claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet · Anthropic", shortLabel: "Claude 3.5 Sonnet" },
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
  };

  window.HCCloudModels = { CLOUD_FALLBACK };
})();
