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

  window.HCSwarmTeamShape = { kindOf, layersOf, edgesOf, delivererOf };
})();
