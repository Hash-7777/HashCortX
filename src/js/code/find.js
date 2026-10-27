// ==============================================================
// The files a request needs, found before its first step
//
// On a project too large to show whole, a model spent its first steps
// finding its way: it listed folders, searched, read files that turned out
// not to matter, and every one of those results stayed in the conversation
// and was read again at every step after. A smaller model lost the thread
// in it, and a cloud model's requests grew until a provider's limit on
// words a minute was reached. Where a change belongs, and what else it
// touches, is found first now, and only that joins the run.
//
// Two ways, by the size of the model:
//
//   · The app's own search, for every size. The names, file names and
//     words the request is written with are searched for in the project,
//     by name and inside the files, and the files ranked by what they hold
//     of them. No model is asked.
//   · A finding run, for a model of five billion parameters or more. The
//     same model is given the request, the outline of the project's folders
//     and what the app's search found, in a conversation of its own, with
//     the tools that only read: search, list, find by name, read a part.
//     It may make several calls a turn, for a few turns, and answers with
//     the files and the lines that matter and why, the places that use or
//     are used by that code among them. Its reads stay in its own
//     conversation; only that list reaches the run, as part of the request.
//     When the request names a file that is there, the app's search is
//     enough and no finding run is made.
//
// What either finds is read the way the map is: inside the project and
// never with a question to the person. A file a finding run names that is
// not there is left out. The list is said to be a start, not everything.
//
// Pure but for before(), which is handed every function it calls.
//
// Loaded before the Coder mode and published as window.HCCodeFind.
// Checked by scripts/checks/code-find.mjs.
// ==============================================================

(function () {
  'use strict';

  /** How many files each way names, and how many turns a finding run has, by model size. */
  const SIZED = { small: { files: 6, turns: 0 }, mid: { files: 8, turns: 2 }, full: { files: 10, turns: 4 } };
  /** At most this many names and words of a request are searched for. */
  const MOST_TERMS = 6;
  /** A finding run may make this many calls in one turn. */
  const CALLS_A_TURN = 6;
  /** The tools a finding run is given: the ones that only read. */
  const FINDING_TOOLS = ['grep_code', 'list_dir', 'fuzzy_find', 'read_file'];

  /** Words of a request that say what to do, not what to do it to. */
  const PLAIN = new Set(('about above after again against because before being below between change changed changes could ' +
    'doesnt every fixed should their there these thing things those through under until using where which while would ' +
    'please update updated makes making create remove delete rename moved instead without within another always never ' +
    'currently working broken anything something nothing everything')
    .split(' '));

  /** A file name written in a request: a word with an ending a source file has. */
  const FILE_WORD = /\b[\w.-]+\.(?:m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|cs|php|vue|svelte|html?|css|scss|less|json|ya?ml|toml|sql|md|sh)\b/gi;

  /**
   * What a request is written with that can be searched for, the most
   * telling first: words in quotes, file names, names written the way code
   * writes them (camelCase, snake_case, with a dot or a slash), then the
   * longest plain words. `{ text, kind }`, kind 'file', 'code' or 'word'.
   */
  function termsOf(request) {
    const text = String(request == null ? '' : request);
    const out = [];
    const add = (t, kind) => {
      const term = String(t).trim().replace(/^[./]+|[.,;:!?)]+$/g, '');
      if (term.length < 3 || term.length > 60 || out.some((o) => o.text.toLowerCase() === term.toLowerCase())) return;
      out.push({ text: term, kind });
    };
    for (const m of text.matchAll(/["'`‘“]([^"'`’”\n]{3,60})["'`’”]/g)) add(m[1], /\s/.test(m[1]) ? 'word' : 'code');
    for (const m of text.matchAll(FILE_WORD)) add(m[0], 'file');
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*(?:[./][\w$-]+)*/g)) {
      const w = m[0];
      if (/[a-z][A-Z]|_|[./]\w|^[A-Z][a-z]+[A-Z]|[a-z]\d|\d[a-z]/.test(w) && !FILE_WORD.test(w)) add(w, 'code');
      FILE_WORD.lastIndex = 0;
    }
    const words = [...new Set((text.toLowerCase().match(/\b[a-z]{5,}\b/g) || []).filter((w) => !PLAIN.has(w)))].sort((a, b) => b.length - a.length);
    words.slice(0, 3).forEach((w) => add(w, 'word'));
    const order = { file: 0, code: 1, word: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, MOST_TERMS);
  }

  const slash = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
  const inRoot = (path, root) => (window.HCCodeSearch ? window.HCCodeSearch.place(path, root) : slash(path));

  /**
   * The files the app's search found, ranked: `byName` the matches by file
   * name for each term, `byLine` the lines found inside files for each, as
   * the native search gives them. `[{ path, score, lines, terms }]`.
   */
  function rank(terms, byName, byLine, root, most) {
    const files = new Map();
    const at = (path) => {
      const key = inRoot(path, root);
      if (!files.has(key)) files.set(key, { path: key, score: 0, lines: [], terms: [] });
      return files.get(key);
    };
    terms.forEach((term, i) => {
      const strong = term.kind !== 'word';
      for (const m of (Array.isArray(byName[i]) ? byName[i] : [])) {
        if (!m || m.path == null || m.score > 2) continue;
        const f = at(m.path);
        f.score += strong ? 4 : 2;
        if (!f.terms.includes(term.text)) f.terms.push(term.text);
      }
      const seen = new Map();
      for (const m of (Array.isArray(byLine[i]) ? byLine[i] : [])) {
        if (!m || m.path == null) continue;
        const key = inRoot(m.path, root);
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(m.line_no);
      }
      for (const [key, lines] of seen) {
        const f = at(key);
        f.score += (strong ? 3 : 1) + Math.min(lines.length, 5) * (strong ? 0.2 : 0.1);
        if (!f.terms.includes(term.text)) f.terms.push(term.text);
        for (const n of lines) if (f.lines.length < 4 && !f.lines.includes(n)) f.lines.push(n);
      }
    });
    return [...files.values()].filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score || b.terms.length - a.terms.length || (a.path < b.path ? -1 : 1))
      .slice(0, most);
  }

  /** What the app's search found, as the request carries it, or ''. */
  function searchNote(ranked) {
    if (!ranked || !ranked.length) return '';
    const lines = ranked.map((f) => `- ${f.path}: ${f.terms.map((t) => `"${t}"`).join(', ')}${f.lines.length ? ` at line${f.lines.length === 1 ? '' : 's'} ${f.lines.sort((a, b) => a - b).join(', ')}` : ', by its name'}`);
    return ['Files that may matter for this request, from the app\'s search of the project for the names and words it is written with. ' +
      'Read the ones that matter before you change anything; the list is a start and can miss a file.', ...lines].join('\n');
  }

  // ── The finding run ───────────────────────────────────────────────────

  const FINDING_PROMPT = [
    'You find the files in a project that a coding request needs, before anything is changed. You only read: grep_code searches inside files, ' +
    'list_dir lists a folder, fuzzy_find finds a file by a rough name, read_file reads part of a file. Make several calls in one turn when they do not depend on each other. ' +
    'Do not change anything, and do not do the request itself.',
    'Find where the change belongs, and the files that use that code or that it uses: callers, imports, routes, tests and settings, so nothing a change would affect is missed.',
    'When you know, answer with only this, one line a file, at most ten, the most important first:',
    'FILES:',
    'path/from/the/project:first-last — why it matters',
    'Write paths from the project folder and the line numbers you saw. Name only files a tool result showed you.',
  ].join('\n');

  const LAST_TURN = 'Answer now, with the FILES: list only, from what you have seen.';

  /** The finding run's first messages. */
  function findingMessages(request, outline, appNote) {
    return [
      { role: 'system', content: FINDING_PROMPT },
      { role: 'user', content: [`Request:\n${String(request || '').trim()}`, outline, appNote].filter(Boolean).join('\n\n') },
    ];
  }

  /**
   * The files a finding run's answer names, each once: `{ path, start, end,
   * why }`, at most `most`. Lines that are not a file are passed over.
   */
  function answerOf(text, most = 10) {
    const body = String(text == null ? '' : text).replace(/^\s*<think>[\s\S]*?<\/think>/, '');
    const at = body.search(/FILES:/i);
    const lines = (at >= 0 ? body.slice(at + 6) : body).split(/\r?\n/);
    const out = [];
    for (const raw of lines) {
      const m = /^\s*(?:[-*\d.)]+\s*)?`?((?:[\w@.-]+[\\/])*[\w@.-]+\.[A-Za-z0-9]+)`?(?::(\d+)(?:\s*-\s*(\d+))?)?(?:\s*(?:lines?\s*(\d+)(?:\s*-\s*(\d+))?))?\s*(?:[—–:-]+\s*(.*))?$/.exec(raw);
      if (!m) continue;
      const path = slash(m[1]).replace(/^\.\//, '');
      if (out.some((f) => f.path === path)) continue;
      const start = Number(m[2] || m[4]) || 0, end = Number(m[3] || m[5]) || start;
      out.push({ path, start, end: end >= start ? end : start, why: String(m[6] || '').trim().slice(0, 160) });
      if (out.length >= most) break;
    }
    return out;
  }

  /** What a finding run found, as the request carries it, or ''. */
  function foundNote(found) {
    if (!found || !found.length) return '';
    const lines = found.map((f) => `- ${f.path}${!f.start ? '' : f.end > f.start ? ` lines ${f.start}-${f.end}` : ` line ${f.start}`}${f.why ? `: ${f.why}` : ''}`);
    return ['Files found for this request before any change, by a search of the project. Read these first, around the lines given, ' +
      'and read further only where they lead; the list is a start and can miss a file.', ...lines].join('\n');
  }

  /** Whether the request names a file the app's search found by its name. */
  const namesAFile = (terms, byName) => terms.some((t, i) => t.kind === 'file' && (Array.isArray(byName[i]) ? byName[i] : []).some((m) => m && m.score === 0));

  /**
   * Finds the files the newest request in `messages` needs and adds what
   * was found to what the app adds to that request. Returns what was found,
   * `{ by: 'search' | 'finding', files }`, or null when nothing was looked
   * for. `deps`:
   *   size, light, root, outline — the model's size, light mode, the project,
   *     and its outline (js/code/context.js), given only when it is too large
   *     to show whole;
   *   byName(term), byLine(term) — the native searches by file name and
   *     inside files, from the project folder, never asking;
   *   ask(messages, tools) — one turn of the model in use;
   *   tools — the tools offered to the run, from which the reading ones are taken;
   *   run(name, args) — a reading tool's result, as text, never asking;
   *   record — { turn(messages, content, calls), result(messages, call, text) },
   *     how a turn and its results join a conversation (js/agent-shape.js);
   *   exists(path) — whether a file is there, never asking;
   *   fromApp — how the app's addition to a request begins;
   *   show(text, count), signal.
   */
  async function before(messages, deps) {
    const request = [...(messages || [])].reverse().find((m) => m && m.role === 'user' && !m.note && !m.opened && !m.added);
    if (!request || !deps || !deps.root || !deps.outline || deps.light) return null;
    if (window.HCCodeTalk && window.HCCodeTalk.isSmallTalk(request.content)) return null;   // a greeting needs no files
    const terms = termsOf(request.content);
    if (!terms.length) return null;
    const sized = SIZED[deps.size] || SIZED.full;
    const quiet = async (fn, term) => { try { return await fn(term.text); } catch { return []; } };
    const [byName, byLine] = await Promise.all([
      Promise.all(terms.map((t) => (t.kind === 'word' ? Promise.resolve([]) : quiet(deps.byName, t)))),
      Promise.all(terms.map((t) => quiet(deps.byLine, t))),
    ]);
    if (deps.signal && deps.signal.aborted) return null;
    const ranked = rank(terms, byName, byLine, deps.root, sized.files);
    const appNote = searchNote(ranked);
    let found = null;
    if (sized.turns && typeof deps.ask === 'function' && !namesAFile(terms, byName)) {
      found = await findingRun(request.content, deps, appNote, sized).catch((e) => { if (e && e.name === 'AbortError') throw e; return null; });
    }
    const note = found && found.length ? foundNote(found) : appNote;
    if (!note) return null;
    request.context = request.context ? `${request.context}\n${note}` : `${deps.fromApp || ''}\n${note}`.trim();
    const result = found && found.length ? { by: 'finding', files: found } : { by: 'search', files: ranked };
    if (typeof deps.show === 'function') deps.show(result.by === 'finding' ? 'by a search of the project' : 'by the app\'s search', result.files.length);
    return result;
  }

  /** A finding run in its own conversation: the files it names that are there, or []. */
  async function findingRun(request, deps, appNote, sized) {
    const names = new Set(FINDING_TOOLS);
    const tools = (deps.tools || []).filter((t) => names.has(t && t.function ? t.function.name : t && t.name));
    if (!tools.length) return [];
    const convo = findingMessages(request, deps.outline, appNote);
    const seen = new Set();
    let answer = '';
    for (let turn = 0; turn <= sized.turns; turn++) {
      const last = turn === sized.turns;
      if (last) convo.push({ role: 'user', content: LAST_TURN });
      const said = await deps.ask(convo, last ? [] : tools);
      const calls = (said && Array.isArray(said.tool_calls) ? said.tool_calls : []).filter((c) => c && names.has(c.name)).slice(0, CALLS_A_TURN);
      if (!calls.length || last) { answer = (said && said.content) || ''; break; }
      deps.record.turn(convo, said.content || '', calls);
      const results = await Promise.all(calls.map((c) => Promise.resolve(deps.run(c.name, c.arguments || {})).catch((e) => JSON.stringify({ error: String((e && e.message) || e) }))));
      calls.forEach((c, i) => {
        const text = typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i]);
        for (const m of text.matchAll(/(?:^|[\s"'(])((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z0-9]+)(?=[\s:"',)]|$)/gm)) seen.add(slash(m[1]));
        const p = c.arguments && (c.arguments.path || c.arguments.dir);
        if (p) seen.add(inRoot(p, deps.root));
        deps.record.result(convo, c, text);
      });
    }
    // Only what a tool result showed it, or what is there when it is read.
    const named = answerOf(answer, sized.files);
    const kept = [];
    for (const f of named) {
      if (seen.has(f.path) || (await Promise.resolve(deps.exists ? deps.exists(f.path) : false).catch(() => false))) kept.push(f);
    }
    return kept;
  }

  window.HCCodeFind = { SIZED, MOST_TERMS, CALLS_A_TURN, FINDING_TOOLS, FINDING_PROMPT, LAST_TURN, termsOf, rank, searchNote, findingMessages, answerOf, foundNote, before };
})();
