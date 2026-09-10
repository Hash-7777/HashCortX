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
// Fences are read here line by line, the way the renderer reads them, so the
// export and the screen agree.
//
// Pure: takes messages, returns text. No DOM, no storage, no network.
//
// Loaded before the Coder mode and published as window.HCCodeExport.
// Checked by scripts/checks/code-export.mjs.
// ==============================================================

(function () {
  'use strict';

  /** An opening fence: up to three spaces, three or more backticks or tildes, then the info line. */
  const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
  const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

  /**
   * The fenced code blocks in a piece of markdown, in order.
   *
   * Follows the same rules as the renderer that draws the chat: a fence is
   * three or more backticks or tildes; the language is the first word of what
   * follows them; a block is closed by a fence of the same character that is
   * at least as long, with nothing after it but spaces; and a backtick fence's
   * info line may not itself contain a backtick. An indented backtick fence
   * takes its indentation off the lines inside it that have that much. A
   * block left open — a reply
   * stopped part way through its code — runs to the end of the message, which
   * is also how it is drawn.
   */
  function codeBlocks(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const blocks = [];
    let open = null;
    // A backtick run that could not open a fence opens an inline code span
    // instead, and the same run later in the paragraph closes it. Without this
    // the closing run was read as a new fence and an empty block appeared that
    // the chat never drew.
    let span = 0;
    for (const line of lines) {
      if (!open) {
        if (!line.trim()) { span = 0; continue; }
        if (span) {
          if (new RegExp('(^|[^`])`{' + span + '}(?!`)').test(line)) span = 0;
          continue;
        }
        const m = OPEN.exec(line);
        if (!m) continue;
        const fence = m[2];
        const info = m[3];
        if (fence[0] === '`' && info.includes('`')) {
          // The run closes on this same line if it appears again; otherwise the
          // span carries on into the lines that follow.
          if (!new RegExp('(^|[^`])`{' + fence.length + '}(?!`)').test(info)) span = fence.length;
          continue;
        }
        open = { char: fence[0], size: fence.length, indent: m[1].length, lang: info.trim().split(/\s+/)[0] || '', body: [] };
        continue;
      }
      const close = CLOSE.exec(line);
      if (close && close[1][0] === open.char && close[1].length >= open.size) {
        blocks.push({ lang: open.lang, code: open.body.join('\n') });
        open = null;
        continue;
      }
      // An indented backtick fence takes its own indentation off the lines
      // inside it that have at least that much, and leaves shallower lines and
      // tilde fences alone. That is what the chat's renderer does rather than
      // what the spec says, and matching the screen is the point.
      const lead = /^\s*/.exec(line)[0].length;
      const strip = open.char === '`' && open.indent && lead >= open.indent;
      open.body.push(strip ? line.slice(open.indent) : line);
    }
    if (open) blocks.push({ lang: open.lang, code: open.body.join('\n') });
    return blocks;
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
    const parts = String(projectRoot || '').split(/[\\/]+/).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : '';
    const clean = last.replace(BAD_IN_NAME, '').replace(/^\.+/, '').trim();
    return clean || 'chat';
  }

  window.HCCodeExport = { codeBlocks, buildMarkdown, buildPlainText, buildCodeOnly, exportBaseName };
})();
