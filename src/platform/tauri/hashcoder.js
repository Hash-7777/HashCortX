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
      return HC.invoke('shell_run', { command, args, cwd });
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
      return HC.invoke('fs_grep', { dir, pattern, file_ext: fileExt });
    },
  };

  // ── Tool definitions ────────────────────────────────────────

  HC.code.TOOL_DEFINITIONS = [
    {
      name: 'read_file',
      description: 'Read a file\'s content. Handles text, code, config, and data files. Binary files return a metadata summary. Large files are truncated with a continuation hint.',
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
• Explore structure        → list_dir
• Build / test / git / inspect binary → shell_run
• Look something up you do not know → web_search(query)
• A layout genuinely needs a photo → placeholder_images(seed, count). Prefer gradients, icons or inline SVG; never invent an image URL.

FILE READING:
• read_file handles all text formats and returns readable metadata for binary/large files.
• For truncated files: use grep_code or shell_run grep/head/tail to target specific sections.
• For binary inspection: shell_run with \`file\`, \`xxd -l 128\`, \`sips\`, \`sqlite3 .tables\`, etc.

SHELL RULES:
• Blocked commands: sudo, rm -rf, dd, format, shutdown, reboot.
• Blocked paths: ~/.ssh, ~/.aws, /System, /etc, /private, /usr/bin.
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
})();
