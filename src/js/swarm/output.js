// ==============================================================
// An agent's answer, fenced where it is actually code
//
// Agents reply in markdown, and often paste code without fencing it. Unfenced
// code renders as a wall of run-together text, so raw code is found and fenced
// here.
//
// The hazard is the opposite mistake. English and code share their opening
// words — "from the analysis…", "export the findings…", "class sizes have
// grown…" all begin exactly as Python, JavaScript and more Python do. Matching
// on the first word alone turned ordinary sentences into code blocks, and a
// paragraph of prose wrapped as Python is a worse answer than an unfenced
// snippet: it reads as though the agent misunderstood the question.
//
// So a line counts as code only when it carries something prose does not — an
// assignment, a call, a brace, a colon that ends a definition — and the
// whole-document guesses need agreement from several lines.
//
// Pure: takes text, returns text. No DOM, no network.
//
// Loaded before the Agent Maker and published as window.HCSwarmOutput.
// Checked by scripts/checks/swarm-output.mjs.
// ==============================================================

(function () {
  'use strict';

  // Each of these needs punctuation a sentence would not have.
  const HTML_LINE = /^\s*(<(!DOCTYPE|html|head|body|div|section|header|footer|nav|main|article|aside|span|p|h[1-6]|ul|ol|li|a|img|input|button|form|table|tr|td|th|script|style|link|meta|title)(\s[^>]*)?\/?>|<\/\w+>|<!--)/i;

  const PY_LINE = new RegExp([
    '^\\s*(',
    'from\\s+[\\w.]+\\s+import\\s+',      // from x import y — not "from the analysis"
    '|import\\s+[\\w.]+\\s*(as\\s+\\w+)?\\s*$', // a bare module name, nothing after
    '|def\\s+\\w+\\s*\\(',                 // a definition, with its bracket
    '|class\\s+\\w+\\s*[({:]',             // class Name: or class Name(
    '|if\\s+__name__',
    '|#!/usr/bin/env\\s+python',
    ')',
  ].join(''));

  const JS_LINE = new RegExp([
    '^\\s*(',
    '(const|let|var)\\s+([\\w$]+\\s*=|[{[])',  // a declaration binds something — not "let me explain"
    '|function\\s*\\w*\\s*\\(',
    '|class\\s+\\w+\\s*[{(]',
    '|import\\s+[\\w{*].*\\sfrom\\s',
    '|import\\s+[\'"]',
    '|export\\s+(default|const|let|var|function|class|async|\\{|\\*)',
    '|//',
    '|/\\*',
    '|=>',
    '|async\\s+(function|\\()',
    '|await\\s+[\\w.$]+\\s*\\(',            // awaiting a call, not "await confirmation"
    '|[})\\]]',                                 // a line opening with a closing bracket
    ')',
  ].join(''));

  const CSS_LINE = /^\s*([.#]?[\w-]+\s*\{|@media|@keyframes|:root\s*\{|[\w-]+\s*:\s*[^;]+;\s*$)/;

  const JSON_LINE = /^\s*[[{]\s*$|^\s*"[\w-]+"\s*:/;

  // A command word, an argument, and somewhere on the line a character a shell
  // uses and a sentence does not. "echo chambers amplify this effect" opens
  // like a command and is a sentence; "echo \"done\" > log.txt" is not.
  const BASH_LINE = new RegExp([
    '^\\s*(',
    '#!/bin/',
    '|(apt|apt-get|npm|npx|yarn|pnpm|pip|pip3|curl|wget|echo|export|cd|mkdir|chmod|git|docker|sudo|make|brew)\\s+\\S',
    ')',
  ].join(''));
  const SHELL_PUNCTUATION = /[-/=~$*|><"']|\.\w/;

  const SENTENCE_END = /[.!?]\s*$/;

  /**
   * A line that carries on a code block already started: indented, or made only
   * of the punctuation code is closed with. A sentence at the left margin ends
   * the block.
   */
  const CONTINUES_BLOCK = /^\s+\S|^\s*[})\]];?\s*$/;

  /** The language a line is written in, or null when it reads as prose. */
  function detectLang(line) {
    if (HTML_LINE.test(line)) return 'html';
    if (PY_LINE.test(line)) return 'python';
    if (JS_LINE.test(line)) return 'javascript';
    if (CSS_LINE.test(line)) return 'css';
    // A shell command does not end in a full stop, and is not a whole sentence.
    if (BASH_LINE.test(line) && SHELL_PUNCTUATION.test(line) && !SENTENCE_END.test(line)) return 'bash';
    if (JSON_LINE.test(line)) return 'json';
    return null;
  }

  /**
   * Whether the whole answer is one code document.
   *
   * Needs most of the answer to agree, and at least a few lines to agree with.
   * The Python test used to count any line starting with four spaces, so an
   * indented list or a quoted passage read as Python by indentation alone.
   */
  function wholeDocumentLang(text) {
    const trimmed = text.trim();
    if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
    const nonEmpty = text.split('\n').filter((l) => l.trim());
    if (nonEmpty.length <= 3) return null;
    const share = (test) => nonEmpty.filter(test).length / nonEmpty.length;
    if (share((l) => HTML_LINE.test(l)) > 0.45) return 'html';
    if (share((l) => PY_LINE.test(l)) > 0.45) return 'python';
    if (share((l) => JS_LINE.test(l)) > 0.45) return 'javascript';
    return null;
  }

  /** Fence the raw code in an agent's answer, leaving prose alone. */
  function normaliseAgentOutput(text) {
    if (!text) return text;
    // Already fenced somewhere: trust what the agent wrote rather than fencing
    // inside its own fences.
    if (/```[\w]*\n[\s\S]*?```/.test(text)) return text;

    const whole = wholeDocumentLang(text);
    if (whole) return '```' + whole + '\n' + text.trim() + '\n```';

    const lines = text.split('\n');
    const out = [];
    let block = null;

    const flush = () => {
      if (!block) return;
      // Blank lines gathered at the end of a block belong outside it.
      const kept = [...block.lines];
      const trailing = [];
      while (kept.length && !kept[kept.length - 1].trim()) trailing.unshift(kept.pop());
      if (kept.length) {
        out.push('```' + block.lang, ...kept, '```');
      } else {
        out.push(...block.lines);
      }
      out.push(...trailing);
      block = null;
    };

    for (const line of lines) {
      if (line.startsWith('```')) { flush(); out.push(line); continue; }
      const lang = detectLang(line);
      if (lang) {
        if (!block) block = { lang, lines: [] };
        else if (block.lang !== lang) { flush(); block = { lang, lines: [] }; }
        block.lines.push(line);
      } else if (block && (!line.trim() || CONTINUES_BLOCK.test(line))) {
        // Most of a code block is lines that open with no keyword at all — a
        // return, an assignment, a closing brace. Ending the block at the first
        // of them fenced a function's signature and left its body outside,
        // which reads worse than not fencing it at all.
        block.lines.push(line);
      } else {
        flush();
        out.push(line);
      }
    }
    flush();
    return out.join('\n');
  }

  window.HCSwarmOutput = { normaliseAgentOutput, detectLang, wholeDocumentLang };
})();
