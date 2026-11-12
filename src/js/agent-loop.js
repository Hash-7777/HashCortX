// ==============================================================
// The HashCoder agent loop
//
// One run of the coding agent, from a request to its answer: ask the model,
// run the tools it calls (reads together, changes one at a time, in order),
// keep the record of what changed and what proved it, send the run back when
// a finishing check finds something left to do, and stop with a reason when
// it is done, stuck or out of steps.
//
// It does not draw anything and does not know the screen it runs in. The
// mode hands it everything it needs in `o`:
//
//   messages, tools, label, signal   the conversation (changed in place), the
//                                    tools offered, a label, the stop signal
//   ui         what the run shows: trace, status, terminal, wait (a live line
//              with finish and remove), step, tool and toolDone, answer,
//              added, error, changed (a file the run changed)
//   temperature, call(messages, tools, temperature, signal, live)
//              the model, asked through the mode's router
//   compress   what the model is sent of the conversation (js/agent-context.js)
//   state, prefs   the mode's run state and its settings
//   queue(), conversation()   messages sent while it works (js/queue.js)
//   opened     pictures a tool opened, added to the conversation
//   baseName, toolObject   names for what the run shows
//   checks(ctx)   the finishing checks, built from what the run keeps:
//              { finish, left(), wrap() }
//
// Pure of the screen: scripts/checks/agent-loop.mjs runs it with a scripted
// model and no page at all.
//
// Published as window.HCAgentLoop. Checked by scripts/checks/agent-loop.mjs.
// ==============================================================

(function () {
  'use strict';

  async function run(o) {
    let { tools } = o;
    const { messages, label, signal, ui, temperature, state: sharedState, prefs: cdrPrefs, call, compress: compressHistory, queue, conversation, opened: attachPendingImages, baseName, toolObject, checks } = o;
    const H = window._H;
    const policy = window.HCAgentPolicy;
    let iter = 0;
    // A greeting to a small or mid-sized model is answered without the tools and instructions it would read first, and so is a request after it wrote its tools back as its reply (js/code/talk.js).
    let bare = (sharedState.size === 'small' || sharedState.size === 'mid') && !!window.HCCodeTalk?.onlySmallTalk(messages), echoed = false, again = false;
    if (bare) tools = [];
    // Progress tracking, so the loop can tell an agent that is working from
    // one that is going in circles. The old fixed cap could not: it stopped
    // both at the same number and reported both as "paused".
    const seenReadTargets = new Set();
    // What was changed and what proved it: js/code/verify.js.
    const proof = window.HCCodeVerify?.proofLog();
    const sentBack = sharedState.sentBack = window.HCCodeDebug.sentBack(sharedState), sent = sentBack.sent;   // how often this run was sent back, for each reason, and whether it acted after (js/code/debug-export.js)
    // What each file held before this run and holds now, for a second look at a larger change (js/code/review.js).
    const changes = new Map();
    const looks = checks({ proof, sent, changes, messages, signal, ui }), finish = looks.finish;   // the finishing checks, built by the mode from what this run keeps
    let stalledIterations = 0, loopNote = '';   // loopNote: the same file changed again and again (js/agent-policy.js editLoop)
    const edited = new Map(), asked = window.HCCodeCalls.memory(), schemaOf = (name) => (tools || []).find((t) => (t.function ? t.function.name : t.name) === name);   // asked: what this run's calls gave back (js/code/calls.js)
    let lastStop = null, forced = null;   // forced: a turn the app takes for a small model, running the test it was told to (verify.js stopCheck)
    if (!bare && (forced = window.HCCodeLookup?.turnFor(messages, window.HCCodeVerify.requestIn(messages), tools) || null)) ui.trace('Check', 'Looked up what the request names, for a model given no web tools', 'run');   // an address given or a lookup asked for, on a model with no web tools, is read or searched by the app first (js/code/lookup.js)
    let thinkEl = ui.wait();

    for (;;) {
      const verdict = policy.shouldContinue({
        iteration: iter,
        stalledIterations,
        madeProgress: stalledIterations === 0,
        changed: proof ? proof.changed.length : 0,   // an agent that has made its change, or finished its plan, is told to finish
        planDone: !!HC?.code?.plan && !!window.HCCodePlan && !window.HCCodePlan.openSteps(HC.code.plan).length,
      });
      if (!verdict.continue) { const untested = verdict.reason === 'stalled' && !sent.stall++ && cdrPrefs().prove !== false && window.HCCodeVerify.stopCheck(proof, sharedState.projectChecks?.checks, '', 0, 1); if (!untested) { lastStop = verdict; break; } stalledIterations = 0; if (untested.run) forced = { content: '', tool_calls: [{ id: `ran_${Date.now()}_0`, name: 'shell_run', arguments: untested.run }] }; else messages.push({ role: 'user', content: untested.message, note: true }); }   // a run that stalls after changing code has its test run, or its failure said, once before it stops (js/code/verify.js stopCheck)
      iter++;

      ui.status(`${label ? label + ' · ' : ''}Running`, 'thinking');   // the reply shows what it is doing (js/code/live.js)
      if (signal?.aborted) { thinkEl?.remove(); throw new DOMException('Aborted', 'AbortError'); }   // stopped: the live line goes too
      const added = messages === conversation() ? queue()?.takeNow() : null;   // what the person sent while it worked, read at this step (js/queue.js)
      if (added) { const A = window.HCCodeAttach, pack = A ? A.packed(added.text, added.files) : { content: added.text, images: [], thumbs: [] }; messages.push({ role: 'user', content: pack.content, added: true, ...(added.kinds ? { kinds: added.kinds } : {}), ...(pack.images.length ? { images: pack.images, thumbs: pack.thumbs } : {}) }); if (HC?.code) { HC.code.request = `${HC.code.request || ''}\n\n${added.text}`; const grown = window.HCCodeAsks?.split(HC.code.request) || []; if (grown.length >= (HC.code.asks || []).length) HC.code.asks = grown; } thinkEl?.remove(); ui.added(A ? A.shownRequest(pack.content) : added.text, pack.pictures, added.kinds); thinkEl = ui.wait(); ui.trace('Person', `Added ${added.count === 1 ? 'a message' : `${added.count} messages`} while it worked`, 'run'); }   // its asks join the checklist, numbered on, never shrinking (js/code/asks.js)
      if (added && (added.kinds || []).includes('correct') && window.HCCodeAdded) { const fix = window.HCCodeAdded.reopen(HC?.code?.plan); if (HC?.code && fix.step) HC.code.plan = fix.plan; messages.push({ role: 'user', content: window.HCCodeAdded.correctionNote(fix.step), note: true }); ui.trace('Person', `A correction${fix.step ? `: "${fix.step}" open again` : ''}`, 'run'); }   // a correction: the step it is about open again, and a note saying so (js/code/added.js)

      // A nudge, and the plan read back while steps are open (js/code/plan.js), go on a COPY: never saved, so the next request starts the same.
      const told = [verdict.nudge, loopNote, window.HCCodePlan?.recite(HC?.code?.plan)].filter(Boolean).join('\n\n'); loopNote = '';
      const baseMsgs = told ? [...messages, { role: 'user', content: told, note: true }] : messages;
      const callMessages = bare ? [{ role: 'system', content: window.HCCodeTalk.SHORT_SYSTEM }, ...compressHistory(baseMsgs).filter((m) => m.role !== 'system')] : sharedState.light ? window.HCCodeLight.callMessages(compressHistory(baseMsgs)) : compressHistory(baseMsgs);

      ui.trace('Step', `Iter ${iter}${label ? ' · ' + label : ''} · calling model`, 'run');
      let turn;
      try {
        turn = forced || await call(callMessages, tools, temperature, signal, thinkEl); forced = null;
      } catch (e) {
        if (queue()?.urgent && !signal?.aborted) { thinkEl?.remove(); thinkEl = ui.wait(); ui.trace('Step', 'Gave way to a message sent now', 'run'); continue; }   // "Send now": the step being written is dropped, and the message read at once
        thinkEl?.remove(); thinkEl = null;
        ui.trace('Error', e?.message || String(e), 'err');
        ui.error(e, signal?.aborted ? '' : window.HCCodeRouter.keptNote(proof ? proof.changed.map(baseName) : []));   // shown in the reply; an error after the work was done says the work is there
        throw e;
      } if (turn.cutOff && !turn.tool_calls?.length && sharedState.size !== 'full' && !sharedState.light && sent.cut++ < 2) { thinkEl?.finish(''); messages.push({ role: 'user', content: window.HCCodeVerify.cutNote(), note: true }); ui.step({ verb: 'CHECK', object: window.HCCodeVerify.CUT_STEP, status: '' }); ui.trace('Check', window.HCCodeVerify.CUT_STEP, 'warn'); thinkEl = ui.wait({ checking: true }); continue; }   // a step stopped at its limit is neither kept nor run
      // Light mode: the files in its answer become the calls a larger model makes, and a file not written whole is asked for again, twice at most (js/code/light.js).
      const lit = sharedState.light && !turn.tool_calls?.length && turn.content ? await window.HCCodeLight.turnOf(turn.content, (p) => HC.code.readWholeQuietly(window.HCCodePaths.argsFromRoot({ path: p }, sharedState.projectRoot).path), { known: window.HCCodeLight.knownFiles(sharedState.codeMap?.whole), hints: window.HCCodeLight.pathsIn(HC.code.request), rename: window.HCCodeVerify?.renameOf(window.HCCodeVerify.requestIn(messages)) }) : null;
      const dif = !lit && sharedState.size !== 'full' && !turn.tool_calls?.length && window.HCCodeVerify.unmadeChange(proof, messages, turn.content || '', 0, 1) ? window.HCCodeDiffs.turnOf(turn.content) : null;   // a change a smaller model wrote as a diff, when the request asks for one and none is made (js/code/diffs.js)
      if (lit?.calls.length || dif) turn = { ...turn, content: (lit || dif).said, tool_calls: (lit || dif).calls };
      if (lit?.note && sent.light++ < 2) {
        if (lit.calls.length) loopNote = lit.note;
        else { thinkEl?.finish(''); messages.push({ role: 'assistant', content: turn.content }, { role: 'user', content: lit.note, note: true }); ui.step({ verb: 'CHECK', object: 'Asked to write a file again, whole', status: '' }); thinkEl = ui.wait({ checking: true }); continue; }
      }
      // What the model said before a step stays in the reply, where it said it;
      // a call written as text does not, and an answer is drawn below instead.
      const said = turn.tool_calls?.length && turn.content ? window.HCCodeLive.wordsOf(turn.content).words : '';   // without a call it wrote as text (js/code/live.js)
      thinkEl?.finish(said); thinkEl = null;

      if (turn.tool_calls?.length) {
        for (const c of turn.tool_calls) if (!window.HCMcp?.systemOf?.(c.name)) c.arguments = window.HCCodePaths.argsFromRoot(window.HCCodeCalls.normalize(c.arguments, schemaOf(c.name)).args, sharedState.projectRoot);   // "src" for "from" is read as "from" (js/code/calls.js), and "src/a.js" is the project's, not a connected system's (js/code/paths.js)
        H.appendAssistantToolCallTurn(messages, turn.content, turn.tool_calls, { thinking: turn.thinking, from: turn.thinkingFrom }); // always append to real history, its thinking kept (js/model-profile.js)

        // Independent reads run together. A turn that opens six files used to
        // make six sequential round trips through Rust for no reason. Writes
        // and shell commands still run alone and in order — batching may only
        // ever merge ADJACENT reads, so a read that follows a write still
        // sees the write. The rules live in js/agent-policy.js and are tested.
        const batches = policy.planBatches(turn.tool_calls);

        // Results are kept per call and appended in the ORIGINAL order, whatever order they finish in:
        // the provider APIs require each tool result to follow its call, and reject a shuffled history.
        const results = new Map(), failures = new Map();
        const checked = proof ? proof.checks.length : 0;   // checks before this turn's calls

        async function runOne(call) {
          // Shell preview goes to the terminal before the command runs.
          if (call.name === 'shell_run') {
            const cmd = call.arguments?.command || '';
            const args = (call.arguments?.args || []).join(' ');
            const cwd = call.arguments?.cwd || sharedState.projectRoot || '';
            const preview = cwd ? `cd ${cwd} && ${cmd} ${args}` : `${cmd} ${args}`;
            ui.terminal('[' + call.name + ' preview] ' + preview, 'cdr-bash-preview');
          }

          const toolEl = ui.tool(call.name, call.arguments);
          const pathHint = call.arguments?.path || call.arguments?.dir || call.arguments?.command || '';
          ui.trace('Tool', call.name + (pathHint ? ' · ' + baseName(pathHint) : ''), 'run');
          const t0 = performance.now();
          let resultStr, ok = true;
          const early = asked.before(call, (id, text) => compressHistory(messages).some((m) => m.role === 'tool' && m.tool_call_id === id && m.content === text), window.HCMcp?.systemOf?.(call.name) ? null : schemaOf(call.name)) || (!window.HCMcp?.systemOf?.(call.name) && await window.HCCodeSeen?.before(call, messages, { root: sharedState.projectRoot, whole: sharedState.codeMap?.root === sharedState.projectRoot ? sharedState.codeMap.whole : '', current: HC.code.readWholeQuietly, uses: HC.code.linesQuietly })) || null;   // and a change to a file not read, changed since, or whose users are not read, is answered without making it (js/code/seen.js)   // a call missing what it needs, the same failure again, or a read of what has not changed and is still shown, is answered without making it (js/code/calls.js)
          try {
            const own = (HC?.code?.TOOL_DEFINITIONS || []).find(t => t.name === call.name), def = window.HCMcp ? window.HCMcp.toolFor(call.name, own) : own;   // connected tools — js/mcp/connections.js
            if (!def) throw new Error('Unknown tool: ' + call.name);
            const raw = early ? early.result : await (def.fn ? def.fn(call.arguments || {}) : def.execute(call.arguments || {}));
            resultStr = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            if ((!def.fn && raw?.error) || (early && !early.ok)) ok = false;
          } catch (e) {
            resultStr = JSON.stringify({ error: String(e?.message || e) }); ok = false;
          }
          const ms = Math.round(performance.now() - t0);
          ui.trace('Tool', call.name + ' · ' + window.HCCodeSteps.duration(ms), ok ? 'ok' : 'err');
          ui.toolDone(toolEl, resultStr, ok, ms);
          if (!ok && /safety list|protected location/.test(resultStr)) HC.guard?.noteBlocked?.();   // a refused place counts toward Auto asking about everything

          // A row is offered only for a change that happened. A refused or
          // failed call has no record of its own, and the row would pick up
          // the file's previous one, so its Undo reversed an earlier change.
          if (proof && ok) { sentBack.worked(call);   // a change or a command, for the counts kept with the run
            const a = call.arguments || {};
            const touched = { write_file: [a.path], patch_file: [a.path], delete_file: [a.path], move_file: [a.from, a.to] }[call.name];
            if (touched) touched.forEach((p) => { proof.edited(p); window.HCCodeReview?.track(changes, p, HC?.undo?.lastFor?.(p)); });
            else if (call.name === 'shell_run') { try { proof.ran(a.command, a.args, JSON.parse(resultStr)); } catch {} }
          }
          if (ok && ['write_file', 'patch_file', 'delete_file', 'move_file'].includes(call.name)) toolEl?.remove();   // its change row, with Keep and Undo, says it
          if (ok) ui.changed(call, resultStr);
          results.set(call, resultStr); if (!ok) failures.set(call, resultStr); if (!early) asked.after(call, resultStr, ok);   // only calls really made are remembered
        }

        for (const batch of batches) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          ui.status(batch.length > 1
            ? `${batch.length} tools…`
            : `${batch[0].name}…`, 'run');
          // A failure inside runOne is already turned into an error result,
          // so allSettled is belt-and-braces: one tool must never abort the
          // rest of its batch.
          await Promise.allSettled(batch.map(runOne));
        }

        loopNote = policy.editLoop(edited, turn.tool_calls, !!proof && proof.checks.slice(checked).some((c) => c.pass)) || loopNote;
        // Original order, so every result follows the call it answers.
        for (const call of turn.tool_calls) {
          H.appendToolResult(messages, call, results.get(call) ?? JSON.stringify({ error: 'no result' }));
        }
        attachPendingImages(messages);

        // Is this agent still getting somewhere, or reading the same files
        // round and round? The stall counter is what tells them apart.
        if (policy.iterationMadeProgress(turn.tool_calls, seenReadTargets, failures)) stalledIterations = 0;   // a call failing the way it failed before is not progress
        else stalledIterations++;

        thinkEl = ui.wait({ after: window.HCCodeLive.afterOf(turn.tool_calls, results, toolObject) });
        continue;
      }

      // Final answer — hide reasoning, show result
      const finalText = turn.content || '';
      if (!echoed && window.HCCodeTalk?.echoesTools(finalText, tools)) { echoed = bare = true; tools = []; thinkEl = ui.wait(); ui.trace('Check', 'The model wrote its tool list back as its reply: asking again without tools', 'warn'); continue; }
      if (HC?.code) HC.code.said = finalText;   // what it said as it finished, which the brief reads (js/run-view.js)
      let back = null; for (const f of finish) if ((!f.words || finalText.trim()) && (back = await f.run(finalText))) break;   // the first finishing check with something to say sends it back
      if (back) {
        sent[back.kind]++; if (back.kind === 'example') proof?.exampled();   // run again, once, after a later change
        if (back.run && (sharedState.size === 'small' || sharedState.light || back.kind === 'example' || back.kind === 'passed' || (back.kind === 'prove' && sent.prove > 1))) forced = { content: '', tool_calls: (back.runs || [back.run]).map((run, i) => ({ id: `ran_${Date.now()}_${i}`, name: 'shell_run', arguments: run })) };   // its word that the test passed is not kept; any model told once to run it, that wrote it into its reply instead, has it run too
        else messages.push({ role: 'assistant', content: finalText }, { role: 'user', content: back.message, note: true });
        ui.step({ verb: 'CHECK', object: forced && back.kind !== 'passed' ? window.HCCodeVerify.RAN_STEP : back.step, status: '' });
        ui.trace('Check', back.step, 'run');
        thinkEl = ui.wait({ checking: true });
        continue;
      }
      if (!finalText.trim() && !again && (again = window.HCCodeVerify.askAgainAfterNote(messages))) { ui.trace('Check', 'An empty reply to a note: asking once more', 'warn'); thinkEl = ui.wait({ checking: true }); continue; }   // js/code/verify.js
      if (!finalText.trim()) {
        ui.trace('Done', 'Empty response from model', 'warn');
        ui.answer('*No response from model. Try again or check your model settings.*');
      } else {
        ui.trace('Done', (label || 'Agent') + ' · ' + finalText.length + ' chars', 'ok');
        ui.answer(finalText);
      }
      // What was proven, from the record rather than from the reply, and what is left of its plan; kept with the answer, so a saved conversation says it too.
      const { unconfirmed, gone, outside } = looks.left();   // what the details and the kept checks found
      const proven = [proof && window.HCCodeVerify.proofLine(proof), window.HCCodeFacts?.leftLine(unconfirmed), window.HCCodeKeep?.goneLine(gone), window.HCCodeSite?.outsideLine(outside), window.HCCodeVerify.claimLine(finalText, messages), window.HCCodeVerify.saidLine(finalText, proof), window.HCCodeVerify.passedLine(finalText, proof), window.HCCodePlan?.leftLine(HC?.code?.plan)].filter(Boolean).join(' ');
      sharedState.proven = proven || ''; if (proven) ui.answer(`*${proven}*`);
      return finalText;
    }
    // The budget ran out while the model was still calling tools. Strip any
    // dangling tool turns so the next user message does not produce an
    // invalid sequence like [tool, user], which most provider APIs reject.
    thinkEl?.remove(); thinkEl = null;
    const stop = lastStop || { reason: 'unknown', message: 'Stopped. Reply to continue.' };
    // At the step limit, or stuck after changing files, the finishing checks run from the record and the model says once, with no tools, what it did and what is left (js/agent-policy.js wrapUp).
    const summary = await policy.wrapUp({ reason: stop.reason, changed: proof ? proof.changed.length : 0, signal, messages, check: () => proof?.changed.length && cdrPrefs().prove !== false && looks.wrap(), words: (r) => window.HCCodeLive.wordsOf(r?.content || '').words,
      ask: (asked) => { const wait = ui.wait({ checking: true }); ui.trace('Check', 'Asked for an account of the run at the step limit', 'run'); return call(sharedState.light ? window.HCCodeLight.callMessages(compressHistory(asked)) : compressHistory(asked), [], temperature, signal).finally(() => wait?.remove()); } });
    while (messages.length && messages[messages.length - 1].role === 'tool') messages.pop();
    while (messages.length && messages[messages.length - 1].role === 'assistant' &&
           Array.isArray(messages[messages.length - 1].tool_calls)) messages.pop();

    // Say WHY it stopped. "Task paused" was shown whether the agent had run
    // out of budget or spent four turns re-reading the same file, and the
    // user could not tell which — so they could not tell whether replying
    // "continue" would help or repeat the same loop.
    ui.trace('Done', `Stopped: ${stop.reason} after ${iter} steps`, 'warn');
    const { unconfirmed, outside } = looks.left();
    const said = [stop.message, proof && summary ? window.HCCodeVerify.proofLine(proof) : '', window.HCCodeFacts?.leftLine(unconfirmed), window.HCCodeSite?.outsideLine(outside), window.HCCodePlan?.leftLine(HC?.code?.plan)].filter(Boolean).join(' '), account = messages[messages.length - 1];
    if (summary) { ui.answer(summary); if (account?.role === 'assistant' && account.content === summary) account.proven = said; }   // wrapUp added the account to the conversation; a saved one shows the line under it too
    ui.answer(`*${said}*`); return summary;   // what the record shows, beside the model's account
  }

  window.HCAgentLoop = { run };
})();
