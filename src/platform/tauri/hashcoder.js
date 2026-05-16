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
      await HC.invoke('fs_write_file', { path, content: String(content) });
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
      return HC.invoke('fs_delete_file', { path });
    },

    async searchFiles(dir, pattern) {
      const ok = await HC.guard.request('search', dir, `Pattern: ${pattern}`);
      if (!ok) throw new Error(`Permission denied: search ${dir}`);
      return HC.invoke('fs_search_files', { dir, pattern });
    },

    async shellRun(command, args = [], cwd = null, reason = '') {
      const display = [command, ...args].join(' ');
      const ok = await HC.guard.request('shell', display, reason);
      if (!ok) throw new Error(`Permission denied: shell ${display}`);
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
      description: 'Permanently delete a file or directory. Irreversible — always confirm the path with list_dir or read_file first.',
      parameters: {
        path:   'Absolute path to delete',
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
      name: 'image_search',
      description: 'Get real topic-specific image URLs from Unsplash for use in code. Returns ready-to-embed URLs. Use before writing any HTML/CSS that needs images — never invent image URLs or use placeholder services.',
      parameters: {
        query: { type: 'string', description: 'Topic keywords, e.g. "pizza,italian" or "startup,office"' },
        count: { type: 'number', description: 'Number of URLs to return (1–8, default 4)' },
      },
      fn: async (p) => {
        const query   = String(p.query || '').trim().replace(/\s+/g, ',');
        const count   = Math.min(Math.max(parseInt(p.count) || 4, 1), 8);
        if (!query) return JSON.stringify({ error: 'query is required' });
        const sizes = [
          { w: 1600, h: 900,  label: 'hero/banner' },
          { w: 800,  h: 600,  label: 'card/section' },
          { w: 600,  h: 400,  label: 'thumbnail' },
          { w: 1200, h: 800,  label: 'feature' },
          { w: 400,  h: 400,  label: 'avatar/square' },
          { w: 1400, h: 600,  label: 'wide-banner' },
          { w: 800,  h: 800,  label: 'square-card' },
          { w: 900,  h: 600,  label: 'landscape' },
        ];
        const urls = sizes.slice(0, count).map(s =>
          `https://source.unsplash.com/${s.w}x${s.h}/?${encodeURIComponent(query)}`
        );
        return JSON.stringify({ query, urls, usage: 'Use these as src= in <img> or url() in CSS background-image.' });
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for design trends, UI patterns, technology documentation, or any topic. Call this BEFORE building any website or UI to research current design approaches. Returns summaries and relevant topics.',
      parameters: {
        query: { type: 'string', description: 'Search query, e.g. "modern SaaS landing page design 2024" or "glassmorphism CSS" or "bento grid layout inspiration"' },
      },
      fn: async (p) => {
        const query = String(p.query || '').trim();
        if (!query) return JSON.stringify({ error: 'query is required' });
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
          if (!results.length) return JSON.stringify({ query, message: 'No instant answers found. Apply your training knowledge on this topic.' });
          return JSON.stringify({ query, results });
        } catch (err) {
          return JSON.stringify({ error: err.message, tip: 'Network unavailable. Apply training knowledge: glassmorphism, bento grids, neobrutalism, editorial layouts, dark mode with vibrant accents, bold variable typography.' });
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
• Research design/trends/docs → web_search(query) — call this FIRST for any website or UI task
• Need images for a website/app → image_search(query, count) — ALWAYS call this before writing any HTML/CSS that needs photos. Never invent image URLs.

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

DESIGN RESEARCH (for every website / UI / app task):
① Call web_search with a specific design query BEFORE writing any HTML/CSS. Examples:
   – "modern [type] website design 2024"   (e.g. "modern SaaS dashboard design 2024")
   – "bento grid CSS layout"
   – "glassmorphism UI card design"
   – "neobrutalism web design"
   – "editorial magazine layout CSS"
② Read the results and extract the visual style, color approach, typography, and layout patterns that fit.
③ Call image_search for topic-specific photos.
④ THEN build — applying what you found. Never produce generic hero→features→CTA cookie-cutter templates.
The search is your creative brief. Use it.

MEMORY:
• remember_fact / recall_facts — save and retrieve user preferences, coding style, project context, and tech stack choices across sessions. Use silently; never recite memory unless asked.

REASONING:
• Complex tasks → decompose, announce the plan, execute step by step.
• Ambiguous request → ask ONE focused clarifying question before acting.
• After each tool call, assess the result before deciding the next step.
• NEVER call tools for greetings, conversational replies, or questions that need no file access.`;
})();
