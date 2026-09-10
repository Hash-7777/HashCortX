// ==============================================================
// A Coder conversation, written out for someone to keep
//
// Export is what a person takes away from the app: the whole chat as text or
// markdown, or just the code in it. It has to contain what they saw.
//
// The code-only export found its blocks with its own pattern, which accepted a
// language written only in letters, digits and underscores, followed directly
// by a newline. The chat itself is drawn by a markdown renderer that reads a
// fence the way GitHub does — the language is whatever follows the backticks
// on that line. So a block in C++, C#, Objective-C or a shell session, a block
// whose fence carried a title, and any block written with Windows line
// endings all showed as code on screen and were missing from the export. A
// conversation whose only code was C++ was told it had no code at all.
//
// Fences are read by src/js/fences.js, line by line the way the renderer
// reads them, so the export and the screen agree.
//
// Pure: takes messages, returns text. No DOM, no storage, no network.
//
// Loaded after js/fences.js and js/code/paths.js, before the Coder mode, and
// published as window.HCCodeExport.
// Checked by scripts/checks/code-export.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * The fenced code blocks in a piece of markdown, in order, read by
   * src/js/fences.js to the same rules as the renderer that draws the chat.
   */
  function codeBlocks(text) {
    return window.HCFences.codeBlocks(text).map(({ lang, code }) => ({ lang, code }));
  }

  /** Messages that belong in an export: what the person and the agent said. */
  const spoken = (msgs) => (Array.isArray(msgs) ? msgs : []).filter((m) => m && m.role !== 'system');

  const header = (title, opts) => {
    const lines = [title, 'Date: ' + (opts.date || new Date().toLocaleString())];
    if (opts.projectRoot) lines.push('Project: ' + opts.projectRoot);
    return lines;
  };

  function buildMarkdown(msgs, opts = {}) {
    const lines = header('# HashCortx Coder — Chat Export', opts);
    lines.push('');
    for (const m of spoken(msgs)) {
      lines.push(m.role === 'user' ? '## User' : '## Agent', '');
      lines.push(String(m.content ?? ''), '');
    }
    return lines.join('\n');
  }

  function buildPlainText(msgs, opts = {}) {
    const lines = header('HashCortx Coder — Chat Export', opts);
    lines.push('═'.repeat(60));
    for (const m of spoken(msgs)) {
      lines.push('');
      lines.push((m.role === 'user' ? '>>> USER' : '<<< AGENT') + ' ' + '─'.repeat(40));
      lines.push(String(m.content ?? ''));
    }
    return lines.join('\n');
  }

  function buildCodeOnly(msgs) {
    const out = [];
    let n = 0;
    for (const m of spoken(msgs)) {
      for (const block of codeBlocks(m.content)) {
        n++;
        out.push('/* ── block ' + n + ' · ' + (block.lang || 'text') + ' ── */');
        out.push(block.code.trimEnd());
        out.push('');
      }
    }
    return out.join('\n');
  }

  /** Characters no operating system accepts in a file name, control characters included. */
  const BAD_IN_NAME = new RegExp('[<>:"|?*' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');

  /**
   * The project's name, fit to go into a file name.
   *
   * The path was split on forward slashes only, which on Windows left the whole
   * path — drive letter, colon and backslashes — in the name the save dialog
   * was offered, and a path ending in a slash gave no name at all.
   */
  function exportBaseName(projectRoot) {
    // The folder's name is read by the same helper the rest of the Coder uses,
    // so there is one rule for what a path's last part is.
    const last = projectRoot ? window.HCCodePaths.baseName(projectRoot) : '';
    const clean = last.replace(BAD_IN_NAME, '').replace(/^\.+/, '').trim();
    return clean || 'chat';
  }

  window.HCCodeExport = { codeBlocks, buildMarkdown, buildPlainText, buildCodeOnly, exportBaseName };
})();
