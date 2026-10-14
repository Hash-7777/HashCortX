// ==============================================================
// A tool call, put right before it runs
//
// Asked to make a folder, a model on this computer called move_file with
// "src" and "dst", where the tool takes "from" and "to". It was told only
// that both were required, and it made the same call six times, then tried
// to move the whole Desktop into the folder it meant to make. In another
// run a larger model read the same page seven times, twice in a row with
// nothing changed between, and a third model read the last lines of one
// file four times over. Every one of those calls was a round trip, and the
// read ones filled the model's memory with copies of what it already had.
//
// Four things are done here, before a call runs and after it:
//
//   · An argument given under another usual name for one the tool takes,
//     and was not given, is moved to it: "src" to "from", "file_path" to
//     "path", "old_string" to "search". Only from a name the tool does not
//     take to one it does; a value is never guessed.
//   · A call without an argument the tool needs, that gives one the tool does
//     not take, is not run: the answer names what is missing, what it is,
//     what the tool does not take, and shows the call written right. A call
//     that only leaves an argument out goes to the tool, which fills some in
//     itself (shell_run reads a command line given whole) and says what it
//     needs of the rest.
//   · A call that failed is not made again exactly as it was while nothing
//     has changed since: it would fail the same way. The answer is its
//     failure, and says so. A command that failed, a test that did not pass
//     among them, counts too: a model ran a failing test three times in a
//     row and never opened the file it named. Any file written and any other
//     command count as a change, since a command may change anything, so a
//     test run again after a fix always runs.
//   · A read of something the run has not changed since, whose answer the
//     model is still being shown whole, is answered with a line saying so,
//     once; asked again, it is read. Whether the earlier answer is still
//     shown whole is asked of the loop (`shown`), which knows what the
//     model is sent: an answer it no longer sees is read again.
//
// Pure: `normalize` and `missing` take a call and the tool's schema; the
// memory takes calls and results and keeps no clock. Checked by
// scripts/checks/code-calls.mjs. Loaded before the Coder mode and published
// as window.HCCodeCalls.
// ==============================================================

(function () {
  'use strict';

  /** Other names models use for an argument, by the name the tools take. */
  const ALIASES = {
    from: ['src', 'source', 'source_path', 'sourcePath', 'from_path', 'old_path', 'oldPath'],
    to: ['dst', 'dest', 'destination', 'destination_path', 'target', 'target_path', 'to_path', 'new_path', 'newPath'],
    path: ['file_path', 'filePath', 'filepath', 'file', 'filename', 'file_name', 'fileName', 'target_file', 'dir', 'directory', 'folder'],
    dir: ['path', 'directory', 'folder', 'root'],
    content: ['contents', 'file_content', 'fileContent', 'text', 'code', 'body'],
    search: ['old_string', 'oldString', 'old_str', 'old_text', 'find'],
    replace: ['new_string', 'newString', 'new_str', 'new_text', 'replacement'],
    pattern: ['query', 'regex', 'search', 'text', 'term'],
    query: ['q', 'search', 'term', 'keywords', 'name', 'pattern'],
    subject: ['query', 'topic', 'q', 'search'],
    command: ['cmd', 'program'],
    url: ['link', 'href', 'uri', 'address'],
    start_line: ['offset', 'start', 'startLine', 'from_line', 'line'],
    end_line: ['end', 'endLine', 'to_line'],
  };
  /** Wrappers a model puts the arguments in, when the tool takes no argument of that name. */
  const WRAPPERS = ['arguments', 'args', 'input', 'params', 'parameters'];

  /** A tool's declared arguments and the ones it needs, from its schema in the shape the tools are offered. */
  function shapeOf(tool) {
    const p = (tool && tool.function ? tool.function.parameters : tool && tool.parameters) || {};
    const props = p.properties || {};
    return { props, names: Object.keys(props), required: Array.isArray(p.required) ? p.required : [] };
  }

  /**
   * The call's arguments with each one given under another usual name moved
   * to the name the tool takes, `{ args, moved }`: `moved` lists them as
   * "src → from". Arguments given whole inside a wrapper the tool does not
   * take are taken out of it first. Arguments the tool does not know and no
   * alias explains are left where they are.
   */
  function normalize(args, tool) {
    const { names } = shapeOf(tool);
    let a = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
    const moved = [];
    if (!names.length) return { args: a, moved };
    const keys = Object.keys(a);
    if (keys.length === 1 && WRAPPERS.includes(keys[0]) && !names.includes(keys[0]) && a[keys[0]] && typeof a[keys[0]] === 'object' && !Array.isArray(a[keys[0]])) {
      moved.push(`${keys[0]} → its contents`);
      a = { ...a[keys[0]] };
    }
    for (const name of names) {
      if (a[name] !== undefined) continue;
      const other = (ALIASES[name] || []).find((k) => !names.includes(k) && a[k] !== undefined);
      if (!other) continue;
      a[name] = a[other];
      delete a[other];
      moved.push(`${other} → ${name}`);
    }
    // A read asked for as an offset and a number of lines, as some tools take it.
    if (names.includes('end_line') && a.end_line === undefined && !names.includes('limit') && Number(a.limit) > 0) {
      a.end_line = (Number(a.start_line) > 0 ? Number(a.start_line) : 1) + Number(a.limit) - 1;
      delete a.limit;
      moved.push('limit → end_line');
    }
    return { args: a, moved };
  }

  /** How an argument is written in an example call. */
  function sample(name, spec) {
    const type = spec && spec.type;
    if (type === 'boolean') return true;
    if (type === 'integer' || type === 'number') return 1;
    if (type === 'array') return [];
    if (type === 'object') return {};
    return '…';
  }

  /**
   * Why the call cannot run, or '': the arguments the tool needs and was not
   * given, each with what it is, and the call written right, when it also
   * gives an argument the tool does not take. Without one, a call that leaves
   * an argument out is the tool's to answer.
   */
  function missing(name, args, tool) {
    const { props, names, required } = shapeOf(tool);
    const a = args && typeof args === 'object' ? args : {};
    const lack = required.filter((k) => a[k] === undefined || a[k] === null);
    const unknown = Object.keys(a).filter((k) => !names.includes(k));
    if (!lack.length || !unknown.length) return '';
    const what = lack.map((k) => {
      const d = props[k] && props[k].description ? String(props[k].description).replace(/^Optional:\s*/, '').replace(/\s+/g, ' ').trim() : '';
      return d ? `${k} (${d.length > 90 ? d.slice(0, 89) + '…' : d})` : k;
    }).join(', ');
    const example = JSON.stringify(Object.fromEntries(required.map((k) => [k, sample(k, props[k])])));
    return `${name} was not run: it needs ${what}, and it does not take ${unknown.join(', ')}. Call it as ${example}, with the real values.`;
  }

  // ── What the run has already asked ───────────────────────────────────

  /** Reads whose answer depends only on what they ask and on the files. */
  const LOCAL_READS = new Set(['read_file', 'list_dir', 'grep_code', 'fuzzy_find']);
  /** Reads whose answer the project's files do not change. */
  const WEB_READS = new Set(['web_search', 'fetch_url', 'find_photos', 'search_knowledge']);
  /** Calls that change files, and which paths. */
  const WRITES = { write_file: ['path'], patch_file: ['path'], delete_file: ['path'], move_file: ['from', 'to'] };
  /** Calls whose effect is not known here: a success or failure may have changed anything. */
  const OPEN_ENDED = new Set(['shell_run', 'execute_python']);

  /** The arguments in a fixed order, without the reason given, which does not change what a call does. */
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => k !== 'reason').sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return JSON.stringify(v === undefined ? null : v);
  }
  const keyOf = (call) => `${call && call.name}::${stable((call && call.arguments) || {})}`;

  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  /** Whether one path holds the other, or they are the same. */
  const touches = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || y.startsWith(x + '/') || x.startsWith(y + '/')); };

  /** The lines a read_file answer showed, from its header, or the whole file when it has none. */
  function linesShown(result, args) {
    const m = /^\[[^\]\n]*?lines (\d+)-(\d+) of (\d+)/.exec(String(result || ''));
    if (m) return { from: Number(m[1]), to: Number(m[2]), last: Number(m[2]) >= Number(m[3]) };
    return args && (args.start_line != null || args.end_line != null) ? null : { from: 1, to: Infinity, last: true };
  }

  /** Whether a command's result says it failed: an exit code other than 0, or out of time. */
  function commandFailed(result) {
    try { const o = JSON.parse(result); return !!o && typeof o === 'object' && ((typeof o.code === 'number' && o.code !== 0) || o.timedOut === true); } catch { return false; }
  }

  /** The text of a failure, from what the tool gave back. */
  function errorOf(result) {
    try { const o = JSON.parse(result); if (o && o.error != null) return String(o.error); } catch { /* not JSON */ }
    return String(result || '');
  }

  const SAME_FAILURE = 'This exact call failed this way before, and nothing has changed since, so it was not made again: it would fail the same way. Change what it asks, or do something else.';
  const SAME_COMMAND = 'No file has changed since, so it was not run again: it would fail the same way, and its output is above. Read the file and the line its output points to, change it, then run it again.';

  /** How a failed command is named in that answer. */
  function commandLine(call, result) {
    const a = call.arguments || {};
    const line = [a.command, ...(Array.isArray(a.args) ? a.args : [])].filter((x) => x != null && x !== '').join(' ') || (call.name === 'execute_python' ? 'This code' : call.name);
    let how = 'failed';
    try { const o = JSON.parse(result); if (o && o.timedOut === true) how = 'ran out of time'; else if (o && typeof o.code === 'number') how = `failed with exit code ${o.code}`; else if (o && o.error != null) how = `failed: ${String(o.error).slice(0, 200)}`; } catch { /* not JSON */ }
    return `\`${line}\` ${how} just now.`;
  }

  /** What a read answered again is told, by tool. */
  function unchanged(call, step) {
    const a = call.arguments || {};
    const at = step ? ` (step ${step})` : '';
    if (call.name === 'read_file') return `[${String(a.path || 'This file').split(/[\\/]/).pop()} has not changed since you read it above${at}, and that read is still in this conversation, so it was not read again. Work from it. Asked again, it will be read again.]`;
    if (WEB_READS.has(call.name)) return `[The same ${call.name} call ran above${at} and its answer is still in this conversation, so it was not made again. Work from it, or ask for something different.]`;
    return `[Nothing it covers has changed since the same ${call.name} call above${at}, and its answer is still in this conversation, so it was not made again. Work from it.]`;
  }

  /**
   * A memory of one run's calls. `before(call, shown, tool)` gives `{ result,
   * ok }` to use in place of making the call, or null to make it: `tool` is
   * its schema, for what it needs, and `shown(id, text)` says whether the
   * model is still sent the answer to call `id` whole. `after(call, result,
   * ok)` records what came back from a call really made.
   */
  function memory() {
    const failed = new Map();   // key -> error
    const reads = new Map();    // key -> { id, text, step, path, lines, served }
    let step = 0;

    function forget(paths) {
      for (const [k, r] of reads) if (r.local && (!paths || paths.some((p) => touches(r.path, p)))) reads.delete(k);
      failed.clear();
    }

    /** An earlier read that answered this one, still current. */
    function earlier(call) {
      const exact = reads.get(keyOf(call));
      if (exact) return exact;
      if (call.name !== 'read_file') return null;
      const a = call.arguments || {};
      const want = { from: Number(a.start_line) > 0 ? Number(a.start_line) : 1, to: Number(a.end_line) > 0 ? Number(a.end_line) : null };
      // A read with no last line asks for a window from its first: covered only by one that went on to the end of the file.
      for (const r of reads.values()) {
        if (r.name === 'read_file' && norm(r.path) === norm(a.path) && r.lines && r.lines.from <= want.from && (want.to == null ? r.lines.last : r.lines.to >= want.to)) return r;
      }
      return null;
    }

    return {
      before(call, shown, tool = null) {
        if (!call || !call.name) return null;
        const lack = tool ? missing(call.name, call.arguments, tool) : '';
        if (lack) return { ok: false, result: JSON.stringify({ error: lack }) };
        const k = keyOf(call);
        if (failed.has(k)) return { ok: false, result: JSON.stringify({ error: `${failed.get(k)} ${OPEN_ENDED.has(call.name) ? SAME_COMMAND : SAME_FAILURE}` }), same: true };
        if (!LOCAL_READS.has(call.name) && !WEB_READS.has(call.name)) return null;
        const r = earlier(call);
        if (!r || r.served || typeof shown !== 'function' || !shown(r.id, r.text)) return null;
        r.served = true;
        return { ok: true, result: unchanged(call, r.step), same: true };
      },
      after(call, result, ok) {
        if (!call || !call.name) return;
        step++;
        const a = call.arguments || {};
        if (OPEN_ENDED.has(call.name)) { forget(null); if (!ok || commandFailed(result)) failed.set(keyOf(call), commandLine(call, result)); return; }
        if (!ok) { failed.set(keyOf(call), errorOf(result)); return; }
        if (WRITES[call.name]) { forget(WRITES[call.name].map((n) => a[n]).filter(Boolean)); return; }
        if (LOCAL_READS.has(call.name) || WEB_READS.has(call.name)) {
          reads.set(keyOf(call), { name: call.name, id: call.id, text: String(result), step, local: LOCAL_READS.has(call.name),
            path: a.path || a.dir || '', lines: call.name === 'read_file' ? linesShown(result, a) : null, served: false });
        }
      },
    };
  }

  window.HCCodeCalls = { ALIASES, normalize, missing, memory, keyOf, SAME_FAILURE };
})();
