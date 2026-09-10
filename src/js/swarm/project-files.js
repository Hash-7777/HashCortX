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
// Pure: text in, files out. No DOM, no storage, no network.
//
// Loaded after js/fences.js, before the Agent Swarm, and published as
// window.HCSwarmProjectFiles. Checked by scripts/checks/swarm-project-files.mjs.
// ==============================================================

(function () {
  'use strict';

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
   */
  function extractProjectFiles(text, { guess = true } = {}) {
    const files = new Map();
    const blocks = window.HCFences.splitFences(text || "").filter(p => p.type === "code");
    const NAME = /^[^\s`'"]+\.\w{1,8}$/;
    const put = (name, lang, content) => files.set(name.toLowerCase(), { lang: lang || guessLang(name), content });

    // Primary: ```lang filename.ext. Last wins, so a QA agent's correction
    // overwrites the file it corrects.
    for (const b of blocks) {
      // A space where the language would be means the whole line is the name.
      const bare = /^\s/.test(b.rawInfo || "");
      const rest = (bare ? b.info : b.info.replace(/^\S+\s*/, "")).replace(/^["']|["']$/g, "");
      if ((bare || b.info.includes(" ")) && NAME.test(rest)) put(rest, bare ? "" : b.lang, b.code);
    }
    // Secondary: ```lang:filename.ext (last wins).
    for (const b of blocks) {
      const m = /^([\w+#-]+):([\w./\-]+\.\w{1,8})$/.exec(b.info);
      if (m) put(m[2], m[1], b.code);
    }
    // Tertiary: a "file:" comment on the first line (last wins), which is not
    // part of the file.
    for (const b of blocks) {
      const nl = b.code.indexOf("\n");
      const m = /^(?:\/\/|#|<!--)\s*file:\s*([^\s*]+?)(?:\s*-->)?\s*$/.exec(nl === -1 ? b.code : b.code.slice(0, nl));
      if (m) put(m[1], b.lang, nl === -1 ? "" : b.code.slice(nl + 1));
    }
    if (!guess) {
      const page = blocks.find(b => b.lang.toLowerCase() === "html" && /^\s*<(!doctype\s+html|html[\s>])/i.test(b.code));
      if (page && !files.has("index.html")) files.set("index.html", { lang: "html", content: page.code });
      return files;
    }
    // Fallbacks for the preview: a plain html, css or js block.
    const firstOf = (...langs) => blocks.find(b => langs.includes(b.lang.toLowerCase()));
    if (!files.has("index.html")) {
      const h = firstOf("html");
      if (h) files.set("index.html", { lang: "html", content: h.code });
    }
    if (!files.has("styles.css") && !files.has("style.css")) {
      const c = firstOf("css");
      if (c) files.set("styles.css", { lang: "css", content: c.code });
    }
    const hasJs = [...files.keys()].some(k => k.endsWith(".js"));
    if (!hasJs) {
      const j = firstOf("javascript", "js");
      if (j) files.set("app.js", { lang: "javascript", content: j.code });
    }
    return files;
  }
  window.HCSwarmProjectFiles = { extractProjectFiles, guessLang };
})();
