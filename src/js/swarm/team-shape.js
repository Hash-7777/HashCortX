// ==============================================================
// Who does what in a team, and who hands over the result
//
// A website or large team is wired in layers: the planners first, then the
// agents who make the work, then any who check it, then ONE agent who puts it
// together and delivers it. Two things went wrong with how those were told
// apart, and together they made the planner deliver the result:
//
//  - An agent counted as the deliverer when its name or role said
//    "supervisor". A team whose planner had the supervisor role — "Lead
//    Planner", listed first — had it chosen, because it came first. So the
//    agent that runs before anyone else was told to write the finished site
//    with nothing to write it from, its answer became the team's result, and
//    the agent actually built to finish was told to write only its own part.
//  - The planner was wired as both the first layer and the last, which made a
//    loop the run then had to cut.
//
// Now a planner is a planner whatever its role says, the deliverer is the last
// agent that finishes work, and no agent is in two layers. And at run time,
// for any team however it was made, the result comes from an agent nothing
// else is waiting on — see delivererOf.
//
// Pure: agents and edges in, layers and edges out. Loaded before the Agent
// Swarm and published as window.HCSwarmTeamShape. Checked by
// scripts/checks/swarm-team-shape.mjs.
// ==============================================================

(function () {
  'use strict';

  const text = (a) => `${(a && a.name) || ''} ${(a && a.role) || ''}`;
  const PLANS = /plan|research|spec\b|analyst|architect|strateg|brief/i;
  const FINISHES = /final|polish|synthes|aggregat|assembl|integrat|deliver/i;
  const LEADS = /boss|supervisor|lead|manager|orchestrat/i;
  const MAKES = /coder|developer|engineer|front|back|style|design|content|copy|writer|builder/i;
  const CHECKS = /critic|validator|qa\b|review|tester|audit/i;

  /** What an agent is for, judged from its name and role together. */
  function kindOf(agent) {
    const t = text(agent);
    const name = String((agent && agent.name) || '');
    if (FINISHES.test(name)) return 'final';
    if (CHECKS.test(t)) return 'check';
    if (PLANS.test(name) && !MAKES.test(name)) return 'plan';
    if (LEADS.test(t) && !MAKES.test(name)) return 'final';
    if (MAKES.test(t)) return 'make';
    if (PLANS.test(t)) return 'plan';
    return 'make';
  }

  /**
   * The team in layers. Every agent is in exactly one; the deliverer is the last
   * agent whose job is to finish, or, with none, the last agent listed.
   */
  function layersOf(agents) {
    const list = Array.isArray(agents) ? agents.filter(Boolean) : [];
    if (!list.length) return { first: [], work: [], review: [], deliverer: null };
    const finals = list.filter((a) => kindOf(a) === 'final');
    const deliverer = finals.length ? finals[finals.length - 1] : list[list.length - 1];
    const rest = list.filter((a) => a !== deliverer);
    let first = rest.filter((a) => kindOf(a) === 'plan');
    const review = rest.filter((a) => kindOf(a) === 'check');
    let work = rest.filter((a) => !first.includes(a) && !review.includes(a));
    if (!first.length && work.length > 1) { first = [work[0]]; work = work.slice(1); }
    return { first, work, review, deliverer };
  }

  /** How the layers hand work on, with a reason for each edge. */
  function edgesOf({ first, work, review, deliverer }) {
    const edges = [];
    const add = (from, to, reason) => { if (from && to && from !== to) edges.push({ from: from.id, to: to.id, reason }); };
    const makers = work.length ? work : first;
    if (work.length) first.forEach((src) => work.forEach((dst) => add(src, dst, `${dst.name} uses ${src.name} planning output`)));
    review.forEach((dst) => makers.forEach((src) => add(src, dst, `${dst.name} validates ${src.name} output`)));
    makers.forEach((src) => add(src, deliverer, `${deliverer.name} receives ${src.name} artifacts for final assembly`));
    review.forEach((src) => add(src, deliverer, `${deliverer.name} incorporates ${src.name} validation`));
    if (!makers.length && !review.length) first.forEach((src) => add(src, deliverer, `${deliverer.name} finalizes ${src.name} output`));
    return edges;
  }

  /**
   * The agent whose answer is the run's result.
   *
   * The team's own choice when nothing is waiting on that agent. Otherwise its
   * answer is an input to later work, not the result, so the choice is an
   * agent nothing waits on: one whose job is to finish if there is one, the
   * last listed if not. Returns the id and whether the team's choice was kept.
   */
  function delivererOf(agents, edges, preferredId) {
    const list = Array.isArray(agents) ? agents.filter(Boolean) : [];
    const ids = new Set(list.map((a) => a.id));
    const feeds = new Set((Array.isArray(edges) ? edges : [])
      .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .map((e) => e.from));
    const sinks = list.filter((a) => !feeds.has(a.id));
    if (preferredId && ids.has(preferredId) && !feeds.has(preferredId)) return { id: preferredId, kept: true };
    if (!sinks.length) return { id: preferredId || null, kept: true };
    const finishing = sinks.filter((a) => kindOf(a) === 'final');
    const pick = finishing.length ? finishing[finishing.length - 1] : sinks[sinks.length - 1];
    return { id: pick.id, kept: pick.id === preferredId };
  }

  /**
   * A team cut to at most `max` agents, or null when it is within it. The
   * deliverer always stays; then the agents who make the work, then those who
   * plan it, then those who check it. A small model told to use two agents
   * designed five, and a team is the app's to size, not the model's.
   */
  function trimTo(agents, max) {
    const list = Array.isArray(agents) ? agents.filter(Boolean) : [];
    if (!(max >= 1) || list.length <= max) return null;
    const L = layersOf(list);
    const keep = new Set([L.deliverer, ...[...L.work, ...L.first, ...L.review].slice(0, max - 1)]);
    const kept = list.filter((a) => keep.has(a));
    const layers = layersOf(kept);
    return { agents: kept, edges: edgesOf(layers), deliverer: layers.deliverer.id, dropped: list.filter((a) => !keep.has(a)).map((a) => a.name) };
  }

  /**
   * The tools an agent is given in a run. It may read what is remembered about
   * the person but never write to it: a small model saved a business name it
   * had invented, and every later chat would have taken it as fact. The agent
   * that delivers the result assembles what it was handed, so it searches and
   * fetches nothing; it keeps Python, which a file to hand back may need.
   */
  function toolsFor(agent, delivers) {
    const tools = ((agent && agent.tools) || []).flatMap((t) => (t === 'memory' ? ['recall_facts'] : [t])).filter((t) => t !== 'remember_fact');
    return delivers ? tools.filter((t) => t === 'code_interpreter' || t === 'python') : tools;
  }

  /** A short piece or a question's team: one writer, on the model the person chose. */
  function oneWriter(desc, model) {
    return {
      description: `One agent for: ${String(desc || '').slice(0, 120)}`, topology: 'pipeline', aggregation: 'concat', supervisorModel: model,
      agents: [{ id: 'a1', name: 'Writer', role: 'writer', systemPrompt: 'Write exactly what the task asks for, complete and ready to use, in the form it asks for. No preamble. Never invent a person, a brand, a place or a fact the task did not give.', tools: [], memory: 'project', timeout: 120, retries: 1, temperature: 0.6, model }],
      dag: { nodes: ['a1'], edges: [] }, finalOutputAgentId: 'a1',
    };
  }

  /** What an agent on a build is held to, by what it does: a brief, the files it owns, fixes, or the finished files. */
  function codeContractFor(agent) {
    const name = `${agent.name || ""} ${agent.role || ""}`.toLowerCase();
    const common = "\n\nSTRICT CODE-BUILD CONTRACT:\n- Do not create DOCX, PDF, reports, slide decks, or downloadable documents.\n- Do not call unrelated external URLs or fetch templates unless the user explicitly asks.\n- Keep prose minimal and only use it when your assigned output contract requires it.\n- Pass compact, structured output to downstream agents; avoid long essays.\n- For website tasks, visible images, working interactions, responsive layout, and polished motion are required implementation details, not optional decoration.";
    if (/research|planner|spec|designer|analyst/.test(name) && !/coder|front|back/.test(name)) {
      return common + "\n- Output a compact implementation brief only: brand direction, page sections, data/content needs, file list, image strategy, interaction strategy, and acceptance criteria.\n- For websites with product/gallery imagery, specify remote HTTPS image URLs and inline fallback behavior; do not leave image sourcing to downstream guessing.\n- Keep the brief under 900 words.";
    }
    if (/front|html|css|style|js|coder|developer/.test(name) && !/back/.test(name)) {
      return common + "\n- Output complete frontend code only: the files your role owns, each in one fenced block named with the site's exact file name.\n- Use visible remote HTTPS images with alt text, stable aspect ratios, object-fit styling, and onerror inline SVG/data URI fallback.\n- If a cart is requested, implement add/remove/quantity/count/total/empty-state/localStorage behavior and wire all buttons.\n- Implement polished animations with CSS transitions/keyframes and reduced-motion support.\n- Do not output partial snippets. Do not write commentary outside code fences.";
    }
    if (/back|server|api/.test(name)) {
      return common + "\n- If the website does not need a backend, output exactly: NO_BACKEND_NEEDED.\n- If a backend is needed, output complete code only with filenames such as ```javascript server.js``` and no document-generation code.";
    }
    if (/critic|validator|qa|review/.test(name)) {
      return common + "\n- Validate the produced files. Output only concrete fixes or corrected full code blocks with filenames.\n- Explicitly reject broken/missing images, fake local image paths, unwired buttons, non-persistent cart state, missing totals, and animation CSS that is never applied.\n- Do not write a general review report.";
    }
    if (/boss|supervisor|polish|aggregator/.test(name)) {
      return common + "\n- Merge and polish concrete files into final code blocks only. Remove duplicate prose, specs, and reports.\n- Before final output, ensure image URLs are visible/fallback-safe, cart behavior is complete, animations are applied, and all files reference each other correctly.";
    }
    return common;
  }

  window.HCSwarmTeamShape = { codeContractFor, toolsFor, oneWriter, trimTo, kindOf, layersOf, edgesOf, delivererOf };
})();
