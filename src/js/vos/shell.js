// ============================================================
// vos/shell.js — the commands of a terminal that runs nothing
//
// The Virtual OS has a terminal, and the terminal executes nothing. There is no
// shell underneath it and no process anywhere: `ls` reads a list of objects in
// the browser's memory, `cat` returns a string field, `grep` runs a regular
// expression over strings. That is the whole point — a model can be handed a
// terminal without being handed a machine.
//
// It still has to behave like the thing it imitates, and the places a shell
// goes wrong are all in here: splitting a command into arguments when some of
// them are quoted, resolving a path against where you happen to be standing,
// and finding a name inside a tree of folders. All of it lived in a
// four-thousand-line file, and none of it could be handed a command and asked
// what it produced.
//
// Everything takes the file list rather than reaching for it, which is what
// makes that possible. Nothing here mutates anything.
//
// Run the checks with: npm run check:vos-shell
// ============================================================
(function () {
  "use strict";

  /**
   * A command line split into arguments, respecting quotes.
   *
   * `grep "hello world" src` is three arguments, not four. A shell that splits
   * on spaces alone turns every quoted phrase into separate arguments, and the
   * command silently does something other than what was typed.
   */
  function splitArgs(cmd) {
    const text = String(cmd || "").trim();
    if (!text) return [];
    const parts = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    return parts.map((a) => a.replace(/^["']|["']$/g, ""));
  }

  /**
   * Where a path points, from where you are standing.
   *
   * Unlike a path written into a file, `..` is FOLLOWED here — that is what
   * `cd ..` means and a terminal without it is not one. Climbing past the root
   * simply stops there: the list of parts is emptied and the answer is the
   * root, so no amount of climbing reaches anything above the project.
   */
  function resolvePath(cwd, p) {
    const here = cwd || "/";
    if (!p || p === "~") return here;
    if (p === "/") return "/";
    const base = String(p).startsWith("/") ? "" : here === "/" ? "" : here;
    const parts = `${base}/${p}`.split("/").filter(Boolean);
    const out = [];
    for (const part of parts) {
      if (part === "..") out.pop();
      else if (part !== ".") out.push(part);
    }
    return `/${out.join("/")}`;
  }

  /** Only the files that have not been thrown away. */
  const visible = (files) => (Array.isArray(files) ? files : []).filter((f) => f && !f.deletedAt);

  /**
   * The item at an absolute path, walked down one folder at a time.
   *
   * Walked rather than matched against a stored path, so a folder and a file
   * with the same name in different places cannot be confused for each other.
   */
  function findItem(files, absPath, rootId = "root") {
    if (!absPath || absPath === "/") return { id: rootId, type: "folder", name: "/" };
    const parts = String(absPath).replace(/^\//, "").split("/").filter(Boolean);
    const list = visible(files);
    let parentId = rootId;
    let item = null;
    for (const part of parts) {
      item = list.find((f) => f.parentId === parentId && f.name === part);
      if (!item) return null;
      parentId = item.id;
    }
    return item;
  }

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  /** What is in a folder, or what a file is, said the way `ls` says it. */
  function listDir(files, path, rootId = "root") {
    const list = visible(files);
    const clean = String(path || "/").replace(/^\/+/, "");
    const describe = (f) => (f.type === "folder"
      ? `${f.name}/`
      : `${f.name}  [${fmtBytes(String(f.content || "").length)}]`);
    if (!clean || clean === "/") {
      const items = list.filter((f) => f.parentId === rootId);
      if (!items.length) return "(empty root — no files yet)";
      return items.map(describe).sort().join("\n");
    }
    const folder = list.find((f) => f.path === clean && f.type === "folder");
    if (!folder) {
      const file = list.find((f) => f.path === clean && f.type === "file");
      if (file) return `${file.name}  [file · ${fmtBytes(String(file.content || "").length)}]`;
      return `Error: not found: /${clean}`;
    }
    const items = list.filter((f) => f.parentId === folder.id);
    return items.length ? items.map(describe).sort().join("\n") : "(empty folder)";
  }

  /**
   * Names matching a pattern, the way `find -name` matches them.
   *
   * A shell pattern, not a regular expression: `*` is anything and `?` is one
   * character, and everything else means itself. The characters that would be
   * special in a regular expression are escaped first, so searching for a file
   * called `app.js` does not also match `appXjs`.
   */
  function findByName(files, rootPath, pattern) {
    const list = visible(files);
    const cleanRoot = rootPath === "/" ? "" : String(rootPath || "").replace(/^\//, "");
    const scope = cleanRoot ? list.filter((f) => f.path && f.path.startsWith(cleanRoot)) : list;
    const re = new RegExp(`^${String(pattern || "*")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`);
    const matches = scope.filter((f) => re.test(f.name));
    if (!matches.length) return "(no matches)";
    return matches.map((f) => `/${f.path}${f.type === "folder" ? "/" : ""}`).join("\n");
  }

  /**
   * Lines matching a pattern, with where each one came from.
   *
   * A pattern a person typed goes straight into a regular expression, so a
   * malformed one has to be answered rather than thrown — a terminal that
   * raises an exception at a bad search is a terminal that has crashed.
   *
   * Capped, because a search matching everything in a large project would
   * produce more lines than a terminal can usefully show.
   */
  function grep(files, pattern, searchPath) {
    const list = visible(files).filter((f) => f.type === "file");
    const root = String(searchPath || "/").replace(/^\/+/, "");
    const scope = root ? list.filter((f) => f.path && f.path.startsWith(root)) : list;
    let re;
    try { re = new RegExp(pattern, "gi"); } catch { return `Error: invalid regex: ${pattern}`; }
    const results = [];
    for (const file of scope) {
      String(file.content || "").split("\n").forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) results.push(`/${file.path}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    if (!results.length) return `No matches for "${pattern}"`;
    const shown = results.slice(0, 60);
    if (results.length > 60) shown.push(`… (${results.length - 60} more matches)`);
    return shown.join("\n");
  }

  /**
   * A file's contents, whole or by line.
   *
   * A long file is cut off and SAYS it was cut off, with how much is left and
   * how to ask for the rest — a model handed a truncated file with no notice
   * will confidently reason about code that is not there.
   */
  function readFile(files, path, startLine, endLine) {
    const clean = String(path || "").replace(/^\/+/, "");
    const item = visible(files).find((f) => f.path === clean && f.type === "file");
    if (!item) return `Error: file not found: /${clean}`;
    const content = String(item.content || "");
    if (startLine == null && endLine == null) {
      if (content.length > 8000) {
        return `${content.slice(0, 8000)}\n\n[truncated — ${content.length - 8000} more bytes; use start_line/end_line to read further]`;
      }
      return content || "(empty file)";
    }
    const lines = content.split("\n");
    const from = Math.max(0, (Number(startLine) || 1) - 1);
    const to = Math.min(lines.length, Number(endLine) || lines.length);
    return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
  }

  window.HCVosShell = { splitArgs, resolvePath, findItem, listDir, findByName, grep, readFile, fmtBytes };
})();
