// ==============================================================
// The two questions a Swarm run settles before the team starts
//
// What to ask the person, and what the team owes, are decided in
// js/swarm/clarify.js and js/swarm/deliverables.js, where they are checked.
// This is the part that talks: one time-limited call each, with failover to
// other models. Each question put on the page is put there as text, because
// its words came from a model.
//
// Neither call can stop a run. A model that does not answer, answers late, or
// answers something that cannot be read, costs the run the better answer and
// nothing else — the file behind each call works the answer out itself, and
// the run carries on with that.
//
// The mode hands in how to call a model, which models there are and where the
// trace goes, so this reads nothing of the mode's own.
//
// Loaded before the Agent Swarm and published as window.HCSwarmAsk. Checked by
// scripts/checks/swarm-run.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * Ask the person for details only they can give, before a run builds
   * something about them — js/swarm/clarify.js decides what to ask.
   *
   * Returns the task to run, with what they answered written in, or null when
   * they cancel. A task that needs nothing personal comes back unchanged.
   */
  async function askForDetails(task, signal, deps) {
    const C = window.HCSwarmClarify;
    const ROUTES = window.HCModelRoutes;
    const trace = deps.trace;
    trace("Checking whether the task needs details only you can give", "wait");
    const routes = ROUTES.createRun({ options: deps.models, label: deps.label, note: (m) => trace(m, "warn") });
    let model = routes.start(deps.chosen() || deps.models()[0]?.value || "");
    let questions = null;
    for (let i = 0; model && i < 3 && questions === null; i++) {
      try {
        const reply = await ROUTES.callWithin(45000, signal, "no answer within 45 s", (s) => deps.call(model, C.messages(task), s));
        questions = C.parseQuestions(reply?.content);
        if (questions === null) throw new Error("its answer could not be read");
      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) return null;
        trace(`Could not check with ${deps.label(model)} · ${String(err.message || err).slice(0, 100)}`, "warn");
        model = routes.next(model, err);
      }
    }
    if (questions === null) questions = C.fallbackQuestions(task);
    if (!questions.length) {
      trace("No personal details needed · starting", "ok");
      return task;
    }
    trace(`Asking you ${questions.length} question(s) before the team starts`, "wait");
    const answers = await showAskDialog(questions, signal);
    if (!answers) return null;
    const given = answers.filter((a) => a.answer.trim()).length;
    trace(`${given} answered · ${answers.length - given} left as marked placeholders`, "ok");
    return C.taskWithAnswers(task, answers);
  }

  /** The questions on screen; resolves with the answers, or null when cancelled. */
  function showAskDialog(questions, signal) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("amkAsk");
      const list = document.getElementById("amkAskList");
      if (!overlay || !list) { resolve(questions.map((q) => ({ question: q.question, answer: "" }))); return; }
      list.textContent = "";
      const fields = questions.map((q, i) => {
        const row = document.createElement("div");
        row.className = "amk-ask-row";
        const label = document.createElement("label");
        label.htmlFor = `amkAsk_${i}`;
        label.textContent = q.question;
        const input = document.createElement("textarea");
        input.id = `amkAsk_${i}`;
        input.className = "amk-dialog-input";
        input.rows = 2;
        if (q.hint) input.placeholder = `e.g. ${q.hint}`;
        row.append(label, input);
        list.appendChild(row);
        return input;
      });
      const answersWith = (blank) => questions.map((q, i) => ({ question: q.question, answer: blank ? "" : fields[i].value }));
      const buttons = ["amkAskStart", "amkAskSkip", "amkAskCancel"].map((id) => document.getElementById(id));
      const finish = (value) => {
        overlay.classList.remove("open");
        buttons.forEach((b, i) => b?.removeEventListener("click", handlers[i]));
        overlay.removeEventListener("keydown", onKey);
        signal?.removeEventListener("abort", onStop);
        resolve(value);
      };
      const handlers = [() => finish(answersWith(false)), () => finish(answersWith(true)), () => finish(null)];
      const onKey = (e) => {
        if (e.key === "Escape") finish(null);
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(answersWith(false));
      };
      const onStop = () => finish(null);
      buttons.forEach((b, i) => b?.addEventListener("click", handlers[i]));
      overlay.addEventListener("keydown", onKey);
      signal?.addEventListener("abort", onStop, { once: true });
      overlay.classList.add("open");
      setTimeout(() => fields[0]?.focus(), 60);
    });
  }

  /**
   * What this run owes, decided by a model that has read the task.
   *
   * The deliverables used to be looked up by category, so every build got the
   * same three files. js/swarm/deliverables.js can work a list out from the
   * request on its own, and does when this cannot be answered — but a model
   * reading the actual request does it better, and is the only one that can
   * see that a campaign needs channels and a calendar rather than a draft.
   *
   * Always returns a plan. There is no answer here that should end a run: the
   * worst case is the list this app would have chosen anyway.
   */
  async function askForDeliverables(task, signal, deps) {
    const D = window.HCSwarmDeliverables;
    const ROUTES = window.HCModelRoutes;
    const trace = deps.trace;
    trace("Working out what this task needs handed back", "wait");
    const routes = ROUTES.createRun({ options: deps.models, label: deps.label, note: (m) => trace(m, "warn") });
    let model = routes.start(deps.chosen() || deps.models()[0]?.value || "");
    let answered = null;
    let from = "";
    for (let i = 0; model && i < 3 && answered === null; i++) {
      if (signal?.aborted) break;
      try {
        const reply = await ROUTES.callWithin(45000, signal, "no answer within 45 s", (s) => deps.call(model, D.messages(task), s));
        answered = D.readPlan(reply?.content);
        if (answered === null) throw new Error("its answer could not be read");
        from = deps.label(model);
      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) break;
        trace(`Could not plan with ${deps.label(model)} · ${String(err.message || err).slice(0, 100)}`, "warn");
        model = routes.next(model, err);
      }
    }
    const plan = D.merge(answered, task);
    trace(
      answered ? `${from} planned what this run owes · ${D.summaryOf(plan)}`
               : `Worked out what this run owes from the task · ${D.summaryOf(plan)}`,
      answered ? "ok" : "warn",
    );
    return plan;
  }

  /**
   * One round asking for the faults the app found to be put right.
   *
   * The app reads the work itself when the team has finished
   * (js/swarm/project-check.js), and what it finds needs no model to see: a
   * page pointing at a file nobody wrote, an id no page has, a stylesheet
   * written in Sass. Somebody still has to write the correction, so one model
   * is asked, with the project in front of it and the faults listed.
   *
   * It is given the project rather than the conversation, and asked for only
   * the files it changes, so a round costs one call whatever the team's size.
   *
   * Returns the answer to record, or null. Like the other two calls here it
   * cannot end a run: a model that will not answer costs the repair and
   * nothing else, and what the team built is kept either way.
   */
  async function askForRepair(files, findings, signal, deps) {
    const C = window.HCSwarmProjectCheck;
    const CTX = window.HCSwarmContext;
    const ROUTES = window.HCModelRoutes;
    const trace = deps.trace;
    const note = C.repairNote(findings);
    if (!note) return null;
    const messages = [
      { role: "system", content: "You put right faults that have been found in a project by reading its files. Change only what you are asked to change. Return every file you change complete, each in its own fenced block with its file name after the language, and write nothing else." },
      { role: "user", content: `THE PROJECT AS IT STANDS:${CTX.fencesOf(files)}${note}` },
    ];
    trace(`Asking for ${C.linesOf(findings.filter((f) => f.level === "broken")).length} of them to be put right`, "wait");
    const routes = ROUTES.createRun({ options: deps.models, label: deps.label, note: (m) => trace(m, "warn") });
    let model = routes.start(deps.chosen() || deps.models()[0]?.value || "");
    for (let i = 0; model && i < 3; i++) {
      if (signal?.aborted) return null;
      try {
        const reply = await ROUTES.callWithin(90000, signal, "no answer within 90 s", (s) => deps.call(model, messages, s));
        const text = String(reply?.content || "");
        const changed = window.HCSwarmProjectFiles.extractProjectFiles(text, { guess: false });
        if (!changed.size) throw new Error("it returned no files");
        trace(`${deps.label(model)} rewrote ${[...changed.keys()].join(", ")}`, "ok");
        return text;
      } catch (err) {
        if (err.name === "AbortError" || signal?.aborted) return null;
        trace(`Could not repair with ${deps.label(model)} · ${String(err.message || err).slice(0, 100)}`, "warn");
        model = routes.next(model, err);
      }
    }
    trace("Nothing could be reached to put them right — what the team built is kept as it is", "warn");
    return null;
  }

  window.HCSwarmAsk = { askForDetails, askForDeliverables, askForRepair, showAskDialog };
})();
