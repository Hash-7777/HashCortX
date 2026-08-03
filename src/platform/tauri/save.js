// ==============================================================
// platform/tauri/save.js — putting a file the user asked for on their disk
//
// Everything this app can produce — a chat export, a Coder diff, Forge's GLB,
// ERP's CSV, Virtual OS's zip, and every .docx/.xlsx/.pdf `execute_python`
// builds — was handed to the webview as `a.download = name; a.click()`.
//
// That never wrote a file, in any build, on any platform. A download is a
// capability the embedder has to opt into: wry only installs a download
// delegate when `download_started_handler` is set, and tauri-runtime-wry only
// sets it when the app called `WebviewWindowBuilder::on_download`. HashCortx
// never has. With no handler, wry's navigation delegate answers a download
// navigation with `WKNavigationActionPolicy::Cancel`
// (wry-0.55.1/src/wkwebview/navigation.rs) — the click is cancelled outright.
// Nothing is written, and a cancelled navigation raises no error, so every
// export button in the app looked like it worked and did nothing.
//
// Registering `on_download` would have been the smaller change and the wrong
// one: it hands the webview a general ability to write files from a
// navigation. A save is a deliberate act, so it goes through a dialog the user
// answers and a command that checks the denylist.
//
// A save now goes through the native save dialog and a real write. The user
// names the file and picks the folder, which is what makes writing outside the
// project legitimate here — and the Rust side still checks the denylist,
// because a dialog is consent to save a file, not consent to overwrite a
// private key.
//
// WHY THIS IS NOT IN hashcoder.js
// -------------------------------
// Same reason as undo.js: everything in `HC.code` is a tool a model can call,
// and `scripts/checks/native-surface.mjs` counts guard requests against native
// calls there to keep it that way. Saving is not a tool. No model can reach
// it; every call starts with the user clicking Export and then naming a file.
//
// Loaded after platform/index.js and before the modes, published as HC.save.
// ==============================================================

(function () {
  'use strict';

  if (!window.HC) { window.HC = {}; }

  const encoder = new TextEncoder();

  /**
   * Everything the app exports, reduced to bytes.
   *
   * Recognised by brand rather than by `instanceof`. A Blob handed back by
   * Pyodide, jsPDF or a three.js exporter does not always come from the realm
   * this file was loaded in, and an `instanceof` that answers false there
   * would reject a perfectly good file with a message about not knowing how
   * to save it.
   */
  async function toBytes(data) {
    if (data == null) return new Uint8Array(0);
    if (typeof data === 'string') return encoder.encode(data);
    // Covers Uint8Array and every other typed array, across realms. The
    // offset and length are carried over, so a view onto part of a larger
    // buffer writes its own slice rather than the whole backing store.
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
      return new Uint8Array(data);
    }
    if (typeof data.arrayBuffer === 'function') {
      return new Uint8Array(await data.arrayBuffer());
    }
    throw new Error('That is not something this app knows how to save.');
  }

  /**
   * Base64 for the IPC hop.
   *
   * Chunked because `String.fromCharCode(...bytes)` spreads every byte into an
   * argument list, and a few hundred kilobytes of it overflows the call stack —
   * which would have made this work in testing and fail on the first real
   * export.
   */
  function toBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /** The pre-Tauri path, kept so the app still exports when served in a browser. */
  function browserDownload(filename, bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { saved: true, path: filename, bytes: bytes.length };
  }

  HC.save = {
    /**
     * Ask where to put `filename`, then write `data` there.
     *
     * Resolves `{ saved: false, reason: 'cancelled' }` when the user closes the
     * dialog — a cancel is not a failure and must not raise an error dialog at
     * the caller. Anything else that goes wrong throws, because a save that did
     * not happen has to be visible; that is the whole defect this replaces.
     */
    async file(filename, data, opts) {
      const name = String(filename || 'export').trim() || 'export';
      const mime = (opts && opts.mime) || window.HCExport?.mimeFor?.(name) || 'application/octet-stream';
      const bytes = await toBytes(data);

      if (!HC.isTauri) return browserDownload(name, bytes, mime);

      const options = { defaultPath: name, title: (opts && opts.title) || 'Save' };
      const filter = window.HCExport?.dialogFilter?.(name);
      if (filter) options.filters = [filter];

      const path = await HC.invoke('plugin:dialog|save', { options });
      if (typeof path !== 'string' || !path) return { saved: false, reason: 'cancelled' };

      const written = await HC.invoke('export_write_file', { path, base64: toBase64(bytes) });
      return { saved: true, path, bytes: Number(written) || bytes.length };
    },

    /**
     * Save without asking where — for the several files one run can produce, so
     * the user is not made to answer a dialog per file.
     *
     * Still not silent: the folder is chosen once by the caller, and there is
     * no path here that writes anywhere the user has not already pointed at.
     */
    async fileInto(dir, filename, data, opts) {
      if (!HC.isTauri || !dir) return HC.save.file(filename, data, opts);
      const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
      const path = dir.replace(/[/\\]+$/, '') + sep + String(filename || 'export');
      const bytes = await toBytes(data);
      const written = await HC.invoke('export_write_file', { path, base64: toBase64(bytes) });
      return { saved: true, path, bytes: Number(written) || bytes.length };
    },

    /** Ask for a folder — used when a run produces more than one file. */
    async folder(title) {
      if (!HC.isTauri) return null;
      const dir = await HC.invoke('plugin:dialog|open', {
        options: { directory: true, multiple: false, title: title || 'Choose a folder' },
      });
      return typeof dir === 'string' && dir ? dir : null;
    },
  };
})();
