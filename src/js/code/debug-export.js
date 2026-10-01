// ==============================================================
// A HashCoder conversation, written out for finding what went wrong
//
// The export a person keeps (js/code/export.js) holds what they saw: their
// words and the agent's answers. A defect in a run is almost never in those.
// It is in what the agent was told, what it asked for and what came back, the
// notes the app sent it, which model answered and when one was moved off, and
// the order and timing of it all. This writes the whole of that as one
// markdown file that can be read from the top.
//
//   • The facts of the run: the app, the platform, the project, the model and
//     how HashCoder was set up for it, the settings that change what it does.
//   • The trace, as the panel recorded it, with its times.
//   • The conversation as the model was sent it: the instructions, each
//     request, each call the agent made with its arguments, each result, and
//     each note the app added, told apart from what the person wrote.
//
// Long text is folded so the file reads from the top and opens where wanted;
// a block of code is fenced with more backticks than any it holds, so nothing
// in a result can end its own block early. Text longer than a fixed length is
// cut and says how much was left out.
//
// Whatever is shaped like a key is replaced before it is written, and the file
// says how many were. A file the agent read is otherwise written as it came
// back, so the export is for the person who ran it and for whoever they choose
// to show it to, not for posting anywhere.
//
// Pure: takes messages, a trace and facts; returns text. No DOM, no storage,
// no network. Published as window.HCCodeDebug.
// Checked by scripts/checks/code-debug.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Text cut to this many characters per message, with a note of what was left out. */
  const MAX_CHARS = 60000;
  const MAX_SYSTEM = 30000;

  // What a key looks like, by the shapes each provider the app offers gives
  // them (scripts/checks/secret-scan.mjs holds the same list for the commit
  // hook), and a value written after a name that says it is secret.
  const SHAPES = [
    /\bsk-[A-Za-z0-9_-]{8,}/g,
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
    /\bgsk_[A-Za-z0-9]{8,}/g,
    /\bAIza[0-9A-Za-z_-]{16,}/g,
    /\bxai-[A-Za-z0-9_-]{8,}/g,
    /\bhf_[A-Za-z0-9]{8,}/g,
    /\bcsk-[A-Za-z0-9_-]{8,}/g,
    /\bfw_[A-Za-z0-9]{8,}/g,
    /\bnvapi-[A-Za-z0-9_-]{8,}/g,
    /\btvly-[A-Za-z0-9_-]{8,}/g,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{12,}/g,
    /\bAKIA[0-9A-Z]{12,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  ];
  const NAMED = /((?:api[_-]?key|secret|token|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;)}\]]{12,})/gi;

  /** `text` with whatever is shaped like a key replaced, and how many were. */
  function redact(text) {
    let count = 0;
    let out = String(text == null ? '' : text);
    const mark = () => { count++; return '[redacted: looked like a key]'; };
    for (const shape of SHAPES) out = out.replace(shape, mark);
    out = out.replace(NAMED, (all, name) => { count++; return `${name}[redacted: looked like a key]`; });
    return { text: out, count };
  }

  const longestRun = (text) => (String(text).match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);

  /** A fenced block that nothing inside it can end. */
  function fenced(text, lang = '') {
    const body = String(text);
    const fence = '`'.repeat(Math.max(3, longestRun(body) + 1));
    return `${fence}${lang}\n${body.replace(/\n$/, '')}\n${fence}`;
  }

  const count = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

  /** `text` cut to `max` characters, saying how many were left out. */
  function cut(text, max) {
    const s = String(text == null ? '' : text);
    return s.length > max ? `${s.slice(0, max)}\n[cut: ${(s.length - max).toLocaleString('en-US')} more characters]` : s;
  }

  /** A note the app added to the conversation, told apart from what the person wrote. */
  const isAppNote = (m) => m && m.role === 'user' && /^Note from HashCortx?,? not from the person/i.test(String(m.content || ''));

  /** Whether a tool's result says it did not do what was asked. */
  function failed(content) {
    const text = String(content == null ? '' : content).trim();
    if (!text) return false;
    try {
      const v = JSON.parse(text);
      return !!(v && typeof v === 'object' && (v.ok === false || (v.error && v.ok !== true)));
    } catch { /* not JSON: judged by its words */ }
    return /^(?:error\b|refused\b|permission denied|denied\b|blocked\b)/i.test(text);
  }

  const callsOf = (m) => (Array.isArray(m && m.tool_calls) ? m.tool_calls : []).map((c) => {
    const fn = (c && c.function) || c || {};
    let args = fn.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* shown as written */ } }
    return { id: c && c.id, name: String(fn.name || (c && c.name) || 'tool'), args };
  });

  const when = (seconds) => (Number.isFinite(Number(seconds)) ? `${Number(seconds).toFixed(1)} s` : '');
  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

  /**
   * The whole export.
   *
   *   messages   the conversation as the model was sent it
   *   trace      the panel's trace entries, { elapsed, stage, message, status }
   *   facts      what to say about the run: { version, platform, projectRoot,
   *              model, label, size, local, temperature, settings: { name: value } }
   *   exportedAt a Date, or its text
   */
  function buildDebug({ messages = [], trace = [], facts = {}, exportedAt = new Date() } = {}) {
    const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
    const steps = Array.isArray(trace) ? trace.filter(Boolean) : [];
    let redacted = 0;
    const safe = (text) => { const r = redact(text); redacted += r.count; return r.text; };

    const calls = list.flatMap(callsOf);
    const byId = new Map(calls.filter((c) => c.id).map((c) => [c.id, c.name]));
    const results = list.filter((m) => m.role === 'tool');
    const bad = results.filter((m) => failed(m.content)).length;
    const notes = list.filter(isAppNote).length;
    const settings = Object.entries(facts.settings || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    const stamp = exportedAt instanceof Date ? exportedAt.toLocaleString() : String(exportedAt);

    const body = [];
    body.push('## Trace', '');
    if (!steps.length) body.push('Nothing was recorded.', '');
    else {
      body.push('| Time | Stage | Status | What |', '| ---: | --- | --- | --- |');
      for (const e of steps) body.push(`| ${when(e.elapsed)} | ${cell(e.stage)} | ${cell(e.status)} | ${cell(safe(e.message))} |`);
      body.push('');
    }

    body.push('## Conversation, as the model was sent it', '');
    list.forEach((m, i) => {
      const n = i + 1;
      const pictures = Array.isArray(m.images) && m.images.length ? `\n\n[${count(m.images.length, 'picture', 'pictures')} with this message, not included in this file]` : '';
      if (m.role === 'system') {
        const text = safe(cut(m.content, MAX_SYSTEM));
        body.push(`### ${n} · instructions`, '', `<details><summary>${count(String(m.content || '').length, 'character', 'characters')}</summary>`, '', fenced(text, 'text'), '', '</details>', '');
      } else if (m.role === 'user' && isAppNote(m)) {
        body.push(`### ${n} · note from the app, not from the person`, '', fenced(safe(cut(m.content, MAX_CHARS)), 'text'), '');
      } else if (m.role === 'user') {
        body.push(`### ${n} · the person`, '', safe(cut(m.content, MAX_CHARS)) + pictures, '');
      } else if (m.role === 'assistant') {
        const made = callsOf(m);
        body.push(`### ${n} · the agent${made.length ? ` — ${count(made.length, 'call', 'calls')}` : ''}`, '');
        if (String(m.content || '').trim()) body.push(safe(cut(m.content, MAX_CHARS)), '');
        for (const c of made) {
          const args = typeof c.args === 'string' ? c.args : JSON.stringify(c.args, null, 2);
          body.push(`**\`${c.name}\`**`, '', fenced(safe(cut(args, MAX_CHARS)), 'json'), '');
        }
      } else if (m.role === 'tool') {
        const name = m.name || byId.get(m.tool_call_id) || 'tool';
        const text = String(m.content == null ? '' : m.content);
        body.push(`### ${n} · result of \`${name}\`${failed(text) ? ' — failed' : ''}`, '', `<details><summary>${count(text.length, 'character', 'characters')}</summary>`, '', fenced(safe(cut(text, MAX_CHARS)), 'text'), '', '</details>', '');
      } else {
        body.push(`### ${n} · ${cell(m.role)}`, '', safe(cut(m.content, MAX_CHARS)), '');
      }
    });
    if (!list.length) body.push('The conversation is empty.', '');

    const head = [
      '# HashCoder debug export',
      '',
      `- Exported: ${stamp}`,
      `- App: HashCortx${facts.version ? ` ${String(facts.version).replace(/^v/i, 'v')}` : ''}${facts.platform ? ` on ${facts.platform}` : ''}`,
      facts.projectRoot ? `- Project: ${facts.projectRoot}` : '- Project: none open',
      `- Model: ${facts.label ? `${facts.label} (${facts.model || 'unknown'})` : facts.model || 'unknown'}`,
      `- Set up for: ${facts.size || 'unknown'}${facts.local === true ? ', a model on this computer' : facts.local === false ? ', a cloud model' : ''}${Number.isFinite(facts.temperature) ? `, temperature ${facts.temperature}` : ''}`,
    ];
    if (settings) head.push(`- Settings: ${settings}`);
    head.push(
      `- Size: ${count(list.length, 'message', 'messages')} · ${count(calls.length, 'tool call', 'tool calls')}${bad ? ` (${bad} failed)` : ''} · ${count(notes, 'note', 'notes')} from the app · ${count(steps.length, 'trace entry', 'trace entries')}`,
      redacted
        ? `- Keys: ${count(redacted, 'string', 'strings')} shaped like a key ${redacted === 1 ? 'was' : 'were'} replaced with [redacted]. Everything else, including the contents of files the agent read, is as it came back.`
        : '- Keys: none found. The contents of files the agent read are as they came back.',
      '',
    );
    return [...head, ...body].join('\n');
  }

  /** The file's name: the project's, the day and the time. */
  function debugFileName(projectName, when = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const day = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}`;
    return `hashcoder-debug-${String(projectName || 'chat').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat'}-${day}.md`;
  }

  /**
   * The panel's side of it, the one part that reads the page: gather the facts
   * of the run, build the file and hand it to `save(text, mime, name)`.
   * Returns false when there is nothing to export.
   */
  async function exportRun({ messages, trace, sharedState = {}, routing, coderModel, prefs = {}, H = {}, save, exportBaseName, doc = typeof document !== 'undefined' ? document : null }) {
    if (!(messages || []).length && !(trace || []).length) {
      if (H.themedAlert) H.themedAlert('There is nothing to export yet: run something first.', 'Export for debugging');
      return false;
    }
    const model = (routing && routing.model) || coderModel || (H.selectedModel && H.selectedModel()) || '';
    const badge = doc && doc.querySelector && doc.querySelector('.hc-toolbar-badge');
    const facts = {
      version: badge && badge.textContent, platform: sharedState.platform && sharedState.platform.os, projectRoot: sharedState.projectRoot,
      model, label: routing && routing.label ? routing.label(model) : '', size: sharedState.size, local: sharedState.local,
      temperature: H.selectedTemperature ? H.selectedTemperature() : undefined,
      settings: { 'Prove changes': prefs.prove !== false ? 'on' : 'off', Lessons: prefs.lessons === true ? 'on' : 'off' },
    };
    await save(buildDebug({ messages, trace, facts }), 'text/markdown', debugFileName(exportBaseName(sharedState.projectRoot)));
    return true;
  }

  window.HCCodeDebug = { MAX_CHARS, MAX_SYSTEM, redact, fenced, cut, failed, isAppNote, buildDebug, debugFileName, exportRun };
})();
