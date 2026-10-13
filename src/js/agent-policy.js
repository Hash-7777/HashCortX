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
// No DOM, no IPC, no clock: what wrapUp needs from the app is handed to it.
// Checked by scripts/checks/agent-policy.mjs.
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
    update_plan: 'read',   // keeps a checklist; changes nothing on disk
    save_lesson: 'write',  // keeps a lesson in the app's own storage
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
   * which left the user unable to tell "finished" from "gave up". `changed`
   * says the run has changed files, and `planDone` that every step of its
   * plan is marked done: an agent in either state is told to finish.
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
      // After changes were made, the steps that followed were looking again
      // rather than going round in circles, and the person is told so.
      return { continue: false, reason: 'stalled',
        message: progress.changed
          ? `Stopped: the agent made its changes, then spent ${stalled} steps looking at files again without finishing. The changes are above, each with Keep and Undo. Reply to have it carry on.`
          : `Stopped after ${stalled} steps that changed nothing — the agent was repeating itself rather than making progress. Reply with more detail to continue.` };
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
    if (stalled >= 2) {
      return { continue: true, reason: 'repeating',
        nudge: progress.planDone
          ? 'Every step of your plan is done, and your last steps changed nothing. Finish now: say in two or three sentences what you changed and what you checked. If something is still wrong, fix it instead.'
          : progress.changed
            ? 'Your last steps looked at files again and changed nothing. If the change is complete, finish now with what you changed and what you checked; if it is not, make the next change.'
            : 'Your last steps repeated what you had already done and changed nothing. Do something different. What you read is above: do not read it again. Make the change now with patch_file, its search copied from the file as it is above, or finish and say what is in the way.' };
    }
    return { continue: true, reason: 'within-budget' };
  }

  /**
   * Did this iteration accomplish anything?
   *
   * A write or a command is progress, unless it is one this run already made
   * with the same arguments: a small model ran the same failing test again
   * and again without ever opening the file it named, and each run counted
   * as progress, so nothing stopped it. Reads count only when they are new —
   * re-reading the same file for the third time is the signature of an agent
   * that has lost the thread, and is exactly what the stall counter is
   * watching for. A read is the same read only when everything it asks is
   * the same: a search for other words in the same folder, or another part of
   * a long file, is new, and so is a plan with a step newly marked done. A
   * file the run has just changed is new to read again, and so is any folder
   * holding it: reading back a change is checking it.
   *
   * A call that failed is progress only the first time it fails that way.
   * Asked to make a folder, a model called move_file six times with the
   * wrong argument names, a little differently each time, and failed the
   * same way each time; each counted as a new call, so nothing slowed it.
   * `failures` holds what each failed call gave back; the failure is told
   * from others by the tool and the start of its error.
   */
  function iterationMadeProgress(calls, seenReadTargets, failures) {
    let progress = false;
    for (const call of calls || []) {
      if (!call) continue;
      if (failures && failures.has(call)) {
        const key = `fail::${call.name}::${errorStart(failures.get(call))}`;
        if (!seenReadTargets || !seenReadTargets.has(key)) { if (seenReadTargets) seenReadTargets.add(key); progress = true; }
        continue;
      }
      if (effectOf(call.name) !== 'read') {
        const same = 'call::' + call.name + '::' + JSON.stringify(call.arguments || {});
        if (!seenReadTargets) { progress = true; continue; }
        if (!seenReadTargets.has(same)) {
          seenReadTargets.add(same);
          progress = true;
          const changed = changedPaths(call);
          if (changed.length) {
            for (const key of [...seenReadTargets]) {
              if (!key.startsWith('call::') && changed.some((p) => covers(key.split('::')[1], p))) seenReadTargets.delete(key);
            }
          }
        }
        continue;
      }
      const key = readKey(call);
      if (seenReadTargets && !seenReadTargets.has(key)) {
        seenReadTargets.add(key);
        progress = true;
      }
    }
    return progress;
  }

  /** The start of a failed call's error, which says how it failed without the paths and values after. */
  function errorStart(result) {
    let text = String(result == null ? '' : result);
    try { const o = JSON.parse(text); if (o && o.error != null) text = String(o.error); } catch { /* not JSON */ }
    return text.replace(/\s+/g, ' ').trim().slice(0, 48);
  }

  /** What a read looks at, and exactly how: its target, then every argument it gave. */
  function readKey(call) {
    const a = call.arguments || {};
    return `${call.name}::${String(a.path || a.dir || a.query || '')}::${JSON.stringify(a)}`;
  }

  /** Whether a read of `target` looks at `path`: the file itself, or a folder holding it. */
  function covers(target, path) {
    const t = String(target || '').replace(/[\\/]+$/, '');
    return !!t && (path === t || path.startsWith(t + '/') || path.startsWith(t + '\\'));
  }

  /** The files a call changes: the one a write names, or both ends of a move. */
  function changedPaths(call) {
    const a = (call && call.arguments) || {};
    const paths = call && call.name === 'move_file' ? [a.from, a.to] : EDIT_TOOLS.has(call && call.name) || (call && call.name === 'delete_file') ? [a.path] : [];
    return paths.filter((p) => typeof p === 'string' && p);
  }

  // ── A run that stops before it finishes ────────────────────────────────
  //
  // A run that reached its step limit stopped where it was. The person saw a
  // line saying it had stopped and nothing about what it had done, and the
  // checks a run meets when it finishes (the site read as a browser reads it,
  // the details a page states) never ran, so a page left with a line in
  // square brackets or a guessed detail said nothing about it. Now, when a
  // run stops at the step limit, or stops going round in circles after it
  // changed files, the model is asked once, with no tools, to say what it
  // changed, what it checked and what is left.

  /** The note asking for that account, or '' when the stop needs none. `changed` is how many files the run changed. */
  function wrapUpNote(reason, changed) {
    const atLimit = reason === 'hard-limit' || reason === 'soft-limit';
    if (!atLimit && !(reason === 'stalled' && changed > 0)) return '';
    return 'Note from HashCortX, not from the person: this request has used all the steps it is given, so the run stops here and no tool can be called. ' +
      'In a few short sentences, say what you changed and in which files, what you checked, and what is still not done, not checked or not confirmed. ' +
      'Say only what the steps above show; if you did not check something, say so.';
  }

  /**
   * Ask for that account, when the stop needs one. `check()` runs the
   * finishing checks from the record first; `ask(messages)` makes one model
   * call with no tools; `words(reply)` is the text kept. The note and the
   * account are added to `messages`, so the conversation goes on from them.
   * Returns the account, or '' when none was needed or none came. A stop the
   * person made throws as it would anywhere; any other failure leaves the
   * stop as it was.
   */
  async function wrapUp({ reason, changed = 0, signal = null, messages, check = null, ask, words = (r) => (r && r.content) || '' }) {
    const note = signal && signal.aborted ? '' : wrapUpNote(reason, changed);
    if (!note) return '';
    if (check) await Promise.resolve().then(check).catch(() => null);
    let said = '';
    try { said = String(words(await ask([...messages, { role: 'user', content: note, note: true }])) || '').trim(); }
    catch (e) { if (signal && signal.aborted) throw e; return ''; }
    if (said) messages.push({ role: 'user', content: note, note: true }, { role: 'assistant', content: said });
    return said;
  }

  // ── The same file changed again and again ──────────────────────────────
  //
  // An agent whose change does not work often changes the same file again,
  // and again, each time around the damage, without reading why it failed.
  // Edits to one file are counted since the last check that passed; at
  // EDIT_LOOP of them, and again at twice that, the agent is told to stop and
  // read the file and the error before changing it once more.

  const EDIT_LOOP = 4;
  const EDIT_TOOLS = new Set(['write_file', 'patch_file']);

  /**
   * The note for this turn's edits, or ''. `counts` is a Map the loop keeps
   * for the run; `passed` whether a check passed in this turn, which starts
   * every count again.
   */
  function editLoop(counts, calls, passed, limit = EDIT_LOOP) {
    if (!counts) return '';
    if (passed) { counts.clear(); return ''; }
    let note = '';
    for (const call of calls || []) {
      if (!call || !EDIT_TOOLS.has(call.name)) continue;
      const path = String((call.arguments && call.arguments.path) || '');
      if (!path) continue;
      const times = (counts.get(path) || 0) + 1;
      counts.set(path, times);
      if (times !== limit && times !== limit * 2) continue;
      note = `Note from HashCortX, not from the person: you have changed, or tried to change, ${path.split(/[\\/]/).pop()} ` +
        `${times} times in this run with no check passing since. Stop changing it for a moment: read the file as it is now ` +
        'and the last error in full, find the cause, and make the one change that fixes it. If something outside this file is in the way, say what.';
    }
    return note;
  }

  /**
   * Whether what a tool handed back says it failed. A tool may fail by
   * answering `{ error }` or `{ ok: false }` rather than by throwing; counted
   * as a success, a memory save that saved nothing was reported as saved, and
   * a read that was refused as records the chat now held.
   */
  const failedResult = (result) => !!result && typeof result === 'object' && !Array.isArray(result)
    && (result.error != null && result.error !== false || result.ok === false);

  // ── A ceiling on one multi-step generation ──────────────────────────────
  //
  // A pipeline that retries and then fails over has no natural end. ERP's
  // generation is four direct attempts, each with a JSON-repair call, and then
  // a whole second multi-phase pipeline that retries three more times — and
  // every failure moves to the next provider rather than stopping. Nothing
  // bounded the total, so a run that could not succeed did not fail: it worked
  // through every model the user had configured, twice, with no end in sight.
  // That is what "it never finishes" is.
  //
  // The clock is passed in rather than read, so the rule can be checked.

  const RUN_BUDGET = {
    /** Wall-clock ceiling for one generation. */
    ms: 4 * 60 * 1000,
    /** Ceiling on model calls, so a run of fast failures also ends. */
    calls: 14,
  };

  function newRunBudget(now, options) {
    const limits = Object.assign({}, RUN_BUDGET, options || {});
    return {
      startedAt: now,
      deadline: now + limits.ms,
      callsUsed: 0,
      maxCalls: limits.calls,
      limitMs: limits.ms,
    };
  }

  /**
   * Whether one more model call is allowed.
   *
   * Returns `null` to proceed, or a reason the caller can show. The message
   * says what was spent, because "generation failed" after four silent minutes
   * tells the user nothing about whether to retry or change model.
   */
  function runBudgetExceeded(budget, now) {
    if (!budget) return null;
    if (now >= budget.deadline) {
      return `Stopped after ${Math.round(budget.limitMs / 1000)}s and ${budget.callsUsed} model call(s). `
        + `The selected model is not returning a usable result — try a different one.`;
    }
    if (budget.callsUsed >= budget.maxCalls) {
      return `Stopped after ${budget.maxCalls} model calls. `
        + `The selected model is not returning a usable result — try a different one.`;
    }
    return null;
  }

  /** Count a call against the budget. Separate so a refusal costs nothing. */
  function chargeRunBudget(budget) {
    if (budget) budget.callsUsed++;
    return budget;
  }

  window.HCAgentPolicy = {
    TOOL_EFFECT, BUDGET, MAX_PARALLEL, RUN_BUDGET,
    effectOf, planBatches, shouldContinue, iterationMadeProgress, failedResult, EDIT_LOOP, editLoop, wrapUpNote, wrapUp,
    newRunBudget, runBudgetExceeded, chargeRunBudget,
  };
})();
