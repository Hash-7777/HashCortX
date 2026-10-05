// ==============================================================
// An Agent Swarm run, written out for finding what went wrong
//
// The Result shows what a person wants from a run: the conversation and the
// files. What went wrong is rarely there. It is in which model each agent was
// on and which one really answered, the order the agents ran in and how long
// each took, which of them failed and with what, the instructions each was
// given, and the trace the run left as it went. This writes all of that as one
// markdown file that reads from the top:
//
//   • The facts: the app, the platform, the blueprint (its shape and how the
//     answers are joined), the run (when, how many passes, its task and plan).
//   • The team: each agent's role, model, temperature and tools, and its
//     instructions, folded; who hands work to whom.
//   • The trace, as the run kept it when it ended, or as the panel shows it
//     now for a run that was not kept.
//   • The conversation, turn by turn, with each failure marked.
//   • The files: every version, what it changed, and the files of the newest.
//
// Whatever is shaped like a key is replaced before it is written, by the same
// rules as HashCoder's export (js/code/debug-export.js), and the file says how
// many were. A file the agents wrote is otherwise kept as written.
//
// buildReport is pure. traceRows reads the trace panel, and exportReport
// gathers and saves. Loaded after js/code/debug-export.js and before the Agent
// Swarm, published as window.HCSwarmDebug. Checked by
// scripts/checks/swarm-debug.mjs.
// ==============================================================

(function () {
  'use strict';

  const D = () => window.HCCodeDebug;
  const PP = () => window.HCPromptPrivacy;
  const MAX_FILE = 40000;

  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const count = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
  const stamp = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : 'unknown');
  const folded = (summary, text, lang = 'text') => ['<details><summary>' + cell(summary) + '</summary>', '', D().fenced(text, lang), '', '</details>', ''];

  /**
   * The rows of the trace panel as data: `{ time, agent, status, message, tokens }`.
   * The status is read from the row's own class, the way the panel colours it.
   */
  function traceRows(host) {
    if (!host || !host.querySelectorAll) return [];
    return [...host.querySelectorAll('.amk-trace-entry')].map((row) => {
      const text = (sel) => (row.querySelector(sel)?.textContent || '').trim();
      const kind = (row.querySelector('.trace-msg')?.className || '').match(/trace-(ok|err|warn|wait|run|boss|done)\b/);
      return { time: text('.trace-time').replace(/^\[|\]$/g, ''), agent: text('.trace-agent'), status: kind ? kind[1] : '', message: text('.trace-msg'), tokens: text('.trace-tokens') };
    }).filter((r) => r.agent || r.message);
  }

  /**
   * The whole report.
   *
   *   blueprint  the blueprint the run belongs to (its name, shape, joining)
   *   run        the kept run (js/swarm/runs.js), or null for one not kept
   *   trace      rows as traceRows gives them
   *   facts      { version, platform, settings: { name: value } }
   *   label(v)   a model's name as the menus show it
   */
  function buildReport({ blueprint = null, run = null, trace = [], facts = {}, label = (v) => v, exportedAt = new Date() } = {}) {
    let redacted = 0;
    const safe = (text) => { const r = D().redact(text); redacted += r.count; return r.text; };
    const bp = blueprint || {};
    const agents = (run && run.agents) || bp.agents || [];
    const name = (id) => (agents.find((a) => a.id === id) || {}).name || id;
    const turns = (run && run.turns) || [];
    const failed = turns.filter((t) => t.status === 'error' || t.status === 'skipped');
    const passes = turns.filter((t) => t.who === 'you').length;
    const versions = (run && run.versions) || [];
    const latest = versions[versions.length - 1] || null;
    const settings = Object.entries(facts.settings || {}).map(([k, v]) => `${k} ${v}`).join(' · ');

    const body = [];
    body.push('## The team', '');
    if (!agents.length) body.push('No agents.', '');
    else {
      body.push('| Agent | Role | Model | Temperature | Tools |', '| --- | --- | --- | ---: | --- |');
      for (const a of agents) body.push(`| ${cell(a.name)} | ${cell(a.role)} | ${cell(a.model ? `${label(a.model)} (${a.model})` : 'the model picked for the run')} | ${Number.isFinite(a.temperature) ? a.temperature : ''} | ${cell((a.tools || []).join(', '))} |`);
      body.push('');
      const edges = (run && run.edges) || (bp.dag && bp.dag.edges) || [];
      body.push(edges.length ? `Who hands work to whom: ${edges.map((e) => `${name(e.from)} → ${name(e.to)}`).join(', ')}.` : 'No links between the agents: each works on its own.', '');
      const lead = (run && run.leadAgentId) || bp.finalOutputAgentId;
      if (lead) body.push(`The lead, whose answer is the result: ${name(lead)}.`, '');
      // An agent's own instructions are the team's, shown in the Swarm; what the app adds after them is not (js/prompt-privacy.js).
      for (const a of agents) {
        if (!a.systemPrompt) continue;
        const { own, app } = PP().splitSwarm(a.systemPrompt);
        body.push(...folded(`Instructions for ${a.name}`, `${safe(D().cut(own, D().MAX_CHARS))}${app ? `\n\n${PP().withheld('added by the app', app)}` : ''}`));
      }
    }

    body.push('## Trace', '');
    if (!trace.length) body.push('Nothing was recorded.', '');
    else {
      body.push('| Time | Agent | Status | What | Tokens |', '| ---: | --- | --- | --- | ---: |');
      for (const r of trace) body.push(`| ${cell(r.time)} | ${cell(r.agent)} | ${cell(r.status)} | ${cell(safe(r.message))} | ${cell(r.tokens)} |`);
      body.push('');
    }

    body.push('## Conversation', '');
    if (!turns.length) body.push(run ? 'The run has no turns.' : 'This run was not kept, so only its trace is here.', '');
    turns.forEach((t, i) => {
      const who = t.who === 'you' ? 'the person' : t.who === 'team' ? 'the team\'s result' : `${name(t.who)}${(agents.find((a) => a.id === t.who) || {}).role ? ` (${agents.find((a) => a.id === t.who).role})` : ''}`;
      const mark = t.status === 'error' ? ' — failed' : t.status === 'skipped' ? ' — did not run' : t.status === 'resume' ? ' — run again for the agents that did not finish' : '';
      body.push(`### ${i + 1} · ${who}${mark}`, '', `At ${stamp(t.at)}.`, '');
      const text = safe(D().cut(t.who === 'you' ? PP().taskAsAsked(t.text) : t.text, D().MAX_CHARS));
      if (text.length > 1500) body.push(...folded(count(String(t.text || '').length, 'character', 'characters'), text, 'markdown'));
      else body.push(D().fenced(text, 'markdown'), '');
    });

    body.push('## Files', '');
    if (!versions.length) body.push('The run made no files.', '');
    else {
      for (const v of versions) body.push(`- v${v.rev}, by ${v.by === 'team' ? 'the team' : name(v.by)}, at ${stamp(v.at)}: changed ${(v.changed || []).join(', ') || 'nothing'}.`);
      body.push('', `The files of v${latest.rev}:`, '');
      for (const [file, f] of Object.entries(latest.files || {})) {
        const content = String((f && f.content) || '');
        body.push(...folded(`${file} · ${f.lang || 'text'} · ${count(content.split('\n').length, 'line', 'lines')}`, safe(D().cut(content, MAX_FILE)), f.lang || ''));
      }
    }

    const head = [
      '# Agent Swarm debug export',
      '',
      `- Exported: ${exportedAt instanceof Date ? exportedAt.toLocaleString() : String(exportedAt)}`,
      `- App: HashCortx${facts.version ? ` ${facts.version}` : ''}${facts.platform ? ` on ${facts.platform}` : ''}`,
      `- Blueprint: ${bp.name || (run && run.blueprintName) || 'unnamed'} · ${bp.topology || 'pipeline'} · answers joined by ${bp.aggregation || 'synthesis'} · ${count(agents.length, 'agent', 'agents')}`,
      run ? `- Run: started ${stamp(run.startedAt)} · ${count(passes, 'pass', 'passes')} · ${count(turns.length, 'turn', 'turns')} · ${count(versions.length, 'version', 'versions')} of the files` : '- Run: not kept (it ended before anything was recorded)',
      `- Failed: ${failed.length ? failed.map((t) => `${name(t.who)} (${t.status === 'skipped' ? 'did not run' : 'error'})`).join(', ') : 'none'}`,
    ];
    if (settings) head.push(`- Settings: ${settings}`);
    head.push(
      redacted
        ? `- Keys: ${count(redacted, 'string', 'strings')} shaped like a key ${redacted === 1 ? 'was' : 'were'} replaced with [redacted]. Everything else is as it was written.`
        : '- Keys: none found. Everything is as it was written.',
      '',
      '## The task',
      '',
      D().fenced(safe(PP().taskAsAsked(String((run && (run.work || run.task)) || bp.task || ''))), 'text'),
      '',
    );
    // The plan's files, but not the bar it was held to: the app's own rules for the work.
    if (run && run.plan) head.push(...folded('What it was to hand back (the plan)', safe(JSON.stringify({ ...run.plan, bar: (run.plan.bar || []).length ? PP().withheld('the bar', (run.plan.bar || []).join('\n')) : [] }, null, 2)), 'json'));
    return [...head, ...body].join('\n');
  }

  /** The file's name: the blueprint's, the day and the time. */
  function fileName(blueprintName, when = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const stem = String(blueprintName || 'swarm').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'swarm';
    return `swarm-debug-${stem}-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}.md`;
  }

  /**
   * Gather the run's facts and save the report through `save(name, text, mime)`.
   * A kept run's own trace is used; without one, the trace panel as it is now.
   * Returns false when there is nothing to report.
   */
  async function exportReport({ blueprint, run, host, save, label, settings = {}, doc = typeof document !== 'undefined' ? document : null }) {
    const trace = run && Array.isArray(run.trace) && run.trace.length ? run.trace : traceRows(host);
    if (!run && !trace.length) return false;
    const badge = doc && doc.querySelector && doc.querySelector('.hc-toolbar-badge');
    const platform = typeof navigator !== 'undefined' ? (/Windows/i.test(navigator.userAgent) ? 'windows' : /Mac/i.test(navigator.userAgent) ? 'macos' : /Linux/i.test(navigator.userAgent) ? 'linux' : '') : '';
    const text = buildReport({ blueprint, run, trace, label, facts: { version: badge && badge.textContent, platform, settings } });
    return !!(await save(fileName(blueprint && blueprint.name), text, 'text/markdown;charset=utf-8'));
  }

  window.HCSwarmDebug = { traceRows, buildReport, fileName, exportReport };
})();
