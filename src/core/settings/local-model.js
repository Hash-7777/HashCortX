// ==============================================================
// Settings — the Local model walkthrough
//
// The pane that shows someone how to run a model on their own machine and
// then checks, step by step, whether it worked.
//
// Every claim on it is probed rather than assumed. A step reads "done" only
// because something answered: Ollama's own /api/tags, at the address the user
// has configured. Nothing here installs, downloads or elevates. The commands
// are shown for the user to run in their own terminal, and the only button
// that reaches the network is Test, which pings the loopback port.
//
// Self-contained by design. It reaches for three things and all three are
// already global — HashCortxRuntime for the host and the timeout signal,
// HCModelNames for reading a model name out of Ollama's reply, and HC.invoke
// for opening a link in the real browser. Nothing is passed in, and the only
// name that leaves is renderLocalPane, which the settings rail calls when the
// pane is shown.
//
// Loaded before app.js in index.html.
// ==============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const localPane = $("localPane");
  const safeHost = () => window.HashCortxRuntime.getHost();
  const makeSignal = (ms) => window.HashCortxRuntime.makeSignal(ms);
  const ollamaModelName = (entry) => window.HCModelNames.ollamaModelName(entry);

  const LM_MODELS = [
    { ram: "8 GB",        model: "qwen2.5-coder:1.5b", size: "1.0 GB", licence: "Apache-2.0" },
    { ram: "8–16 GB",     model: "qwen2.5-coder:7b",   size: "4.7 GB", licence: "Apache-2.0" },
    { ram: "16–32 GB",    model: "qwen2.5-coder:14b",  size: "9.0 GB", licence: "Apache-2.0" },
    { ram: "32 GB and up", model: "qwen2.5-coder:32b", size: "20 GB",  licence: "Apache-2.0" },
  ];
  let lmPicked = LM_MODELS[1].model;

  function lmSetPill(id, text, state) {
    const pill = $(id);
    if (!pill) return;
    pill.textContent = text;
    pill.className = `lm-pill${state ? " " + state : ""}`;
    pill.closest(".lm-step")?.classList.toggle("lm-done", state === "ok");
  }

  function lmRenderTable() {
    const body = $("lmModelRows");
    if (!body) return;
    body.textContent = "";
    for (const entry of LM_MODELS) {
      const tr = document.createElement("tr");
      tr.dataset.lmModel = entry.model;
      tr.classList.toggle("lm-picked", entry.model === lmPicked);
      const cells = [
        { text: entry.ram },
        { text: entry.model, cls: "lm-model-name" },
        { text: entry.size },
        { text: entry.licence },
      ];
      for (const cell of cells) {
        const td = document.createElement("td");
        if (cell.cls) {
          const span = document.createElement("span");
          span.className = cell.cls;
          span.textContent = cell.text;
          td.appendChild(span);
        } else {
          td.textContent = cell.text;
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  // Step 1 reads differently on each platform, because installing differs on
  // each platform. Guessing wrong hands a Windows user a curl command.
  async function lmDescribePlatform() {
    const hint = $("lmOsHint"), row = $("lmInstallCmdRow"), cmd = $("lmInstallCmd");
    let os = "";
    try { os = (await window.HC?.invoke?.("shell_platform"))?.os || ""; } catch { os = ""; }
    if (!os) {
      const ua = navigator.userAgent || "";
      os = /Windows/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "macos" : /Linux/i.test(ua) ? "linux" : "";
    }
    const guidance = {
      macos: {
        hint: "On this Mac: download the app, open it, and leave it running. Or use Homebrew:",
        cmd: "brew install ollama",
      },
      windows: {
        hint: "On this PC: download OllamaSetup.exe and run it. It installs for you alone and never asks for an administrator.",
        cmd: "",
      },
      linux: {
        hint: "On Linux: run the official installer yourself, in your own terminal. It asks for your password because it adds a background service, which is exactly why HashCortX will not run it for you.",
        cmd: "curl -fsSL https://ollama.com/install.sh | sh",
      },
    }[os] || { hint: "Download the version for your system, then leave it running.", cmd: "" };

    if (hint) hint.textContent = guidance.hint;
    if (row) row.hidden = !guidance.cmd;
    if (cmd) cmd.textContent = guidance.cmd;
  }

  // One probe answers three of the four steps: whether Ollama is up, whether
  // any model is downloaded, and whether the configured address is right.
  async function lmProbe() {
    const host = safeHost();
    if ($("lmHostEcho")) $("lmHostEcho").textContent = host || "not set";
    if (!host) {
      lmSetPill("lmPill1", "Turned off", "wait");
      lmSetPill("lmPill2", "Waiting", "");
      lmSetPill("lmPill3", "No address", "wait");
      lmSetPill("lmPill4", "Waiting", "");
      if ($("lmInstalled")) $("lmInstalled").textContent = "Local models are switched off in General.";
      return;
    }
    let models = null;
    try {
      const res = await fetch(`${host}/api/tags`, { cache: "no-store", signal: makeSignal(4000) });
      if (res.ok) models = ((await res.json()).models || []).map(ollamaModelName).filter(Boolean);
    } catch { models = null; }

    if (models === null) {
      lmSetPill("lmPill1", "Not running", "wait");
      lmSetPill("lmPill2", "Waiting", "");
      lmSetPill("lmPill3", "No answer", "wait");
      lmSetPill("lmPill4", "Waiting", "");
      if ($("lmInstalled")) $("lmInstalled").textContent = "Nothing answered at that address yet.";
      return;
    }
    lmSetPill("lmPill1", "Running", "ok");
    lmSetPill("lmPill3", "Connected", "ok");
    if (models.length) {
      lmSetPill("lmPill2", `${models.length} ready`, "ok");
      lmSetPill("lmPill4", "Ready to use", "ok");
      if ($("lmInstalled")) {
        $("lmInstalled").textContent = `Already downloaded: ${models.slice(0, 6).join(", ")}${models.length > 6 ? `, and ${models.length - 6} more` : ""}.`;
      }
    } else {
      lmSetPill("lmPill2", "None yet", "wait");
      lmSetPill("lmPill4", "Waiting", "");
      if ($("lmInstalled")) $("lmInstalled").textContent = "Ollama is running, but no model is downloaded yet.";
    }
  }

  function renderLocalPane() {
    lmRenderTable();
    lmDescribePlatform();
    lmProbe();
  }

  $("lmRecheck")?.addEventListener("click", renderLocalPane);
  $("lmTestBtn")?.addEventListener("click", async () => {
    lmSetPill("lmPill3", "Testing…", "wait");
    await lmProbe();
  });

  localPane?.addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-lm-model]");
    if (row) {
      lmPicked = row.dataset.lmModel;
      if ($("lmPullCmd")) $("lmPullCmd").textContent = `ollama pull ${lmPicked}`;
      lmRenderTable();
      return;
    }
    const copy = e.target.closest("[data-lm-copy]");
    if (copy) {
      const source = $(copy.dataset.lmCopy);
      try {
        await navigator.clipboard.writeText(source?.textContent || "");
        copy.textContent = "Copied";
      } catch {
        // No clipboard permission. Select the command instead, so the user can
        // take it with their own keyboard rather than retyping it.
        if (source) {
          const range = document.createRange();
          range.selectNodeContents(source);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        copy.textContent = "Selected";
      }
      setTimeout(() => { copy.textContent = "Copy"; }, 1600);
      return;
    }
    const link = e.target.closest("[data-lm-url]");
    if (link && window.HC?.invoke) {
      HC.invoke("plugin:opener|open_url", { url: link.dataset.lmUrl }).catch(() => {});
    }
  });

  window.HCSettingsLocal = { renderLocalPane };
})();
