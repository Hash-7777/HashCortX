// ==============================================================
// Swarm runs, kept as conversations with versions of their files
//
// A Swarm run used to leave behind one block of text on its blueprint, in
// localStorage — the store that also holds every API key and fails silently
// when it is full — and what each agent said was thrown away when the run
// ended. So there was nothing to go back to, and no one to talk to.
//
// A run is now a record of its own: the task, a snapshot of the agents that
// did it, every turn of the conversation under the name of whoever said it,
// and every version of the files it produced. Versions are never overwritten,
// so any change can be undone.
//
// Two halves. The functions that build and change a run are pure and are
// checked without a browser. The storage underneath is IndexedDB, the same
// kind of store the Virtual OS keeps its projects in, and is verified in the
// headless browser.
//
// Loaded after js/swarm/project-files.js, before the Agent Swarm, and
// published as window.HCSwarmRuns. Checked by scripts/checks/swarm-workspace.mjs.
// ==============================================================

(function () {
  'use strict';

  // ── A run, built and changed without side effects ──────────────────────

  /** What of an agent is kept with a run, so it can be talked to later even
   *  if its blueprint is changed or deleted afterwards. */
  function snapshotAgent(a) {
    return {
      id: String(a.id), name: String(a.name || a.id), icon: a.icon || '', role: a.role || '',
      systemPrompt: a.systemPrompt || '', model: a.model || '',
      temperature: typeof a.temperature === 'number' ? a.temperature : undefined,
      tools: Array.isArray(a.tools) ? a.tools.slice() : [],
    };
  }

  function newRun({ id, blueprint, task, now }) {
    const bp = blueprint || {};
    return {
      id: String(id),
      blueprintId: String(bp.id || ''),
      blueprintName: String(bp.name || ''),
      leadAgentId: bp.finalOutputAgentId || '',
      edges: Array.isArray(bp.dag?.edges) ? bp.dag.edges.map((e) => ({ from: e.from, to: e.to })) : [],
      task: String(task || ''),
      startedAt: now,
      agents: (bp.agents || []).map(snapshotAgent),
      turns: task ? [{ who: 'you', text: String(task), at: now, status: 'ok' }] : [],
      versions: [],
    };
  }

  /** The run with one more turn on the end. */
  function withTurn(run, { who, text, at, status = 'ok' }) {
    return { ...run, turns: [...run.turns, { who: String(who), text: String(text ?? ''), at, status }] };
  }

  /** The files as they stand in the latest version, or none. */
  function currentFiles(run) {
    const last = run.versions[run.versions.length - 1];
    return last ? last.files : {};
  }

  /**
   * The run with a new version: the latest files with `changed` laid over the
   * top. A change that alters nothing makes no version, so the history is a
   * list of real changes rather than of every reply.
   */
  function withVersion(run, { by, at, changed }) {
    const before = currentFiles(run);
    const after = { ...before };
    let different = false;
    for (const [name, file] of Object.entries(changed || {})) {
      const prev = before[name];
      if (!prev || prev.content !== file.content || prev.lang !== file.lang) different = true;
      after[name] = { lang: file.lang || '', content: String(file.content ?? '') };
    }
    if (!different) return run;
    const rev = (run.versions[run.versions.length - 1]?.rev || 0) + 1;
    return { ...run, versions: [...run.versions, { rev, by: String(by), at, files: after, changed: Object.keys(changed) }] };
  }

  /** Named files found in a piece of an answer, as a plain object. */
  function filesFromText(text) {
    const found = window.HCSwarmProjectFiles.extractProjectFiles(text || '');
    const out = {};
    for (const [name, file] of found) out[name] = { lang: file.lang || '', content: file.content };
    return out;
  }

  /**
   * A finished run, built from what the agents returned.
   *
   * Each agent's work becomes a turn under its own name, in the order the
   * blueprint lists them, including the ones that failed or never ran, so the
   * conversation shows the whole run and not only what succeeded. The files
   * are gathered from each agent's work in that order, then from the final
   * result on top, so a later correction replaces what it corrects.
   */
  function recordRun(run, { results, finalOutput, at }) {
    let r = run;
    let files = {};
    for (const agent of r.agents) {
      if (!(agent.id in (results || {}))) continue;
      const text = String(results[agent.id] ?? '');
      const status = /^Skipped: /.test(text) ? 'skipped' : /^Error: /.test(text) ? 'error' : 'ok';
      r = withTurn(r, { who: agent.id, text, at, status });
      if (status === 'ok') files = { ...files, ...filesFromText(text) };
    }
    if (finalOutput != null) {
      r = withTurn(r, { who: 'team', text: String(finalOutput), at, status: 'ok' });
      files = { ...files, ...filesFromText(finalOutput) };
    }
    return Object.keys(files).length ? withVersion(r, { by: 'team', at, changed: files }) : r;
  }

  /**
   * A run made from a result saved before runs existed: the blueprint's
   * `lastOutput`, which has the task in it and nothing about who did what.
   */
  function fromLegacyOutput({ id, blueprint, output, now }) {
    const text = String(output || '');
    const task = (/^\*Task: (.*)\*$/m.exec(text) || [])[1] || '';
    const base = newRun({ id, blueprint, task, now });
    return recordRun(base, { results: {}, finalOutput: text, at: now });
  }

  function makeRunId(now, random) {
    return `run_${Number(now).toString(36)}_${String(random).replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
  }

  // ── Storage ────────────────────────────────────────────────────────────

  const DB_NAME = 'hashcortx_swarm_runs';
  const STORE = 'runs';
  let dbPromise = null;

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('blueprintId', 'blueprintId', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  const done = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function saveRun(run) {
    const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
    await done(store.put(run));
    return run;
  }

  async function getRun(id) {
    if (!id) return null;
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    return (await done(store.get(String(id)))) || null;
  }

  /** Every run of a blueprint, newest first. */
  async function runsFor(blueprintId) {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const all = await done(store.index('blueprintId').getAll(String(blueprintId)));
    return (all || []).sort((a, b) => b.startedAt - a.startedAt);
  }

  async function deleteRun(id) {
    const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
    await done(store.delete(String(id)));
  }

  // ── The two calls a run makes ──────────────────────────────────────────

  /** A new run for a blueprint and task, started now. */
  function startRun(blueprint, task) {
    const now = Date.now();
    return newRun({ id: makeRunId(now, Math.random().toString(36).slice(2)), blueprint, task, now });
  }

  /**
   * Record what the agents returned and keep the run. Never throws: a run
   * that could not be kept must not undo the work it recorded, so a storage
   * failure comes back as `error` for the caller to report.
   */
  async function finishRun(run, { results, finalOutput }) {
    const done = recordRun(run, { results, finalOutput, at: Date.now() });
    try {
      await saveRun(done);
      return { run: done, error: null };
    } catch (err) {
      return { run: null, error: String(err?.message || err) };
    }
  }

  window.HCSwarmRuns = {
    startRun, finishRun,
    newRun, withTurn, withVersion, currentFiles, filesFromText, recordRun, fromLegacyOutput,
    snapshotAgent, makeRunId,
    saveRun, getRun, runsFor, deleteRun,
  };
})();
