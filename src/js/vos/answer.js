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

    // ── Tier 1: ``\`lang path/to/file.ext  (intended format) ────────────
    const t1 = /```([A-Za-z0-9_+\-.]*)[ \t]+([^\n`\r]{3,120}?\.[A-Za-z0-9_\-]{1,12})[ \t]*\r?\n([\s\S]*?)```/g;
    let m;
    while ((m = t1.exec(src)) !== null) add(m[2], m[3]);
    if (out.length) return out;

    // ── Tier 2: path comment as FIRST line inside fence ─────────────────
    // e.g. ```html\n// apple-clone/index.html\ncontent\n```
    // or   ```html\n<!-- styles.css -->\ncontent\n```
    const t2 = /```[A-Za-z0-9_+\-. ]*\r?\n[ \t]*(?:\/\/[ \t]*|<!--[ \t]*|#[ \t]*|\/\*[ \t]*)?([^\n`\r]{3,120}?\.[A-Za-z0-9_\-]{1,12})(?:[ \t]*-->|[ \t]*\*\/)?[ \t]*\r?\n([\s\S]*?)```/g;
    while ((m = t2.exec(src)) !== null) {
      const cand = m[1].trim();
      if (/^[\w.\-/]+$/.test(cand)) add(cand, m[2]);
    }
    if (out.length) return out;

    // ── Tier 3: filename label on the line ABOVE a fence ────────────────
    // e.g. **apple-clone/index.html**\n```html\ncontent\n```
    // or   ### index.html\n```html\ncontent\n```
    const t3 = /(?:^|\r?\n)[ \t]*(?:#{1,6}[ \t]+|\*{1,2}|`)?([^\n`\r*#]{2,120}?\.[A-Za-z0-9_\-]{1,12})(?:`|\*{0,2})?[ \t]*\r?\n[ \t]*```[^\n]*\r?\n([\s\S]*?)```/gm;
    while ((m = t3.exec(src)) !== null) {
      const cand = m[1].trim();
      if (/^[\w.\-/ ]+$/.test(cand) && !/\s{2,}/.test(cand)) add(cand, m[2]);
    }
    if (out.length) return out;

    // ── Tier 4: last-resort — extract ALL fences, auto-name by language ─
    // If the model completely ignored the path format, still recover the code.
    const extMap = {
      html:"index.html", htm:"index.html", css:"styles.css", scss:"styles.scss",
      js:"app.js", javascript:"app.js", mjs:"app.mjs",
      ts:"app.ts", typescript:"app.ts", jsx:"App.jsx", tsx:"App.tsx",
      py:"main.py", python:"main.py", rb:"main.rb",
      json:"config.json", yaml:"config.yaml", yml:"config.yaml",
      sh:"run.sh", bash:"run.sh", sql:"schema.sql",
      xml:"config.xml", md:"README.md", txt:"notes.txt"
    };
    const counter = {};
    const t4 = /```([A-Za-z0-9_+\-.]*)\r?\n([\s\S]*?)```/g;
    while ((m = t4.exec(src)) !== null) {
      if (!m[2].trim()) continue;
      const lang = (m[1] || "").toLowerCase();
      const base = extMap[lang] || (lang ? `file.${lang}` : "file.txt");
      counter[base] = (counter[base] || 0) + 1;
      const name = counter[base] === 1 ? base : base.replace(/(\.[^.]+)$/, `${counter[base] - 1}$1`);
      add(name, m[2]);
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
