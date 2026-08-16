// ==============================================================
// platform/tauri/hashcoder.js — Agent Tools + System Prompt
// ==============================================================

(function () {
  'use strict';

  if (!window.HC) { window.HC = {}; }

  HC.code = {

    async readFile(path) {
      const ok = await HC.guard.request('read', path, 'Reading file');
      if (!ok) throw new Error(`Permission denied: read ${path}`);
      // A PDF is not text, so fs_read_file answers with a sentence describing
      // it. That sentence used to be everything the agent could get: it could
      // see the file existed and never read a word. The bytes come back
      // instead and pdf.js turns them into the text they hold — the same
      // extraction the app already did for a PDF attached to a chat.
      if (/\.pdf$/i.test(path) && window.HCPdfText) {
        try {
          const file = await HC.invoke('fs_read_base64', { path });
          const name = path.split(/[\\/]/).pop() || path;
          const out = await HCPdfText.extractFromBase64(file.base64, name);
          return `[PDF: ${name} · ${out.pages} page(s)]\n\n${out.text}`;
        } catch (e) {
          // Fall through to the plain read, which explains what the file is.
          // A failure here is worth saying out loud rather than silently
          // handing back a description of a file the agent asked to read.
          return `[Could not read "${path}" as a PDF: ${e?.message || e}]\n\n` +
                 (await HC.invoke('fs_read_file', { path }));
        }
      }
      return HC.invoke('fs_read_file', { path });
    },

    async writeFile(path, content, reason = '') {
      /* Reject null/undefined content — prevents the literal string "null"
         from being written to files when the model omits the content arg */
      if (content == null) {
        throw new Error(
          'write_file: content is required and must be a string. ' +
          'Do not pass null — provide the complete file text.'
        );
      }
      const ok = await HC.guard.request('write', path, reason);
      if (!ok) throw new Error(`Permission denied: write ${path}`);
      // Recorded after approval and before the write, so the copy is of what
      // the file actually held at the moment it was replaced.
      const record = await HC.undo.capture(path);
      await HC.invoke('fs_write_file', { path, content: String(content) });
      // The resulting text, kept alongside the previous text so the panel can
      // show a real diff. patch_file has no `content` argument of its own — it
      // computes the new file and calls through here — so this is the only
      // place the finished result is known without reading the file again.
      if (record) record.after = String(content);
      /* Return a structured result instead of Tauri's null so the UI
         shows something meaningful rather than displaying "null" */
      return JSON.stringify({ ok: true, path, bytes: String(content).length });
    },

    async listDir(path) {
      const ok = await HC.guard.request('list', path, 'Listing directory');
      if (!ok) throw new Error(`Permission denied: list ${path}`);
      return HC.invoke('fs_list_dir', { path });
    },

    async deleteFile(path, reason = '') {
      const ok = await HC.guard.request('delete', path, reason);
      if (!ok) throw new Error(`Permission denied: delete ${path}`);
      // A deletion is the change most worth being able to take back.
      const record = await HC.undo.capture(path);
      if (record) record.after = '';
      return HC.invoke('fs_delete_file', { path });
    },

    async searchFiles(dir, pattern) {
      const ok = await HC.guard.request('search', dir, `Pattern: ${pattern}`);
      if (!ok) throw new Error(`Permission denied: search ${dir}`);
      return HC.invoke('fs_search_files', { dir, pattern });
    },

    /**
     * Where a running command's output goes as it arrives.
     *
     * Set by the Coder panel so a build or a test run appears in the terminal
     * line by line. Left unset — in a browser build, or before the panel
     * mounts — the run still works and returns everything at the end.
     */
    onShellChunk: null,

    async shellRun(command, args = [], cwd = null, reason = '') {
      const display = [command, ...args].join(' ');
      // Where a command runs decides what it does. `npm test` and `rm out.o`
      // mean different things in different folders, and the working directory
      // is chosen by the model, not by the user. Showing only the command
      // asked the user to approve half of the action, so the folder goes in
      // the same string — which also puts it in front of the guard's own
      // checks and into the audit log.
      const shown = cwd ? `${display} (in ${cwd})` : display;
      const ok = await HC.guard.request('shell', shown, reason);
      if (!ok) throw new Error(`Permission denied: shell ${shown}`);

      // Stream when there is somewhere to stream to. A command the agent ran
      // handed back everything at once when it finished, so a two-minute build
      // looked identical to a hung one right up until it ended.
      const Channel = window.__TAURI__?.core?.Channel;
      if (Channel && typeof HC.code.onShellChunk === 'function') {
        const channel = new Channel();
        let stdout = '', stderr = '', code = 0;
        channel.onmessage = (chunk) => {
          if (!chunk) return;
          if (chunk.kind === 'done') { code = chunk.code ?? 0; return; }
          const line = (chunk.data ?? '') + '\n';
          if (chunk.kind === 'stderr') stderr += line; else stdout += line;
          try { HC.code.onShellChunk(chunk, display); } catch { /* a sink must never break a run */ }
        };
        await HC.invoke('shell_run_stream', { command, args, cwd, onChunk: channel });
        return { stdout, stderr, code, timedOut: false, truncated: false };
      }
      return HC.invoke('shell_run', { command, args, cwd });
    },

    /**
     * Images the agent has opened and not yet shown to the model.
     *
     * A tool returns text, and an image is not text — a provider only looks at
     * one when it arrives as part of a message. So reading an image cannot
     * hand it back the way read_file hands back a file; it queues it here, and
     * the Coder panel attaches whatever is waiting to the next turn it builds.
     */
    pendingVision: [],

    async viewImage(path, reason = '') {
      const ok = await HC.guard.request('read', path, reason || 'Looking at an image');
      if (!ok) throw new Error(`Permission denied: read ${path}`);
      const file = await HC.invoke('fs_read_base64', { path });
      const name = String(path).split(/[\\/]/).pop() || path;
      HC.code.pendingVision.push({ path, name, base64: file.base64 });
      return JSON.stringify({
        ok: true, path, bytes: file.bytes,
        note: `${name} is attached to this conversation and you can see it from your next message onward. ` +
              'Describe what is actually in it. If you cannot see an image, say so plainly rather than ' +
              'guessing from the file name — the model in use may not be one that can look at pictures.',
      });
    },

    /** Hand over what is queued, and clear it. Called once per turn built. */
    takePendingVision() {
      const out = HC.code.pendingVision.slice();
      HC.code.pendingVision.length = 0;
      return out;
    },

    async moveFile(from, to, reason = '') {
      if (!from || !to) throw new Error('move_file: both from and to are required.');
      // Each end is asked about on its own, as the path it actually is.
      //
      // This used to ask once, about the string `from → to`. The guard reads
      // its target as a path — that is how it decides whether somewhere is
      // inside the project and needs no dialog — and the joined string is
      // spelled starting with the source, so any move OUT of the project read
      // as a move within it and was approved with no dialog at all. A file
      // written into the project (free) could then be placed anywhere on the
      // disk the denylist does not name, and the user was never asked once.
      //
      // Two requests also mean the destination is checked against the blocked
      // prefixes, which are matched from the start of the target and so only
      // ever saw the source.
      const okFrom = await HC.guard.request('write', from, reason);
      if (!okFrom) throw new Error(`Permission denied: move ${from}`);
      const okTo = await HC.guard.request('write', to, reason ? `${reason} (moving ${from} here)` : `Moving ${from} here`);
      if (!okTo) throw new Error(`Permission denied: move to ${to}`);
      // Two records, because a move is two changes: the file stops existing at
      // one path and starts existing at another. Undoing the pair puts both
      // ends back. Captured before the move, which is the last moment the
      // source still holds anything.
      const gone = await HC.undo.capture(from);
      const made = await HC.undo.capture(to);
      await HC.invoke('fs_move_file', { from, to });
      if (gone) gone.after = '';
      if (made) made.after = gone?.content ?? '';
      return JSON.stringify({ ok: true, from, to });
    },

    async patchFile(path, search, replace, reason = '') {
      if (!search) throw new Error('patch_file: search string is required and must not be empty.');
      if (replace == null) throw new Error('patch_file: replace string is required (use "" to delete).');

      let content;
      try { content = await HC.code.readFile(path); }
      catch { throw new Error(`patch_file failed: "${path}" does not exist. Use write_file to create it instead.`); }

      /* ── Try exact match first ── */
      if (content.includes(search)) {
        const occ = content.split(search).length - 1;
        if (occ > 1) throw new Error(`patch_file failed: search string found ${occ} times in "${path}". Add more surrounding lines to make it unique.`);
        return HC.code.writeFile(path, content.replace(search, replace), reason || `Patching ${path}`);
      }

      /* ── CRLF normalisation fallback (Windows line-endings vs Unix) ── */
      const norm = s => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normContent = norm(content);
      const normSearch  = norm(search);
      if (normContent.includes(normSearch)) {
        const occ = normContent.split(normSearch).length - 1;
        if (occ > 1) throw new Error(`patch_file failed: search string found ${occ} times after line-ending normalisation. Add more surrounding lines.`);
        return HC.code.writeFile(path, normContent.replace(normSearch, replace), reason || `Patching ${path}`);
      }

      /* ── Helpful error: show the first 600 chars so the model can self-correct ── */
      const preview = content.slice(0, 600);
      throw new Error(
        `patch_file failed: search string not found in "${path}".\n` +
        `File begins with:\n${preview}\n\n` +
        `Re-read the file with read_file, copy the exact text you want to replace (preserving every space and indent), then retry.`
      );
    },

    async fuzzyFind(dir, query) {
      const ok = await HC.guard.request('search', dir, `Fuzzy find: ${query}`);
      if (!ok) throw new Error(`Permission denied: search ${dir}`);
      return HC.invoke('fs_fuzzy_find', { dir, query });
    },

    async grepCode(dir, pattern, fileExt = null) {
      const ok = await HC.guard.request('search', dir, `Grep: ${pattern}`);
      if (!ok) throw new Error(`Permission denied: search ${dir}`);
      return HC.invoke('fs_grep', { dir, pattern, fileExt });
    },
  };

  // ── Tool definitions ────────────────────────────────────────

  /**
   * Run one of the tools chat already has, through chat's own dispatcher.
   *
   * Four of the tools below — fetch_url, execute_python, current_datetime and
   * calculate — existed and worked, and Coder simply could not reach them. The
   * worst of those was fetch_url: Coder could search the web and then had no
   * way to read the page it found.
   *
   * Delegating rather than copying matters for more than tidiness. fetch_url
   * carries the address checks in url-safety.js and the name resolution in
   * net.rs; a second copy here would be a second place for those to be missing.
   */
  async function viaChatTool(name, args) {
    const run = window._H?.runOneTool;
    if (!run) return JSON.stringify({ error: `${name} is unavailable — the main app is not loaded.` });
    const result = await run(name, args || {});
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  HC.code.TOOL_DEFINITIONS = [
    {
      name: 'read_file',
      description: 'Read a file\'s content. Handles text, code, config and data files, and reads a PDF as its text — so a .pdf can be read directly, no shell tool needed. A scanned PDF says so rather than coming back empty. Other binary files return a metadata summary. Large files are truncated with a continuation hint.',
      parameters: {
        path: 'Absolute path to the file',
      },
      fn: (p) => HC.code.readFile(p.path),
    },
    {
      name: 'write_file',
      description: 'Create a new file or fully overwrite an existing one. Use for new files or when rewriting >50% of content. For smaller edits, prefer patch_file.',
      parameters: {
        path:    'Absolute path (parent dirs are created automatically)',
        content: 'Complete file content as a string',
        reason:  'Why you are writing this file',
      },
      fn: (p) => HC.code.writeFile(p.path, p.content, p.reason),
    },
    {
      name: 'patch_file',
      description: 'Replace an exact string inside an existing file. Surgical edit — preserves everything else. REQUIREMENT: copy the search string verbatim from read_file output, including all whitespace and indentation.',
      parameters: {
        path:    'Absolute path to the file to edit',
        search:  'Exact string to find (must match character-for-character)',
        replace: 'String to replace it with',
        reason:  'What this change does',
      },
      fn: (p) => HC.code.patchFile(p.path, p.search, p.replace, p.reason),
    },
    {
      name: 'list_dir',
      description: 'List files and subdirectories in a folder. Returns names, types, and sizes. Start from the project root to explore structure.',
      parameters: {
        path: 'Absolute directory path',
      },
      fn: (p) => HC.code.listDir(p.path),
    },
    {
      name: 'delete_file',
      // It said "a file or directory". fs_delete_file refuses a directory
      // outright, so every attempt at one failed and the model had been told
      // it was a thing it could do. It also said "irreversible": what the file
      // held is checkpointed first, and the user can put it back from the
      // change list.
      description: 'Delete a file. Directories are refused — remove their contents, or use shell_run. Always confirm the path with list_dir or read_file first.',
      parameters: {
        path:   'Absolute path to the file to delete',
        reason: 'Why you are deleting this',
      },
      fn: (p) => HC.code.deleteFile(p.path, p.reason),
    },
    {
      name: 'view_image',
      description: "Look at an image file — a screenshot, a diagram, a photo, a mockup. The picture is attached to the conversation and you can see it from your next message onward, so call this and then describe what is there. Use it before rebuilding a screen from a screenshot, or when a file's meaning is visual rather than textual. Needs a model that can see images; if you cannot see it, say so rather than guessing from the file name.",
      parameters: {
        path:   'Absolute path of the image (png, jpg, gif, webp)',
        reason: 'Why you are opening it',
      },
      fn: (p) => HC.code.viewImage(p.path, p.reason),
    },
    {
      name: 'move_file',
      description: 'Rename a file, or move it to another folder. Refuses to overwrite an existing destination — delete that first if replacing it is what you mean. Prefer this over `mv` in shell_run: a move made this way is recorded and the user can undo it.',
      parameters: {
        from:   'Absolute path of the file as it is now',
        to:     'Absolute path it should have (parent folders are created)',
        reason: 'Why you are moving it',
      },
      fn: (p) => HC.code.moveFile(p.from, p.to, p.reason),
    },
    {
      name: 'search_knowledge',
      description: "Search the user's knowledge base — documents and pages they ingested — for passages about a topic. Use it before assuming a house convention, a policy or a past decision, and cite the source it returns. Returns nothing useful if the user has not ingested anything or has the knowledge base switched off, and says which of those it is.",
      parameters: {
        query: { type: 'string', description: 'What to look for, in a few words.' },
      },
      fn: async (p) => {
        const query = String(p.query || '').trim();
        if (!query) return JSON.stringify({ error: 'query is required' });
        if (!window._H?.ragSearch) {
          return JSON.stringify({ error: 'The knowledge base is unavailable — the main app is not loaded.' });
        }
        // Off and empty are different answers, and both used to look like "no
        // results". A model told "nothing found" will state a convention it
        // invented; one told the base is switched off will say so.
        if (window._H.ragIsOn && !window._H.ragIsOn()) {
          return JSON.stringify({
            query, passages: [],
            message: 'The knowledge base is switched off, so nothing was searched. Say so rather than answering as if it were empty — the user can turn it on in the Agents tab.',
          });
        }
        const chunks = await window._H.ragSearch(query);
        if (!chunks.length) {
          return JSON.stringify({
            query, passages: [],
            message: 'The knowledge base is on and held nothing matching this. Answer from the code and say the knowledge base had nothing on it.',
          });
        }
        return JSON.stringify({
          query,
          passages: chunks.map((c, i) => ({
            rank: i + 1,
            source: c.source || 'unknown',
            title: c.title || '',
            chunk: c.index ?? 0,
            text: c.text || '',
          })),
          note: 'Cite the source and title when you use one of these.',
        });
      },
    },
    {
      name: 'fetch_url',
      description: 'Read a web page and return its text. Use it after web_search to actually read what you found — a search result gives you a title and a snippet, not the documentation. Only public http(s) addresses; anything resolving to a private or local address is refused.',
      parameters: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
      },
      fn: async (p) => {
        const url = String(p.url || '').trim();
        if (!url) return JSON.stringify({ error: 'url is required' });
        // Chat calls this without asking, and that is defensible there. Here it
        // is not: Coder can read every file in the project, and a URL is chosen
        // by the model, so a fetch is a way for anything just read to leave the
        // machine inside a query string. url-safety.js and net.rs stop it
        // reaching the user's own network; neither has an opinion about a
        // public host. So the user is asked, and can grant the session.
        const ok = await HC.guard.request('fetch', url, p.reason || 'Reading a web page');
        if (!ok) throw new Error(`Permission denied: fetch ${url}`);
        return viaChatTool('fetch_url', { url });
      },
    },
    {
      name: 'execute_python',
      description: 'Run Python in a sandbox that ships with the app, with pandas, numpy and matplotlib available. Use it for data work, quick calculations over a file, or generating a chart — it needs no Python installed on the machine and cannot touch the filesystem. To run the project\'s own Python, use shell_run instead.',
      parameters: {
        code: { type: 'string', description: 'Python source. Stdout is captured. Files written to /output/<name> are offered to the user to save.' },
      },
      fn: (p) => viaChatTool('execute_python', { code: p.code }),
    },
    {
      name: 'current_datetime',
      description: "Today's date and the current time. Call it before writing a date into a file, a changelog or a commit message — you do not otherwise know what day it is.",
      parameters: {},
      fn: () => viaChatTool('current_datetime', {}),
    },
    {
      name: 'calculate',
      description: 'Evaluate a arithmetic expression exactly. Use it rather than doing arithmetic in your head when the number ends up in code or in a message to the user.',
      parameters: {
        expression: { type: 'string', description: "Math expression, e.g. '(3.14 * 2**10) / 7' or 'Math.sqrt(2)'." },
      },
      fn: (p) => viaChatTool('calculate', { expression: p.expression }),
    },
    {
      name: 'fuzzy_find',
      description: 'Find files by approximate name — tolerates typos, partial names, and case differences. Returns top 15 matches ranked by similarity. Use when you know roughly what a file is called.',
      parameters: {
        dir:   { type: 'string', description: 'Root directory to search from (project root or homeDir)' },
        query: { type: 'string', description: 'Approximate file name or stem to match' },
      },
      fn: (p) => HC.code.fuzzyFind(p.dir, p.query),
    },
    {
      name: 'grep_code',
      description: 'Search inside file contents for a text pattern. Returns matching lines with surrounding context. Use to find where a function, class, variable, or string is defined or used.',
      parameters: {
        dir:      { type: 'string', description: 'Root directory to search from' },
        pattern:  { type: 'string', description: 'Text to search for (case-insensitive)' },
        file_ext: { type: 'string', description: 'Optional: limit to files with this extension, e.g. "js" or "py"' },
      },
      fn: (p) => HC.code.grepCode(p.dir, p.pattern, p.file_ext || null),
    },
    {
      name: 'shell_run',
      description: 'Run a shell command. Use for git, builds, tests, and file inspection. INSTALL RULE: before running npm/pip/cargo install, check if node_modules/venv/target already exists — skip install if it does. Never pipe remote content to a shell (curl … | sh is blocked). Never install packages not listed in the project manifest without asking the user.',
      parameters: {
        command: { type: 'string', description: 'Command name, e.g. "npm", "git", "grep"' },
        args:    { type: 'array', items: { type: 'string' }, description: 'Arguments array, e.g. ["install", "--save-dev", "lodash"]. For installs: only packages already in package.json/requirements.txt/Cargo.toml.' },
        cwd:     { type: 'string', description: 'Working directory absolute path (omit to use project root)' },
        reason:  { type: 'string', description: 'Why you are running this command' },
      },
      fn: (p) => HC.code.shellRun(p.command, p.args || [], p.cwd || null, p.reason),
    },
    {
      name: 'placeholder_images',
      description: 'Get working placeholder image URLs for a mock-up or prototype. These are STABLE, real, loadable URLs — but they are generic placeholder photography, not pictures of the subject. Say so when you use them, and tell the user to swap in their own assets before shipping. Only call this when a layout genuinely needs a photo; a gradient, an icon or an inline SVG is usually better and always faster.',
      parameters: {
        seed:  { type: 'string', description: 'Any word. The same seed always returns the same picture, so a rebuild does not reshuffle the page.' },
        count: { type: 'number', description: 'How many URLs (1–8, default 4)' },
      },
      fn: async (p) => {
        // This used to call source.unsplash.com, which Unsplash retired — every
        // URL it produced returned HTTP 503, so every site the agent built
        // shipped with broken images while the tool description promised "real
        // topic-specific image URLs". picsum.photos is keyless, stable, and
        // seeded, so a page looks the same on every rebuild.
        const seed = String(p.seed || 'hashcortx').trim().replace(/[^\w-]+/g, '-').slice(0, 40) || 'hashcortx';
        const count = Math.min(Math.max(parseInt(p.count) || 4, 1), 8);
        const sizes = [
          { w: 1600, h: 900, label: 'hero / banner' },
          { w: 800,  h: 600, label: 'card / section' },
          { w: 600,  h: 400, label: 'thumbnail' },
          { w: 1200, h: 800, label: 'feature' },
          { w: 400,  h: 400, label: 'avatar / square' },
          { w: 1400, h: 600, label: 'wide banner' },
          { w: 800,  h: 800, label: 'square card' },
          { w: 900,  h: 600, label: 'landscape' },
        ];
        const images = sizes.slice(0, count).map((s, i) => ({
          label: s.label,
          url: `https://picsum.photos/seed/${encodeURIComponent(seed + '-' + i)}/${s.w}/${s.h}`,
        }));
        return JSON.stringify({
          images,
          note: 'Generic placeholder photography, not pictures of the subject. Give every <img> descriptive alt text, set width/height or aspect-ratio to avoid layout shift, and tell the user these are placeholders to replace.',
        });
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for documentation, APIs, error messages or design references. With a Tavily key configured in Settings this is a real search engine. Without one it falls back to DuckDuckGo\'s instant-answer endpoint, which only knows encyclopedia-style facts and returns nothing for most developer queries — the result will say so plainly. Do not call it for things you already know.',
      parameters: {
        query: { type: 'string', description: 'What to search for' },
      },
      fn: async (p) => {
        const query = String(p.query || '').trim();
        if (!query) return JSON.stringify({ error: 'query is required' });

        // Prefer the real search engine the app already supports. Coder mode
        // had no access to it and always used DuckDuckGo's instant-answer API,
        // which answers "what is a capybara" and almost nothing a developer
        // would ask — while the tool described itself as a web search.
        try {
          const viaTavily = await window._H?.tavilySearch?.(query, 5);
          if (viaTavily) return JSON.stringify({ query, source: 'tavily', results: viaTavily });
        } catch { /* fall through to the free endpoint */ }

        try {
          const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          const results = [];
          if (data.Answer) results.push({ title: 'Direct Answer', snippet: String(data.Answer) });
          if (data.AbstractText) results.push({ title: data.Heading || query, snippet: data.AbstractText.slice(0, 500), url: data.AbstractURL });
          if (Array.isArray(data.RelatedTopics)) {
            for (const t of data.RelatedTopics.slice(0, 8)) {
              if (t.Text) results.push({ title: (t.FirstURL || '').split('/').pop()?.replace(/_/g, ' ') || '', snippet: t.Text.slice(0, 200), url: t.FirstURL || '' });
            }
          }
          if (!results.length) {
            return JSON.stringify({
              query,
              source: 'duckduckgo-instant-answer',
              results: [],
              message: 'No results. This endpoint only covers encyclopedia-style facts, so a developer query usually returns nothing. Answer from your own knowledge and say it is not from a search. Add a Tavily key in Settings for real search.',
            });
          }
          return JSON.stringify({ query, source: 'duckduckgo-instant-answer', results });
        } catch (err) {
          return JSON.stringify({ error: err.message, message: 'Search is unavailable. Answer from your own knowledge and say so.' });
        }
      },
    },
    {
      name: 'remember_fact',
      description: 'Save a fact to cross-session memory. Call silently for any preference, project, person, deadline, coding style, or tech stack choice. Use stable keys (preferred_framework, project_stack, coding_style).',
      parameters: {
        key:   { type: 'string', description: 'Short label for the fact (e.g. "preferred_framework", "project_stack", "lint_rules")' },
        value: { type: 'string', description: 'The fact itself, in natural language.' },
      },
      fn: (p) => { if (window._H?.memAdd) return window._H.memAdd(p.key, p.value); return { ok: false, error: 'Memory not available' }; },
    },
    {
      name: 'recall_facts',
      description: 'Search long-term memory. Call before saying "unknown" if the topic might be saved. Pass keywords, not the full question.',
      parameters: {
        query: { type: 'string', description: 'Keywords to search memory for. Empty string returns most recent facts.' },
      },
      fn: (p) => {
        if (window._H?.memRecall) {
          const facts = window._H.memRecall(p.query || '', 8);
          return { facts: facts.map(f => ({ key: f.key, value: f.value, saved_at: new Date(f.ts).toISOString() })) };
        }
        return { ok: false, error: 'Memory not available' };
      },
    },
  ];

  // ── System prompt ───────────────────────────────────────────

  HC.code.SYSTEM_PROMPT = `You are HashCortX Coder — a precision coding agent with real filesystem and shell access on the user's machine.

WORKFLOW (follow this order every time):
① ORIENT — locate files first. Use fuzzy_find by name, grep_code by content, list_dir to explore. NEVER guess or invent paths.
② READ — always read_file before editing. Understand exact current content before changing anything.
③ ACT — patch_file for targeted edits (<50% of file); write_file for new files or full rewrites only.
④ VERIFY — shell_run tests/build/lint after significant changes when it adds value.

PATCH RULES (most common failure mode):
• The search string must be EXACT — copy it character-for-character from read_file output, preserving every space and indent.
• If patch fails "not found": re-read → find the real string → retry once. If it fails again, explain what you found and ask.
• One patch call per edit. Complete each before starting the next.

TOOL ROUTING:
• File name unknown/fuzzy  → fuzzy_find(dir, query)
• Find code by content     → grep_code(dir, pattern, file_ext?)
• Targeted edit            → patch_file
• New file / full rewrite  → write_file
• A screenshot, diagram, mockup or photo → view_image, then say what is in
  it. Never describe an image from its file name.
• Rename or relocate a file → move_file, NOT \`mv\` in shell_run. A move made
  with move_file is recorded and the user can undo it; one made with \`mv\`
  cannot be undone at all.
• Explore structure        → list_dir
• Build / test / git / inspect binary → shell_run
• A house convention, policy, or past decision → search_knowledge(query) FIRST,
  and cite the source it gives you. Do not invent a convention. If it reports
  the knowledge base is off or empty, say so rather than answering as if you
  had checked.
• Look something up you do not know → web_search(query), then fetch_url(url) to
  actually read the page. A search result is a title and a snippet, not
  documentation — do not answer from the snippet alone.
• Data work, a calculation over a file, a chart → execute_python. It ships with
  the app and needs no Python installed. For the project's OWN python, shell_run.
• Writing a date anywhere → current_datetime first. You do not know what day it is.
• A number that ends up in code or in a message → calculate
• A layout genuinely needs a photo → placeholder_images(seed, count). Prefer gradients, icons or inline SVG; never invent an image URL.

FILE READING:
• read_file handles all text formats and returns readable metadata for binary/large files.
• For truncated files: use grep_code or shell_run grep/head/tail to target specific sections.
• For binary inspection, use what this machine actually has — the platform is
  stated at the end of this prompt, so read it before choosing.
  macOS and Linux: \`file\`, \`xxd -l 128\`, \`sqlite3 <db> .tables\`.
  macOS only: \`sips -g all\` for image dimensions.
  Windows: \`certutil -dump\`, or PowerShell \`Format-Hex -Count 128\`.
  If a command comes back "not found", that tool is not installed — pick
  another rather than repeating it.

SHELL RULES:
• Blocked commands: sudo, rm -rf, dd, format, shutdown, reboot.
• Blocked paths, refused wherever they are spelled: credential stores
  (~/.ssh, ~/.aws, ~/.gnupg, ~/.hashcortx) and system directories — /System,
  /etc, /private, /usr/bin on macOS and Linux; Windows\\System32, SysWOW64 and
  the Microsoft credential stores on Windows.
• Always pass paths in the args array — never concatenate them into the command string.
• NEVER pipe downloaded content to a shell interpreter: curl/wget/fetch … | sh/bash/zsh/python is strictly forbidden.
• NEVER use process substitution to execute remote content: bash <(curl …) or sh <(curl …) is forbidden.

DEPENDENCY RULES (follow every time, no exceptions):
• npm/yarn: check if node_modules/ exists with list_dir before running install. If it exists, skip install entirely.
• pip/pipenv/poetry: check if venv/, .venv/, or site-packages contains the needed package before installing.
• cargo: check if target/ exists and Cargo.lock is present before running cargo build or cargo install.
• brew/apt/dnf: NEVER install system packages without explicit user instruction — ask first.
• When adding a NEW package: only install packages that are in the project's manifest (package.json, requirements.txt, Cargo.toml, pyproject.toml, go.mod). Ask the user before installing anything not already listed there.

BUILDING A UI:
• Design from what you know. You have read more design work than a search will return, and
  a mandatory search before every UI task cost a round trip and returned nothing useful.
  Search only when you actually need a fact you do not have — an API signature, a CSS
  property's support, a library's current name.
• Never produce a generic hero→features→CTA template. Commit to a specific visual idea
  and carry it through: type scale, spacing rhythm, one accent colour used deliberately.
• Images: prefer CSS gradients, icons and inline SVG. When a photo is genuinely required,
  call placeholder_images — the URLs it returns work, but they are generic stock, so say
  so and tell the user to replace them. Never write an image URL you have not been given.
• Always: descriptive alt text, explicit width/height or aspect-ratio to stop layout shift,
  visible :hover and :focus states, and a prefers-reduced-motion fallback for animation.

MEMORY:
• remember_fact / recall_facts — save and retrieve user preferences, coding style, project context, and tech stack choices across sessions. Use silently; never recite memory unless asked.

REASONING:
• Complex tasks → decompose, announce the plan, execute step by step.
• Ambiguous request → ask ONE focused clarifying question before acting.
• After each tool call, assess the result before deciding the next step.
• NEVER call tools for greetings, conversational replies, or questions that need no file access.`;

  /**
   * One line telling the model which machine it is working on.
   *
   * Without it the prompt could only name tools and hope. It named macOS ones
   * — `sips`, `xxd` — which do not exist on Windows, so on that platform the
   * agent was being advised to run commands that cannot work, and had no way
   * of knowing that. The app already asks Rust for this at boot for the
   * terminal's sake; it costs nothing to tell the model too.
   *
   * `info` is what `shell_platform` returns. Anything missing is left out
   * rather than guessed. Returned ready to append — with its own leading
   * newline, or '' before the boot probe has answered — so a caller can add it
   * to a prompt unconditionally.
   */
  HC.code.platformLine = function platformLine(info) {
    if (!info || !info.os) return '';
    const name = { macos: 'macOS', windows: 'Windows', linux: 'Linux' }[String(info.os).toLowerCase()]
      || info.os;
    const parts = [`Platform: ${name}`];
    if (info.shell) parts.push(`shell: ${info.shell}`);
    if (info.separator) parts.push(`path separator: ${info.separator}`);
    return '\n' + parts.join(', ') + '. Use the tools that exist here.';
  };
})();
