// ============================================================
// vos/answer.js — a model's answer, turned into files
//
// The Virtual OS asks a model for a project and gets back an explanation with
// some code in it. Whether anything usable comes out of that is decided here,
// and it was decided inside a four-thousand-line file where nothing could ask
// it anything.
//
// A model asked to label its files with paths does so most of the time. The
// rest of the time it puts the path in a comment on the first line, or in bold
// above the fence, or writes the code and never says where it goes. Refusing
// those is throwing away a project that was written correctly and labelled
// carelessly, so four attempts are made in order of how much each assumes, and
// the first that finds anything wins.
//
// The last of them names files by their language — a fence marked css becomes
// styles.css. That is a guess, and it is the difference between a person
// getting their code in the wrong filenames and getting nothing at all.
//
// Pure: text in, files out. No DOM, no storage, no network.
//
// Run the checks with: npm run check:vos-answer
// ============================================================
(function () {
  "use strict";

  const TREE = () => window.HCVosTree;
  const normalizeVirtualPath = (p) => TREE().normalizePath(p);
  const safeName = (n) => TREE().safeName(n);

  function extractFiles(text) {
    const src = text || "";
    const out  = [];
    const seen = new Set();

    function add(rawPath, content) {
      const p = normalizeVirtualPath(String(rawPath || "").trim());
      // must look like a real file path (has a dot for extension, no newlines)
      if (!p || !p.includes(".") || /[\n\r]/.test(p) || seen.has(p)) return;
      seen.add(p);
      out.push({ path: p, content: String(content || "").replace(/^\n+|\n+$/g, "") });
    }

    // Blocks are found by src/js/fences.js, which reads a fence the way the
    // chat draws it. The tiers below used patterns of their own that missed a
    // block in C#, a tilde fence, and a fence whose language was followed by
    // a title — so a project written correctly came back short of files.
    const pieces = window.HCFences.splitFences(src);
    const blocks = [];
    pieces.forEach((piece, i) => {
      if (piece.type !== "code") return;
      const before = pieces[i - 1];
      // The line directly above the fence, if there is one; a blank line
      // between a label and its fence means the label is not its name.
      const tail = before && before.type === "text" ? before.text.replace(/\r?\n$/, "") : "";
      const above = tail.slice(tail.lastIndexOf("\n") + 1).replace(/\r$/, "");
      blocks.push({ lang: piece.lang, rawInfo: piece.rawInfo, code: piece.code, above });
    });
    const PATH = /^([^\n`\r]{3,120}?\.[A-Za-z0-9_\-]{1,12})[ \t]*$/;

    // ── Tiers 1–3: a name the model gave the block ──────────────────────
    // Each block is named by the most specific label it carries, so no block
    // is read twice under two names. These used to be tried across the whole
    // answer in turn, the first to find anything winning — which meant that
    // once some files were named on their fence line, a file named in a
    // comment or a heading was dropped without a word.
    const FIRST = /^[ \t]*(?:\/\/[ \t]*|<!--[ \t]*|#[ \t]*|\/\*[ \t]*)?(?:file:[ \t]*)?([^\n`\r]{3,120}?\.[A-Za-z0-9_\-]{1,12})(?:[ \t]*-->|[ \t]*\*\/)?[ \t]*$/i;
    const LABEL = /^[ \t]*(?:#{1,6}[ \t]+|\*{1,2}|`)?([^\n`\r*#]{2,120}?\.[A-Za-z0-9_\-]{1,12})(?:`|\*{0,2})?[ \t]*$/;
    function labelled(b) {
      // 1: ```lang path/to/file.ext, ```lang:path, or a path where the
      //    language would be.
      const info = b.rawInfo || "";
      const joined = /^[\w+#.-]+:(\S+)$/.exec(info.trim());
      const rest = joined ? joined[1] : /^\s/.test(info) ? info.trim() : info.trim().replace(/^\S+\s*/, "");
      const onFence = PATH.exec(rest);
      if (onFence) return { path: onFence[1], content: b.code };
      // 2: a path in a comment on the first line, which is then not part of
      //    the file — // path, <!-- path -->, # path, /* file: path */.
      const nl = b.code.indexOf("\n");
      const first = FIRST.exec(nl === -1 ? b.code : b.code.slice(0, nl));
      if (first && /^[\w.\-/]+$/.test(first[1].trim())) {
        return { path: first[1].trim(), content: nl === -1 ? "" : b.code.slice(nl + 1) };
      }
      // 3: a label on the line directly above the fence — **path**, ### path.
      const above = LABEL.exec(b.above);
      if (above) {
        const cand = above[1].trim();
        if (/^[\w.\-/ ]+$/.test(cand) && !/\s{2,}/.test(cand)) return { path: cand, content: b.code };
      }
      return null;
    }
    for (const b of blocks) {
      const f = labelled(b);
      if (f) add(f.path, f.content);
    }
    // Once the model has named its files, a block it did not name is an
    // example in the explanation, not a file.
    if (out.length) return out;

    // ── Tier 4: last-resort — every block, named by its language ─────────
    // If the model completely ignored the path format, still recover the code.
    const extMap = {
      html:"index.html", htm:"index.html", css:"styles.css", scss:"styles.scss",
      js:"app.js", javascript:"app.js", mjs:"app.mjs",
      ts:"app.ts", typescript:"app.ts", jsx:"App.jsx", tsx:"App.tsx",
      py:"main.py", python:"main.py", rb:"main.rb",
      "c#":"Program.cs", cs:"Program.cs", csharp:"Program.cs",
      "c++":"main.cpp", cpp:"main.cpp", c:"main.c", go:"main.go", rust:"main.rs", rs:"main.rs",
      java:"Main.java", swift:"main.swift", php:"index.php",
      json:"config.json", yaml:"config.yaml", yml:"config.yaml",
      sh:"run.sh", bash:"run.sh", sql:"schema.sql",
      xml:"config.xml", md:"README.md", txt:"notes.txt"
    };
    const counter = {};
    for (const b of blocks) {
      if (!b.code.trim()) continue;
      const lang = (b.lang || "").toLowerCase();
      // A language that is not a plain word would put its punctuation in the
      // file name; those that are not known get a plain text name instead.
      const base = extMap[lang] || (/^[a-z0-9]{1,12}$/.test(lang) ? `file.${lang}` : "file.txt");
      counter[base] = (counter[base] || 0) + 1;
      const name = counter[base] === 1 ? base : base.replace(/(\.[^.]+)$/, `${counter[base] - 1}$1`);
      add(name, b.code);
    }

    return out;
  }

  function inferProjectName(prompt) {
    const clean = String(prompt).split(/[.!?\n]/)[0]
      // strip leading action verbs (including "code")
      .replace(/^(build|make|create|generate|add|edit|update|fix|change|code|write|design|develop|give me|show me)\s+/i, "")
      // strip filler adjectives
      .replace(/\b(a|an|the|full|fully|simple|basic|complete|working|new|good|great|modern|nice|clean|beautiful|professional|responsive)\b\s*/gi, "")
      // strip generic tech suffixes
      .replace(/\s*(html\s*)?(website|web\s*app|webpage|web\s*page|site|page|app|application)\s*$/i, "")
      // strip "selling/for/with/using" connectors at end
      .replace(/\s+(selling|using|with|for|in|on|by)\s*$/i, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)           // max 3 meaningful words
      .join("-")
      .toLowerCase();
    return safeName(clean || "project");
  }

  function kindLabel(item) {
    if (!item) return "";
    if (item.type === "folder") return "Folder";
    const ext = item.name.split(".").pop().toLowerCase();
    const labels = {
      html: "HTML document",
      htm: "HTML document",
      css: "CSS stylesheet",
      js: "JavaScript file",
      mjs: "JavaScript file",
      json: "JSON document",
      md: "Markdown document",
      svg: "SVG image",
      png: "PNG image",
      jpg: "JPEG image",
      jpeg: "JPEG image",
      webp: "WebP image",
    };
    return labels[ext] || "Document";
  }

  window.HCVosAnswer = { extractFiles, inferProjectName, kindLabel };
})();
