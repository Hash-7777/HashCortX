// ==============================================================
// The files a swarm's answer is made of
//
// The Agent Swarm previews a site its agents wrote, and offers it as a single
// page to download. Both start here: the answer is read for code blocks that
// name a file, in any of the ways models name them, with a plain html, css or
// js block standing in when nothing is named.
//
// Blocks are found by src/js/fences.js, which reads a fence the way the chat
// draws it. The patterns that stood here needed a bare newline straight after
// the file name, so a block with Windows line endings, a space after its name,
// a tilde fence, or a language such as C++ or C# was not found — and a site
// written correctly could end in "No HTML file found".
//
// Names are kept in lower case on purpose: the preview and the file tabs look
// files up without regard to case. A later block with the same name wins, so a
// QA agent's correction replaces the file it corrects.
//
// TWO WAYS A FILE USED TO LOSE ITS NAME, both seen in one real run.
// A model names a file by writing it on the first line as a comment far more
// often than it names its fence — "// script.js", "/* style.css */",
// "<!-- index.html -->" — and only the "file:" spelling was read. So an
// agent's stylesheet arrived anonymous and was guessed at below, where it
// became a SECOND stylesheet beside the one the team had agreed on, and both
// went into the page: two palettes, two resets, two sets of class names.
// Its module, named "// catalogue.js", became app.js with its exports intact,
// and the script the page actually asked for was never written at all.
// So: a name in a comment is a name, and a guess never replaces or duplicates
// a file that has one.
//
// A NAME IN THE SENTENCE ABOVE. A program's files are as often named in the
// words just before their block — "Save the following code as `todo.py`:",
// or a heading "### 1. Application Code (`todo.py`)" — and a whole Python
// project came back as "This run made no files". A block with no name of its
// own takes the one file name in the last line or two of text above it, when
// that name's extension is one the block's language is written in, so the
// command shown to run a test is not taken for the test file. It is read as
// a guess is: never over a file already there, and not in a reply.
//
// Pure: text in, files out. No DOM, no storage, no network.
//
// Loaded after js/fences.js, before the Agent Swarm, and published as
// window.HCSwarmProjectFiles. Checked by scripts/checks/swarm-project-files.mjs.
// ==============================================================

(function () {
  'use strict';

  // The extensions a file is written in. Used to tell a name in a comment
  // from a version number or a figure reference.
  const CODE_EXT = new Set([
    "html", "htm", "css", "scss", "js", "mjs", "cjs", "jsx", "ts", "tsx", "json",
    "svg", "py", "rb", "go", "rs", "java", "php", "cs", "swift", "kt", "sh",
    "md", "txt", "yml", "yaml", "toml", "xml", "csv", "sql", "vue", "svelte",
    "c", "cpp", "h", "hpp",
  ]);

  // The extensions each language a block names is written in; a language not
  // listed, or none, fits any.
  const LANG_EXT = {
    python: ["py"], py: ["py"], javascript: ["js", "mjs", "cjs", "jsx"], js: ["js", "mjs", "cjs", "jsx"], jsx: ["jsx", "js"],
    typescript: ["ts", "tsx"], ts: ["ts", "tsx"], tsx: ["tsx"], html: ["html", "htm"], css: ["css"], scss: ["scss"],
    json: ["json"], bash: ["sh"], sh: ["sh"], shell: ["sh"], zsh: ["sh"], console: [], text: ["txt", "md", "csv"], markdown: ["md"], md: ["md"],
    yaml: ["yml", "yaml"], yml: ["yml", "yaml"], toml: ["toml"], xml: ["xml", "svg"], svg: ["svg"], sql: ["sql"],
    ruby: ["rb"], go: ["go"], rust: ["rs"], java: ["java"], php: ["php"], csharp: ["cs"], "c#": ["cs"], swift: ["swift"], kotlin: ["kt"],
    c: ["c", "h"], cpp: ["cpp", "hpp", "h"], "c++": ["cpp", "hpp", "h"],
  };
  function fitsLang(name, lang) {
    const allowed = LANG_EXT[String(lang || "").toLowerCase()];
    return !allowed || allowed.includes(name.split(".").pop().toLowerCase());
  }

  function guessLang(filename) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    return { html:"html", htm:"html", css:"css", js:"javascript", ts:"typescript",
             jsx:"javascript", tsx:"typescript", json:"json", py:"python",
             md:"markdown", svg:"svg", sh:"bash" }[ext] || "text";
  }

  /**
   * `guess: false` keeps only files the answer names, for a reply to a change
   * request: there an unnamed block is as likely an example as a file, and
   * standing it in for styles.css would replace a whole stylesheet with it.
   * A complete page is the one exception, since it can only be the page.
   *
   * `existing` is what the project already holds from the agents that went
   * before. A guess never outranks a name: an agent who pastes a whole page
   * without naming it does not replace the page the team agreed on, and an
   * unnamed stylesheet does not become a second stylesheet fighting the
   * first. Names still win over names, last one first, so a correction lands.
   */
  function extractProjectFiles(text, { guess = true, existing } = {}) {
    const files = new Map();
    const parts = window.HCFences.splitFences(text || "");
    const blocks = parts.filter(p => p.type === "code");
    const NAME = /^[^\s`'"]+\.\w{1,8}$/;
    // A name found in a comment needs an extension a file is really written
    // in. Without this, "// v1.2" and "# Fig.3" both name files.
    const isFileName = (n) => NAME.test(n) && CODE_EXT.has(n.split(".").pop().toLowerCase());
    const named = new Set();
    const put = (name, lang, content, block) => { files.set(name.toLowerCase(), { lang: lang || guessLang(name), content }); if (block) named.add(block); };

    // Primary: ```lang filename.ext. Last wins, so a QA agent's correction
    // overwrites the file it corrects.
    for (const b of blocks) {
      // A space where the language would be means the whole line is the name.
      const bare = /^\s/.test(b.rawInfo || "");
      const rest = (bare ? b.info : b.info.replace(/^\S+\s*/, "")).replace(/^["']|["']$/g, "");
      if ((bare || b.info.includes(" ")) && NAME.test(rest)) put(rest, bare ? "" : b.lang, b.code, b);
    }
    // Secondary: ```lang:filename.ext (last wins).
    for (const b of blocks) {
      const m = /^([\w+#-]+):([\w./\-]+\.\w{1,8})$/.exec(b.info);
      if (m) put(m[2], m[1], b.code, b);
    }
    // Tertiary: the name on the first line, as a comment, in any of the ways
    // a comment opens (last wins). The name is not part of the file. "file:"
    // stays optional because it was the only spelling read before.
    for (const b of blocks) {
      const nl = b.code.indexOf("\n");
      const head = nl === -1 ? b.code : b.code.slice(0, nl);
      const m = /^\s*(?:\/\/|#|\/\*|<!--)\s*(?:file:\s*)?([^\s*]+?)\s*(?:\*\/|-->)?\s*$/.exec(head);
      if (m && isFileName(m[1])) put(m[1], b.lang, nl === -1 ? "" : b.code.slice(nl + 1), b);
    }
    if (!guess) {
      const page = blocks.find(b => b.lang.toLowerCase() === "html" && /^\s*<(!doctype\s+html|html[\s>])/i.test(b.code));
      if (page && !files.has("index.html")) files.set("index.html", { lang: "html", content: page.code });
      return files;
    }
    // Fourth: the one file name in the last line or two of text above a block
    // that has no name of its own, written in the block's language. Like a
    // guess, it never replaces a file the project or the answer already has,
    // and a reply to a change request does not use it: there the words above
    // a block as often show a part of a file as the whole of one.
    const taken = [...files.keys(), ...(existing || [])].map(n => String(n).toLowerCase());
    parts.forEach((part, i) => {
      if (part.type !== "code" || named.has(part) || i === 0 || parts[i - 1].type !== "text") return;
      const lines = parts[i - 1].text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-2).reverse();
      for (const line of lines) {
        const names = [...new Set((line.match(/[\w./-]+\.\w{1,8}/g) || []).filter((n) => isFileName(n) && !/^\.|\/\.\.?\//.test(n)))];
        if (names.length === 1 && fitsLang(names[0], part.lang)) { if (!taken.includes(names[0].toLowerCase())) { put(names[0], part.lang, part.code); taken.push(names[0].toLowerCase()); } return; }
        if (names.length) return;
      }
    });
    // Fallbacks for the preview: a plain html, css or js block, but only for
    // a kind of file the project does not have yet.
    const firstOf = (...langs) => blocks.find(b => langs.includes(b.lang.toLowerCase()));
    const known = [...files.keys(), ...(existing || [])].map(n => String(n).toLowerCase());
    const holds = (test) => known.some(test);
    if (!holds(n => n === "index.html" || n === "index.htm")) {
      const h = firstOf("html");
      if (h) files.set("index.html", { lang: "html", content: h.code });
    }
    if (!holds(n => n.endsWith(".css"))) {
      const c = firstOf("css");
      if (c) files.set("styles.css", { lang: "css", content: c.code });
    }
    if (!holds(n => n.endsWith(".js") || n.endsWith(".mjs"))) {
      const j = firstOf("javascript", "js");
      if (j) files.set("app.js", { lang: "javascript", content: j.code });
    }
    return files;
  }
  window.HCSwarmProjectFiles = { extractProjectFiles, guessLang };
})();
