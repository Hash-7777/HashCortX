// ==============================================================
// Who runs next, and what they are given
//
// A blueprint is a set of agents and the dependencies between them. This
// decides, at each step, which agents can run, which are waiting, which can
// never run at all, and what each one is handed from the agents before it.
//
// The failure that matters here is silent: an agent that never runs and is
// never reported produces no error anywhere, and the final answer is simply
// missing a piece of the work with nothing to say so.
//
// Pure: takes the blueprint and what has happened so far, returns decisions.
// No DOM, no network, no clock.
//
// Loaded before the Agent Maker and published as window.HCSwarmSchedule.
// Checked by scripts/checks/swarm-schedule.mjs.
// ==============================================================

(function () {
  'use strict';

  const idsOf = (list) => (Array.isArray(list) ? list : []);

  /** Each agent's dependencies, as a map of agent id to the ids it waits for. */
  function dependencyMap(agents, edges) {
    const map = Object.create(null);
    for (const agent of idsOf(agents)) map[agent.id] = [];
    for (const edge of idsOf(edges)) {
      if (!edge || !map[edge.to]) continue;
      // An edge naming an agent that is not in the blueprint would otherwise
      // become a dependency that can never complete, stalling everything after
      // it for reasons no message explains.
      if (!(edge.from in map)) continue;
      if (map[edge.to].includes(edge.from)) continue;
      map[edge.to].push(edge.from);
    }
    return map;
  }

  /**
   * Agents that deliver the answer run on whatever arrived. One failed coder
   * used to take the final agent with it, and a run with the rest of its work
   * done ended with "Skipped" as its whole result. Such an agent waits until
   * everything it depends on has finished or failed, and runs if any of it
   * finished; it is told what is missing.
   */
  const keepsGoing = (a, options) => !!(options && options.keepGoing && options.keepGoing.has(a.id));
  const settledWithSome = (deps, completed, failed) =>
    deps.every((d) => completed.has(d) || failed.has(d)) && (!deps.length || deps.some((d) => completed.has(d)));

  /** Agents whose dependencies are all done, and which have not run yet. */
  function readyAgents(agents, depMap, completed, failed, options) {
    return idsOf(agents).filter((a) => {
      if (completed.has(a.id) || failed.has(a.id)) return false;
      const deps = depMap[a.id] || [];
      return keepsGoing(a, options) ? settledWithSome(deps, completed, failed) : deps.every((d) => completed.has(d));
    });
  }

  /**
   * Agents that can never run, because something they depend on failed — or
   * because something IT depends on can never run, however far back that goes.
   *
   * Without this the scheduler simply stopped: an agent waiting on a failed one
   * is never ready, so the step found nothing to dispatch and the loop broke.
   * Every agent behind the failure was left neither completed nor failed, absent
   * from the results, and absent from the final answer — with nothing anywhere
   * saying a branch of the work had been dropped.
   */
  function strandedAgents(agents, depMap, completed, failed, options) {
    const dead = new Set(failed);
    const out = [];
    let growing = true;
    while (growing) {
      growing = false;
      for (const a of idsOf(agents)) {
        if (completed.has(a.id) || dead.has(a.id)) continue;
        const deps = depMap[a.id] || [];
        const blockers = deps.filter((d) => dead.has(d));
        if (!blockers.length) continue;
        // One that keeps going is stranded only when nothing it waits for can arrive.
        if (keepsGoing(a, options) && blockers.length < deps.length) continue;
        dead.add(a.id);
        out.push({ agent: a, blockedBy: blockers });
        growing = true;
      }
    }
    return out;
  }

  /**
   * A label for each agent that is unique across the blueprint.
   *
   * Dependency results are handed to an agent under the name of the agent that
   * produced them, and nothing stops two agents sharing a name. When two did,
   * one overwrote the other and the agent downstream was given half of what it
   * was owed, with the trace still counting both.
   */
  function labelsFor(agents) {
    const seen = Object.create(null);
    const labels = Object.create(null);
    for (const a of idsOf(agents)) {
      const base = String(a.name || a.id || 'Agent');
      seen[base] = (seen[base] || 0) + 1;
      labels[a.id] = seen[base] === 1 ? base : `${base} (${seen[base]})`;
    }
    return labels;
  }

  /**
   * What an agent is handed from the agents it depends on.
   *
   * An agent that answered with nothing is still an agent that answered, so an
   * empty result is passed on rather than dropped — the count of results given
   * used to include it while the results themselves did not.
   */
  function dependencyResults(agent, depMap, agents, results, labels) {
    const names = labels || labelsFor(agents);
    const out = {};
    for (const depId of depMap[agent.id] || []) {
      if (!(depId in results)) continue;
      out[names[depId] || depId] = results[depId];
    }
    return out;
  }

  /** What an agent is waiting for, said in a way that distinguishes the cases. */
  function waitingOn(agent, depMap, agents, completed, failed, labels) {
    const names = labels || labelsFor(agents);
    const pending = [];
    const broken = [];
    for (const depId of depMap[agent.id] || []) {
      if (completed.has(depId)) continue;
      (failed.has(depId) ? broken : pending).push(names[depId] || depId);
    }
    return { pending, broken };
  }

  window.HCSwarmSchedule = {
    dependencyMap,
    readyAgents,
    strandedAgents,
    labelsFor,
    dependencyResults,
    waitingOn,
  };
})();
