// ==============================================================
// Asking the person, before a Swarm run builds something about them
//
// What to ask, how to read a model's answer and how the answers reach the team
// are in js/swarm/clarify.js, where they are checked. This is the part that
// talks: one time-limited call to decide, with failover to other models, then
// the questions on screen. Each question is put on the page as text, because
// its words came from a model.
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

  window.HCSwarmAsk = { askForDetails, showAskDialog };
})();
