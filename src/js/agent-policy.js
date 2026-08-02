// ==============================================================
// Agent loop policy — what may run together, and when to stop
//
// Two decisions the coding agent makes on every turn, extracted so they can be
// tested. Both were previously implicit in the loop and both were wrong:
//
//   • Every tool call ran one after another, including a dozen independent
//     file reads that have no reason to wait for each other. An orientation
//     step that reads six files took six round trips through Rust.
//
//   • The loop stopped dead at a fixed iteration count and told the user the
//     task was "paused", with no distinction between an agent that had
//     finished, one that was still making progress, and one going in circles.
//
// Pure: no DOM, no IPC, no clock. Checked by scripts/checks/agent-policy.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * What each tool does to the world.
   *
   *   read  — observes only; any number may run at once
   *   write — changes a file; must run alone and in order
   *   exec  — runs a command; must run alone, and may change anything
   *
   * A tool absent from this map is treated as `exec`. That is deliberate: an
   * unknown tool is the one most likely to be new, and the safe assumption
   * about something unfamiliar is that it changes things.
   */
  const TOOL_EFFECT = {
    read_file: 'read',
    list_dir: 'read',
    fuzzy_find: 'read',
    grep_code: 'read',
    web_search: 'read',
    placeholder_images: 'read',
    recall_facts: 'read',
    write_file: 'write',
    patch_file: 'write',
    delete_file: 'write',
    remember_fact: 'write',
    shell_run: 'exec',
  };

  function effectOf(name) {
    return TOOL_EFFECT[name] || 'exec';
  }

  /** How many tools may run at once. Beyond this the gain is noise and the
   *  UI cannot show what is happening. */
  const MAX_PARALLEL = 5;

  /**
   * Group a turn's tool calls into batches that may run concurrently.
   *
   * Consecutive read-only calls batch together. Anything that writes or
   * executes gets a batch of its own, and order is never rearranged — a read
   * that follows a write must still see the write, so batching may only ever
   * merge *adjacent* reads.
   *
   * Reads of the same path also batch: concurrent reads of one file are
   * harmless, and a model asking twice is a model that will ask twice anyway.
   */
  function planBatches(toolCalls, options) {
    const limit = (options && options.maxParallel) || MAX_PARALLEL;
    const batches = [];
    let current = [];

    for (const call of toolCalls || []) {
      if (!call) continue;
      if (effectOf(call.name) !== 'read') {
        if (current.length) { batches.push(current); current = []; }
        batches.push([call]);
        continue;
      }
      current.push(call);
      if (current.length >= limit) { batches.push(current); current = []; }
    }
    if (current.length) batches.push(current);
    return batches;
  }

  /** Iteration budgets. A read-heavy exploration is not the same shape of work
   *  as a long edit, so one fixed number served neither. */
  const BUDGET = {
    /** Normal ceiling for a single user request. */
    softLimit: 24,
    /** Absolute ceiling, whatever the agent claims it still needs. */
    hardLimit: 40,
    /** Consecutive iterations with no file change and no new tool before the
     *  loop decides it is going in circles rather than working. */
    stallLimit: 4,
  };

  /**
   * Decide whether the loop runs another iteration.
   *
   * Returns `{ continue, reason, nudge }`. `nudge` is a message to append for
   * the coming turn when the agent needs telling that the end is near — it
   * replaces the old behaviour of silently stopping and reporting a pause,
   * which left the user unable to tell "finished" from "gave up".
   */
  function shouldContinue(progress, options) {
    const budget = Object.assign({}, BUDGET, options || {});
    const iteration = progress.iteration || 0;
    const stalled = progress.stalledIterations || 0;

    if (iteration >= budget.hardLimit) {
      return { continue: false, reason: 'hard-limit',
        message: `Stopped after ${iteration} steps — the hard limit. Reply to continue from here.` };
    }
    if (stalled >= budget.stallLimit) {
      return { continue: false, reason: 'stalled',
        message: `Stopped after ${stalled} steps that changed nothing — the agent was repeating itself rather than making progress. Reply with more detail to continue.` };
    }
    if (iteration >= budget.softLimit) {
      // Past the soft limit the agent keeps going only while it is still
      // changing something. Reading in circles is not progress.
      if (!progress.madeProgress) {
        return { continue: false, reason: 'soft-limit',
          message: `Stopped after ${iteration} steps. Reply to continue from here.` };
      }
      return { continue: true, reason: 'over-soft-limit-but-progressing',
        nudge: 'You are past the normal step budget. Finish the current change and summarise; do not start anything new.' };
    }
    if (iteration === budget.softLimit - 2) {
      return { continue: true, reason: 'approaching-limit',
        nudge: 'Two steps left in the normal budget. Wrap up what you are doing.' };
    }
    return { continue: true, reason: 'within-budget' };
  }

  /**
   * Did this iteration accomplish anything?
   *
   * A write or a command is progress by definition. Reads count only when they
   * are new — re-reading the same file for the third time is the signature of
   * an agent that has lost the thread, and is exactly what the stall counter
   * is watching for.
   */
  function iterationMadeProgress(calls, seenReadTargets) {
    let progress = false;
    for (const call of calls || []) {
      if (!call) continue;
      if (effectOf(call.name) !== 'read') { progress = true; continue; }
      const target = String(
        (call.arguments && (call.arguments.path || call.arguments.dir || call.arguments.query)) || ''
      );
      const key = call.name + '::' + target;
      if (seenReadTargets && !seenReadTargets.has(key)) {
        seenReadTargets.add(key);
        progress = true;
      }
    }
    return progress;
  }

  window.HCAgentPolicy = {
    TOOL_EFFECT, BUDGET, MAX_PARALLEL,
    effectOf, planBatches, shouldContinue, iterationMadeProgress,
  };
})();
