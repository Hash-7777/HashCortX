// ============================================================
// chat/ran-code.js — what the code an agent ran actually printed
//
// An agent that runs Python is asked to answer from what the code printed. A
// small model often does not: it ran 17! correctly and then wrote a different
// number in its answer, and nothing on screen showed the real one, so the
// answer could not be checked. What each run printed is now kept on the reply
// and shown under it, folded, as the app received it.
//
// Pure apart from building one element. Published as window.HCRanCode.
// Run the checks with: npm run check:ran-code
// ============================================================
(function () {
  "use strict";

  const MAX_CHARS = 2000;
  const MAX_RUNS = 4;

  /** What one execute_python result printed, as text, or "" for nothing to show. */
  function outputOf(result) {
    let r = result;
    if (typeof r === "string") { try { r = JSON.parse(r); } catch { return ""; } }
    if (!r || typeof r !== "object") return "";
    const parts = [];
    const out = String(r.stdout || "").trim();
    const err = String(r.stderr || "").trim();
    if (out) parts.push(out);
    if (r.error) parts.push(`Error: ${String(r.error).trim()}`);
    else if (err) parts.push(err);
    if (Array.isArray(r.files) && r.files.length) {
      parts.push(`Files: ${r.files.map((f) => `${f.filename}${f.saved === false ? " (not kept)" : ""}`).join(", ")}`);
    }
    const text = parts.join("\n").trim();
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
  }

  /** The runs worth keeping on a reply: those that printed something, most recent last. */
  function keep(outputs) {
    return (Array.isArray(outputs) ? outputs : []).map((o) => String(o || "").trim()).filter(Boolean).slice(-MAX_RUNS);
  }

  /** A folded block under a reply showing what the code printed. Built as text, never markup. */
  function element(outputs, doc = document) {
    const runs = keep(outputs);
    if (!runs.length) return null;
    const box = doc.createElement("details");
    box.className = "ran-code";
    const title = doc.createElement("summary");
    title.textContent = runs.length === 1 ? "What the code printed" : `What the code printed (${runs.length} runs)`;
    box.append(title);
    for (const text of runs) {
      const pre = doc.createElement("pre");
      pre.textContent = text;
      box.append(pre);
    }
    return box;
  }

  window.HCRanCode = { outputOf, keep, element, MAX_CHARS };
})();
