// ==============================================================
// Light mode: a small model writes files, it does not call tools
//
// A model of a few billion parameters is poor at the machinery of tool calls:
// it writes a file's text inside a JSON string and gets the escaping wrong, it
// mistypes an argument, it writes its tool list back as its reply, and every
// step re-reads the descriptions of every tool before it writes a word. The
// same model, shown the project's files and asked to answer in plain text with
// each changed file written out whole, does the same work far more often, and
// in a fraction of the time.
//
// So for a small model the app does the machinery. The model is sent no tools
// and a short instruction; it answers with FILE blocks (a file's whole new
// contents), a READ line for a file it needs to see, and a sentence. This
// module reads such an answer, and turns the model's turn into the same calls
// the app already runs for a larger model, so every file it writes goes through
// the same permission question, the same undo and the same record of what was
// proven. It also turns the conversation's calls and results back into the
// plain text the model reads, so it never sees a tool call at all.
//
// Which models: those the app finds small (js/platform hashcoder sizeOf), by
// what the model app reports of a model on this computer, and otherwise by the
// size in the model's name. A setting can turn it off, or give it to
// mid-sized models too.
//
// Pure but for turnOf, which reads files through the function it is given:
// takes strings and lists, returns strings and lists. No DOM, no storage, no
// network. Loaded before the Coder mode and published as
// window.HCCodeLight. Checked by scripts/checks/code-light.mjs.
// ==============================================================

(function () {
  'use strict';

  const TICKS = '`'.repeat(3);

  /** What a model in light mode is told. Short, since a small model reads all of it at every step. */
  const SYSTEM = [
    'You are HashCoder, a coding assistant working on the person\'s project, which is shown below. You answer in plain text and do not call tools.',
    '',
    'To create or change a file, write the whole file, like this:',
    '',
    'FILE: index.html',
    TICKS,
    '<the complete new contents of the file>',
    TICKS,
    '',
    'To look at a file you cannot see, write a line that is only: READ: style.css',
    '',
    'Rules:',
    '- Paths are from the project folder. A file at its top is written by its name alone, such as index.html; one in a folder with the folder, such as src/app.js. Use the paths the project already has.',
    '- Write only the files that must change or be created, each one in full. Keep everything in them that you were not asked to change exactly as it is.',
    '- Do not change test files unless asked to.',
    '- Answer a question in plain words and write no FILE blocks.',
    '- After the files, say in one sentence what you did. The tests are run for you.',
    '- When the work is done, answer with that one sentence and no FILE blocks.',
  ].join('\n');

  // ── Which models ─────────────────────────────────────────────────────

  /**
   * The size of a model in billions of parameters, read from its name when
   * nothing better is known: "llama-3.1-8b-instant" is 8, "qwen2.5-coder:3b"
   * is 3, a mixture "8x7b" is 56. Null when the name gives none.
   */
  function billionsInName(value) {
    const name = String(value == null ? '' : value).toLowerCase().replace(/^cloud:[^:]*:/, '').replace(/^local:[^:]*:/, '');
    const mix = /(?:^|[^a-z0-9.])(\d+)x(\d+(?:\.\d+)?)b(?![a-z])/.exec(name);
    if (mix) return Number(mix[1]) * Number(mix[2]);
    const one = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/.exec(name);
    return one ? Number(one[1]) : null;
  }

  /**
   * Whether a run is in light mode. `pref` is the setting: 'auto' (small
   * models, the default), 'always' (small and mid-sized) or 'off'.
   */
  function applies(size, pref) {
    if (pref === 'off') return false;
    return size === 'small' || (pref === 'always' && size === 'mid');
  }

  // ── Reading an answer ────────────────────────────────────────────────

  // A line that names a file for the block under it: FILE: src/app.js, in
  // whatever emphasis a model dresses it in.
  const FILE_LINE = /^[\s>*_#-]*(?:file|filename|path)\s*[:：]\s*[`*_"']*([^\s`*"']+)[`*_"']*\s*$/i;
  const READ_LINE = /^[\s>*_#-]*read\s*[:：]\s*[`*_"']*([^\s`*"']+)[`*_"']*\s*$/i;

  /** A path as a model wrote it, tidied, or '' when it cannot be the project's own place. */
  function cleanPath(raw) {
    const p = String(raw || '').trim().replace(/^\.\//, '').replace(/[,;:.]+$/, '');
    if (!p || p.length > 260 || /[\u0000-\u001f]/.test(p) || /(^|[\\/])\.\.([\\/]|$)/.test(p)) return '';
    return p;
  }

  const fenced = (info, code) => `${TICKS}${info || ''}\n${code}\n${TICKS}\n`;

  /** Whether the text ends inside a code block that was never closed: the answer was cut off. */
  function cutOff(text) {
    const F = window.HCFences;
    const last = F ? F.splitFences(String(text == null ? '' : text)).pop() : null;
    return !!last && last.type === 'code' && last.unclosed === true;
  }

  /**
   * What a model's answer holds: the files it wrote whole (`writes`, in
   * order, the last of a name winning), the files it asked to see (`reads`),
   * what it said besides (`said`), and whether it was cut off (`cut`).
   * A code block with no file named is part of what it said.
   */
  function parseReply(text) {
    const F = window.HCFences;
    const src = String(text == null ? '' : text);
    const out = { writes: [], reads: [], said: '', cut: false };
    if (!F) { out.said = src; return out; }
    const pieces = F.splitFences(src);
    const byPath = new Map();
    let said = '';
    pieces.forEach((p, i) => {
      if (p.type === 'text') {
        const lines = p.text.split(/\r?\n/);
        let k = lines.length - 1;
        while (k >= 0 && !lines[k].trim()) k--;
        const named = k >= 0 && pieces[i + 1] && pieces[i + 1].type === 'code' ? FILE_LINE.exec(lines[k]) : null;
        lines.forEach((line, n) => {
          const read = READ_LINE.exec(line);
          if (read) { const path = cleanPath(read[1]); if (path && !out.reads.includes(path)) out.reads.push(path); return; }
          if (named && n === k) return;
          said += line + (n < lines.length - 1 ? '\n' : '');
        });
        return;
      }
      const before = pieces[i - 1];
      const lines = before && before.type === 'text' ? before.text.split(/\r?\n/) : [];
      let k = lines.length - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      const named = k >= 0 ? FILE_LINE.exec(lines[k]) : null;
      const path = named ? cleanPath(named[1]) : '';
      // A block the answer ended inside is half a file: it is never written, and the answer counts as cut off.
      if (path && p.unclosed) return;
      if (path) {
        const content = p.code.endsWith('\n') ? p.code : `${p.code}\n`;
        if (byPath.has(path)) out.writes[byPath.get(path)] = { path, content };
        else { byPath.set(path, out.writes.length); out.writes.push({ path, content }); }
      } else said += fenced(p.info, p.code);
    });
    out.said = said.replace(/\n{3,}/g, '\n\n').trim();
    out.cut = cutOff(src);
    return out;
  }

  /** The calls the app runs for what a model wrote: its files, then the files it asked to see. */
  function callsFor(parsed) {
    return [
      ...parsed.writes.map((w) => ({ name: 'write_file', arguments: { path: w.path, content: w.content } })),
      ...parsed.reads.map((p) => ({ name: 'read_file', arguments: { path: p } })),
    ];
  }

  const NOTE = 'Note from HashCortX, not from the person:';
  const named = (paths) => (paths.length > 1 ? `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1]}` : paths[0] || '');

  /**
   * What the app does with a model's answer: the calls to run for it, and a
   * note to send back when part of it was not written. A file written much
   * shorter than it is (`current`, by path) is not written, nor is one the
   * answer was cut off inside, nor one written again exactly as it is.
   * `calls` empty and `note` '' is a plain answer: the model has finished.
   */
  function plan(parsed, current) {
    const short = shrunk(parsed.writes, current);
    // A file written again exactly as it already is changes nothing: the model is done with it.
    const same = (w) => typeof (current && current[w.path]) === 'string' && current[w.path].replace(/\s+$/, '') === w.content.replace(/\s+$/, '');
    const calls = callsFor({ ...parsed, writes: parsed.writes.filter((w) => !short.includes(w.path) && !same(w)) });
    const notes = [];
    if (short.length) notes.push(`${NOTE} ${named(short)} would have been written much shorter than ${short.length > 1 ? 'they are' : 'it is'}, so ${short.length > 1 ? 'they were' : 'it was'} not written. Write ${short.length > 1 ? 'each one' : 'it'} again in full, keeping every part you were not asked to change.`);
    if (!parsed.writes.length && !parsed.reads.length && /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/.test(parsed.said)) notes.push(`${NOTE} your answer shows code, but no file was named for it, so nothing was written. If it belongs in a file, write a line FILE: followed by the file's path just above the code block, with the whole file in the block.`);
    if (parsed.cut) notes.push(`${NOTE} your answer was cut off inside a file, so that file was not written. Write it again, complete, and nothing else.`);
    return { calls, note: notes.join('\n') };
  }

  /**
   * A model's answer, read for the loop: `{ calls, note, said }`, the calls
   * carrying ids as a model's own would. `read(path)` gives a file as it is
   * now, to catch one written much shorter; a file it cannot read is new, or
   * not one to read without asking, and is taken as new.
   */
  async function turnOf(text, read) {
    const parsed = parseReply(text);
    const current = {};
    for (const w of parsed.writes) { try { current[w.path] = await read(w.path); } catch { /* new, or not read without asking */ } }
    const { calls, note } = plan(parsed, current);
    const stamp = Date.now();
    return { calls: calls.map((c, i) => ({ id: `light_${stamp}_${i}`, ...c })), note, said: parsed.said };
  }

  /**
   * The files an answer would write much shorter than they are: a small model
   * asked for a whole file sometimes stops half way and the rest is lost.
   * `current` maps a path to the file as it is now. A file under 30 lines, or
   * one that keeps 60 percent of its lines, is not in the list.
   */
  function shrunk(writes, current) {
    const lines = (t) => String(t).split('\n').length;
    return (writes || []).filter((w) => {
      const now = current && current[w.path];
      return typeof now === 'string' && lines(now) >= 30 && lines(w.content) < lines(now) * 0.6;
    }).map((w) => w.path);
  }

  // ── What the model reads ─────────────────────────────────────────────

  const argsOf = (call) => { try { return JSON.parse(call.function.arguments || '{}'); } catch { return {}; } };

  /** One call of the conversation, as the plain text the model would have written it. */
  function callText(call) {
    const a = argsOf(call);
    const name = call.function && call.function.name;
    if (name === 'write_file') {
      const body = String(a.content == null ? '' : a.content);
      const ticks = body.includes(TICKS) ? '`'.repeat(4) : TICKS;
      return `FILE: ${a.path}\n${ticks}\n${body.replace(/\n$/, '')}\n${ticks}`;
    }
    if (name === 'read_file') return `READ: ${a.path}`;
    if (name === 'shell_run') return `RUN: ${[a.command, ...(Array.isArray(a.args) ? a.args : [])].filter(Boolean).join(' ')}`;
    return `${name}`;
  }

  /** Added to each of the app's notes, which name tools this model does not have. */
  const NO_TOOLS = 'Here there are no tools: a file is changed by writing it whole in a FILE block, and a file is seen by writing READ: and its path.';

  /** Said after files are written, so a model that has finished knows how to say so. */
  const DONE_HINT = 'Write a FILE block only for a file that must still change. If the work is done, answer with one sentence saying what you did, and no FILE blocks.';

  const clip = (text, max) => { const s = String(text == null ? '' : text); return s.length > max ? `${s.slice(0, max)}\n[cut: ${s.length - max} more characters]` : s; };

  /** One result, as a person's note to the model. */
  function resultText(message, call) {
    const a = call ? argsOf(call) : {};
    const name = (call && call.function.name) || message.name;
    const body = String(message.content == null ? '' : message.content);
    let error = '';
    try { const j = JSON.parse(body); if (j && typeof j === 'object' && j.error) error = String(j.error); } catch { /* plain text */ }
    if (error && name === 'read_file' && /ENOENT|no such file|There is no file/i.test(error)) return `There is no file at ${a.path}. To create it, write it whole in a FILE block.`;
    if (error) return `That did not work${a.path ? ` for ${a.path}` : ''}: ${clip(error, 400)}`;
    if (name === 'write_file') return `Wrote ${a.path}.`;
    if (name === 'read_file') return `${a.path}:\n${TICKS}\n${clip(body, 6000)}\n${TICKS}`;
    if (name === 'shell_run') return `The output of ${[a.command, ...(Array.isArray(a.args) ? a.args : [])].filter(Boolean).join(' ')}:\n${TICKS}\n${clip(body, 2500)}\n${TICKS}`;
    return clip(body, 1500);
  }

  /**
   * The conversation as a model in light mode reads it: the calls and results
   * of the app's own history turned back into the plain text of the format it
   * was told to write, so no tool call is ever shown to it. The system turn
   * and the person's own turns pass through as they are.
   */
  function callMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const calls = new Map();
    for (const m of list) if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) calls.set(c.id, c);
    const out = [];
    for (const m of list) {
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const said = String(m.content || '').trim();
        out.push({ role: 'assistant', content: [said, ...m.tool_calls.map(callText)].filter(Boolean).join('\n\n') });
      } else if (m.role === 'tool') {
        const note = resultText(m, calls.get(m.tool_call_id));
        const last = out[out.length - 1];
        if (last && last.role === 'user' && last.fromTool) last.content += `\n\n${note}`;
        else out.push({ role: 'user', content: note, fromTool: true });
        const called = calls.get(m.tool_call_id);
        if (called && called.function && called.function.name === 'write_file' && !out[out.length - 1].doneHint) { out[out.length - 1].content += `\n\n${DONE_HINT}`; out[out.length - 1].doneHint = true; }
      } else if (m.role === 'user' && (m.note || String(m.content || '').startsWith(NOTE))) {
        // The app's notes are written for a model with tools; this one changes files only by writing them.
        out.push({ ...m, content: `${m.content}\n\n${NO_TOOLS}` });
      } else out.push(m);
    }
    // The hint goes once, at the end of the note it belongs to.
    return out.map(({ fromTool, doneHint, ...m }) => (doneHint ? { ...m, content: `${m.content.replace(`\n\n${DONE_HINT}`, '')}\n\n${DONE_HINT}` } : m));
  }

  window.HCCodeLight = { SYSTEM, applies, billionsInName, parseReply, callsFor, shrunk, plan, turnOf, callMessages, cutOff };
})();
