// ==============================================================
// Files and pictures the person attaches to a HashCoder request
//
// A screenshot of what is wrong, a mockup, a spec in Markdown, a PDF: what a
// person would hand a colleague with the request. A picture goes to the model
// as a picture, the way view_image shows one; a PDF, a Markdown, text or code
// file goes as its text, packed the way chat packs attachments
// (js/chat/context.js). A file that is neither is named and not sent.
//
// Attached by the button in the box, by pasting, or by dropping onto the
// panel. Chat listens for pasting and dropping on the whole window, so while
// HashCoder is open those are handled here and not passed on.
//
// Pictures are not kept when the conversation is saved: the store it is saved
// in has a small quota, shared with everything else the app keeps there. The
// request says a picture was attached; the picture itself is not written.
//
// The first part is pure and checked by scripts/checks/code-attach.mjs; the
// panel wiring below it runs only in the app.
// Loaded before the Coder mode and published as window.HCCodeAttach.
// ==============================================================

(function () {
  'use strict';

  /** At most this many attachments to one request, and pictures among them. */
  const MAX_FILES = 8;
  const MAX_PICTURES = 4;
  /** Characters of attached text sent with one request, shared between the files. */
  const TEXT_BUDGET = 60000;
  /** A picture is scaled to fit this many pixels on its longer side before it is sent. */
  const PICTURE_SIDE = 1600;

  const TEXT_NAME = /\.(txt|md|markdown|mdx|rst|csv|tsv|log|json|jsonc|yml|yaml|toml|ini|env|xml|html?|css|scss|less|m?[jt]sx?|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|sql|vue|svelte|lua|dart)$/i;
  const PICTURE_NAME = /\.(png|jpe?g|gif|webp|bmp)$/i;

  /** What an attachment is: 'picture', 'pdf', 'text', or 'other' for one that is not sent. */
  function kindOf(name, type) {
    const n = String(name || '');
    const t = String(type || '').toLowerCase();
    if (t.startsWith('image/') && t !== 'image/svg+xml') return 'picture';
    if (!t && PICTURE_NAME.test(n)) return 'picture';
    if (t === 'application/pdf' || /\.pdf$/i.test(n)) return 'pdf';
    if (t.startsWith('text/') || t === 'application/json' || t === 'image/svg+xml' || TEXT_NAME.test(n) || /\.svg$/i.test(n)) return 'text';
    return 'other';
  }

  // How the request marks where the person's words end and the attachments
  // begin, so the conversation can show the words and name the files.
  const MARK = '\n\n[Attached by the person: ';

  /**
   * The request as the model is sent it: the person's words, the names of
   * what was attached, and the text of each file that has text.
   */
  function requestContent(task, files) {
    const list = (Array.isArray(files) ? files : []).filter(Boolean);
    if (!list.length) return String(task || '');
    const names = list.map((f) => f.name + (f.kind === 'other' ? ' (not sent: not a picture, PDF or text file)' : '')).join(', ');
    const texts = list.filter((f) => f.kind === 'pdf' || f.kind === 'text');
    const pack = window.HCChatContext && window.HCChatContext.buildAttachedFileContext;
    const body = texts.length && pack ? pack(texts, TEXT_BUDGET) : '';
    const seen = list.some((f) => f.kind === 'picture') ? ' The pictures are with this message.' : '';
    return `${String(task || '')}${MARK}${names}.${seen}]${body ? '\n\n' + body : ''}`;
  }

  /** What the conversation shows of a request: the words, and the names of what came with them. */
  function shownRequest(content) {
    const text = String(content || '');
    const at = text.indexOf(MARK);
    if (at < 0) return text;
    const end = text.indexOf(']', at + MARK.length);
    const names = text.slice(at + MARK.length, end < 0 ? undefined : end).replace(/\. The pictures are with this message\.$/, '').replace(/\.$/, '');
    return `${text.slice(0, at)}\n\nAttached: ${names}`;
  }

  /** Messages as they are saved: pictures left out, and said to be. */
  function forStorage(messages) {
    return (Array.isArray(messages) ? messages : []).map((m) => {
      if (!m || !Array.isArray(m.images) || !m.images.length) return m;
      const { images, ...rest } = m;
      return { ...rest, content: `${rest.content || ''} [${images.length === 1 ? 'A picture was' : `${images.length} pictures were`} here; pictures are not kept when a conversation is saved.]`.trim() };
    });
  }

  // ── The panel ───────────────────────────────────────────────────────────

  let files = [];
  let onChange = () => {};

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** A picture file as base64 JPEG, scaled to fit PICTURE_SIDE. */
  function pictureOf(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, PICTURE_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';   // a transparent screenshot reads on white, as it was drawn
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('the picture could not be read')); };
      img.src = url;
    });
  }

  /** Read and add files, within the limits; says in `note` what was left out. */
  async function add(list) {
    const left = [];
    for (const file of Array.from(list || [])) {
      const kind = kindOf(file.name, file.type);
      const name = file.name || (kind === 'picture' ? 'pasted picture' : 'file');
      if (files.length >= MAX_FILES) { left.push(`${name}: at most ${MAX_FILES} files`); continue; }
      if (kind === 'picture' && files.filter((f) => f.kind === 'picture').length >= MAX_PICTURES) { left.push(`${name}: at most ${MAX_PICTURES} pictures`); continue; }
      try {
        if (kind === 'picture') files.push({ name, kind, ...(await pictureOf(file)) });
        else if (kind === 'pdf') {
          const read = await window.HCPdfText.extractFromData(await file.arrayBuffer(), name);
          files.push({ name, kind, pages: read.pages, text: read.text || `[${name} holds no text that could be read.]` });
        } else if (kind === 'text') files.push({ name, kind, text: await file.text() });
        else files.push({ name, kind });
      } catch (e) {
        left.push(`${name}: ${e && e.message ? e.message : 'could not be read'}`);
      }
    }
    render(left);
    onChange();
  }

  const ICONS = {
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    text: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    other: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  };

  let listEl = null;
  function render(left) {
    if (!listEl) return;
    listEl.hidden = !files.length && !(left && left.length);
    listEl.innerHTML = files.map((f, i) => {
      const mark = f.kind === 'picture'
        ? `<img class="cdr-attach-thumb" src="${f.dataUrl}" alt="" draggable="false">`
        : `<svg class="cdr-attach-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[f.kind] || ICONS.other}</svg>`;
      const what = f.kind === 'other' ? 'not sent' : f.kind === 'picture' ? 'picture' : f.kind === 'pdf' ? `PDF${f.pages ? `, ${f.pages} page${f.pages === 1 ? '' : 's'}` : ''}` : 'text';
      return `<span class="cdr-attach-chip${f.kind === 'other' ? ' off' : ''}" title="${esc(f.name)}">${mark}<span class="cdr-attach-name">${esc(f.name)}</span>` +
        `<span class="cdr-attach-kind">${what}</span>` +
        `<button type="button" class="cdr-attach-remove" data-at="${i}" title="Remove ${esc(f.name)}" aria-label="Remove ${esc(f.name)}">` +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></span>';
    }).join('') + (left && left.length ? `<span class="cdr-attach-left">Not attached: ${esc(left.join('; '))}</span>` : '');
  }

  /**
   * Wire the button, the hidden file picker, pasting into the box and dropping
   * onto the panel. `changed` runs when the attachments change.
   */
  function mount({ panel, input, button, picker, list, changed }) {
    listEl = list;
    onChange = typeof changed === 'function' ? changed : () => {};
    if (!panel || panel.dataset.attachWired) return;
    panel.dataset.attachWired = '1';
    button && button.addEventListener('click', () => picker && picker.click());
    picker && picker.addEventListener('change', () => { add(picker.files).finally(() => { picker.value = ''; }); });
    list && list.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.cdr-attach-remove');
      if (!btn) return;
      files.splice(Number(btn.dataset.at), 1);
      render();
      onChange();
    });
    // Chat listens on the window; stop these here so a screenshot pasted or a
    // file dropped into HashCoder does not land in chat's next message.
    input && input.addEventListener('paste', (e) => {
      const pics = Array.from((e.clipboardData && e.clipboardData.items) || [])
        .filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      e.stopPropagation();
      if (!pics.length) return;   // plain text pastes as text
      e.preventDefault();
      add(pics);
    });
    panel.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); panel.classList.add('cdr-dropping'); });
    panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('cdr-dropping'); });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.remove('cdr-dropping');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) add(e.dataTransfer.files);
    });
  }

  /**
   * Hand over what is attached for a request, and clear it: the request's
   * content built round `task`, the pictures, and their names.
   */
  function take(task) {
    const taken = files;
    files = [];
    render();
    onChange();
    return {
      content: requestContent(task, taken),
      images: taken.filter((f) => f.kind === 'picture').map((f) => f.base64),
      names: taken.map((f) => f.name),
    };
  }

  window.HCCodeAttach = {
    MAX_FILES, MAX_PICTURES, TEXT_BUDGET, PICTURE_SIDE,
    kindOf, requestContent, shownRequest, forStorage, mount, take, add,
    count: () => files.length,
  };
})();
