// ==============================================================
// How strong a model is for a Swarm team's roles
//
// The team designer is offered one model per provider, the strongest, and the
// strongest go to the roles that matter most. Strength is read from a model's
// name — its family and its size — and, between models, from how it has been
// answering (js/model-speed.js): by name alone, a free giant stuck in a queue
// was given the key roles.
//
// Words are matched whole. "mini" was found inside "gemini", so on a large task
// every Gemini model, Pro included, lost the points meant for a mini model.
//
// Pure apart from the speed record it reads. Loaded before the Agent Swarm and
// published as window.HCSwarmModelStrength. Checked by
// scripts/checks/swarm-model-strength.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The largest size a name gives, in billions of parameters (1t = 1,000b). */
  function sizeScore(text) {
    const matches = [...String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*([bkmt])\b/gi)];
    if (!matches.length) return 0;
    return Math.max(...matches.map(([, n, unit]) => {
      const value = Number(n) || 0;
      const u = unit.toLowerCase();
      if (u === 't') return value * 1000;
      if (u === 'b') return value;
      if (u === 'm') return value / 1000;
      return value / 1000000;
    }));
  }

  function score(value, label, bigTask) {
    const text = `${value || ''} ${label || ''}`.toLowerCase();
    let points = 0;
    const add = (re, n) => { if (re.test(text)) points += n; };

    add(/\bgpt-5|gpt5|o3|o4|gpt-4\.1|gpt-4o|claude-4|opus|sonnet/i, 160);
    add(/gemini-2\.5-pro|gemini.*pro/i, 150);
    add(/deepseek[-\s]?r1|deepseek[-\s]?v3/i, 135);
    add(/llama-4|maverick|scout/i, 128);
    add(/nemotron|hermes-3|qwen3|qwen-3|qwq/i, 118);
    add(/gpt-oss-120b|405b|235b|120b|70b/i, 105);
    add(/llama-3\.3|llama-3\.1/i, 65);

    points += Math.min(sizeScore(text), 500);
    if (bigTask) {
      add(/pro|opus|sonnet|r1|v3|405b|235b|120b|70b|maverick|nemotron|hermes/i, 60);
      add(/\b(?:flash|lite|mini|small|fast|instant|8b|20b)\b/i, -90);
    } else {
      add(/\b(?:flash|fast|instant|lite)\b/i, 25);
    }
    add(/embedding|rerank|moderation|vision|image|tts|whisper|guard/i, -1000);
    return points;
  }

  /** The strongest of a provider's models among those that answer in time. */
  function best(options, bigTask) {
    return window.HCModelSpeed.order(options, (o) => o.value, (o) => score(o.value, o.label, bigTask))[0];
  }

  window.HCSwarmModelStrength = { sizeScore, score, best };
})();
