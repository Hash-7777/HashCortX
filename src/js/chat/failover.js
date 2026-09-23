// ============================================================
// chat/failover.js — which model to try when one will not answer
//
// When a request fails, the app moves on to the next model rather than
// stopping. Two judgements decide what happens: whether the failure is worth
// moving on from at all, and which of the remaining models to reach for.
//
// Both were in a mode file, and one of them was wrong in a way that is
// invisible unless it is asked.
//
// A BROAD NAME WAS MATCHING BEFORE A NARROW ONE. Models are ranked by reading
// their names, and the ranking checked the family before the variant — so
// "gpt-4o-mini" matched "gpt-4o" and was ranked alongside the frontier models
// it is the small, cheap version of. So did "gemini-2.5-flash-lite", against
// "gemini-2.5-flash". On a failover the app reached for the cheap variant
// ahead of a genuinely large model, and the answer that came back was worse
// for no reason anybody could see.
//
// The variant is read first now. A name saying mini, lite, nano or tiny is not
// a frontier model whatever family it belongs to, and that ordering is the
// rule the checks hold — not the list of names, which goes out of date every
// few months and is expected to.
//
// Everything here is judged from a NAME. There is no capability list to query.
// That is a guess, it is the same guess the app was already making silently,
// and the point is that it can now be read.
//
// Pure: names and errors in, an ordering out. No DOM, no network, no clock.
//
// Run the checks with: npm run check:chat-failover
// ============================================================
(function () {
  "use strict";

  const TIER_RANK = { frontier: 4, large: 3, medium: 2, small: 1 };

  // Read FIRST, and the whole point. These say "the cheap version of" whatever
  // follows, so a name carrying one is never the frontier model it is named
  // after.
  const SMALL_VARIANT = /\b(mini|lite|nano|tiny|instant|8b|9b|3b|1b)\b|flash-lite|-mini|-lite|-nano/i;

  const FRONTIER = /gpt-5|gpt-4o|o3|o4|claude-(opus|4|5)|gemini-[\d.]+-pro|kimi-k2|deepseek-v3|deepseek-r1|llama-4|400b|405b|671b/i;
  const LARGE = /70b|72b|120b|sonnet|gemini-[\d.]+-flash|qwen-?[\d.]*3|qwen2\.5|maverick|nemotron/i;
  const MEDIUM = /13b|22b|24b|32b|34b|haiku|8x7b|3\.2/i;

  /**
   * Roughly how capable a model is, from its name alone.
   *
   * The variant is read before the family, which is the fix: checking the
   * family first ranks every cheap variant as the thing it is named after.
   */
  function tierOf(name) {
    const s = String(name || "").toLowerCase();
    if (!s) return "small";
    const cheap = SMALL_VARIANT.test(s);
    if (!cheap && FRONTIER.test(s)) return "frontier";
    if (!cheap && LARGE.test(s)) return "large";
    if (MEDIUM.test(s) || cheap) return "medium";
    return "small";
  }

  const rankOf = (name) => TIER_RANK[tierOf(name)] || 0;

  /**
   * Whether a failure is worth moving on from.
   *
   *   fatal      stop — the person cancelled, or nothing will help
   *   transient  the same model again might work: a timeout, a 500
   *   routable   this model will not do it, another might
   *
   * Anything unrecognised is treated as routable, which is the safer of the
   * two wrong answers: trying another model wastes a request, while calling a
   * recoverable failure fatal ends somebody's work for no reason.
   */
  function classifyError(err) {
    if (!err) return "fatal";
    if (err.name === "AbortError") return "fatal";
    const msg = String(err.message || err);
    if (/timeout|timed out|network|fetch failed|ECONN|socket|disconnected/i.test(msg)) return "transient";
    if (/\b5\d\d\b|server error|overload|529|503|502/i.test(msg)) return "transient";
    return "routable";
  }

  /** Whether this failure means "try a different model". */
  const isRoutable = (err) => classifyError(err) === "routable";

  /**
   * The models to try, best first — with one exception that matters.
   *
   * The first in the chain is what the person actually chose, and it stays
   * first however it is ranked. Being quietly moved off the model somebody
   * picked, because the app thinks it knows better, is not a failover.
   *
   * Among the rest, a model that has failed repeatedly is pushed to the back
   * before quality is considered at all: a frontier model that is refusing
   * every request is worth less right now than a smaller one that answers.
   */
  function orderChain(chain, streaks = new Map(), heavyFailures = 3) {
    const list = Array.isArray(chain) ? chain : [];
    return list
      .map((m, i) => ({
        m,
        i,
        rank: rankOf(m && m.model),
        fails: streaks.get(`${m && m.label}:${m && m.model}`) || 0,
      }))
      .sort((a, b) => {
        if (a.i === 0) return -1;
        if (b.i === 0) return 1;
        const aTired = a.fails >= heavyFailures;
        const bTired = b.fails >= heavyFailures;
        if (aTired !== bTired) return aTired ? 1 : -1;
        if (b.rank !== a.rank) return b.rank - a.rank;
        // Everything else equal, the order they were offered in — so the
        // result is the same every time rather than depending on the sort.
        return a.i - b.i;
      })
      .map((x) => x.m);
  }

  // Providers with a free tier. Between models of the same class one of these
  // comes first, so a failover never quietly moves somebody onto an account
  // that bills them while a free one would have answered.
  const FREE_TIER = new Set(["groq", "gemini", "cerebras", "samba", "openrouter"]);

  /**
   * How strongly a failover should prefer a model: its class first, and a free
   * tier only between equals. `value` is "cloud:provider:model".
   */
  function strengthOf(value, label) {
    const provider = String(value || "").split(":")[1] || "";
    return Math.max(rankOf(value), rankOf(label)) * 2 + (FREE_TIER.has(provider) ? 1 : 0);
  }

  // The failures another model can get past: gone, out of quota or credit, a
  // refused key, busy, silent, empty, or a request too large for this one.
  const AGENT_MOVES_ON = ["retired", "limit", "key", "busy", "slow", "empty", "size"];

  /**
   * An agent's turns, each sent to the model in use and, when that one cannot
   * answer, to the next one the run's routing names — the rest of the run
   * then stays on it.
   *
   * A plain chat always moved on like this; an agent stopped with an empty
   * reply at the first rate limit, and a run of tool calls spends a free
   * per-minute budget quickly. The conversation is kept in one shape whatever
   * the provider (js/agent-shape.js), so it can carry on anywhere.
   *
   *   send(request)   one model turn (the app's runModelTurn)
   *   adapterOf(v)    the client a model needs
   *   routes          a run from js/model-routes.js, or null to never move
   *                   (a local model: its job stays local)
   *   onSwitch(from, to, why)
   */
  function agentTurns({ start, send, adapterOf, routes, failureKind, reasonText, onSwitch, maxSwitches = 5 }) {
    let model = start;
    let adapter = adapterOf(start);
    let switches = 0;
    return {
      get model() { return model; },
      async turn(request) {
        for (;;) {
          try {
            // The model is named on the request, so a failure names it whole.
            return await send({ ...request, adapter, modelValue: model });
          } catch (err) {
            const kind = failureKind(err);
            const stopped = request.signal && request.signal.aborted;
            if (!routes || stopped || switches >= maxSwitches || !AGENT_MOVES_ON.includes(kind)) throw err;
            const next = routes.next(model, err);
            if (!next) throw err;
            switches++;
            if (onSwitch) onSwitch(model, next, reasonText(kind, err));
            model = next;
            adapter = adapterOf(next);
          }
        }
      },
    };
  }

  /**
   * The models a run may move through, the chosen one first. A job given to a
   * model on this computer stays on it: no cloud model follows, since choosing
   * a local model is often the point — its project and what it read are not
   * to go to a cloud provider because the local model failed. A cloud job may
   * move on to the fallbacks. `selected` is the chosen model's value.
   */
  function withFallbacks(selected, primary, fallbacks) {
    return String(selected || "").startsWith("cloud:") ? [primary, ...(fallbacks || [])] : [primary];
  }

  window.HCChatFailover = { tierOf, rankOf, strengthOf, classifyError, isRoutable, orderChain, withFallbacks, agentTurns, AGENT_MOVES_ON, TIER_RANK, FREE_TIER };
})();
