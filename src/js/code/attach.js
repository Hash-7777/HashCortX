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
// A picture is drawn in the conversation, in the message it was sent with, as
// a small preview that opens full size on a click. The picture sent to the
// model is not kept when the conversation is saved: the store it is saved in
// has a small quota, shared with everything else the app keeps there. The
// previews are, newest first, up to a budget, so a conversation still shows
// what was attached after the app is reopened.
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
  /** The preview drawn in the conversation: scaled to this side, and kept small. */
  const THUMB_SIDE = 360;
  const THUMB_CHARS = 60000;
  /** Characters of previews kept in a saved conversation, newest first. */
  const THUMB_STORE_BUDGET = 400000;

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

  /**
   * Messages as they are saved: the pictures left out, and said to be, and the
   * previews kept, newest first, while they fit the budget.
   */
  function forStorage(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const keep = new Set();
    let room = THUMB_STORE_BUDGET;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i] && list[i].thumbs;
      const size = Array.isArray(t) ? t.reduce((n, x) => n + String(x).length, 0) : 0;
      if (size && size <= room) { keep.add(i); room -= size; }
    }
    return list.map((m, i) => {
      // A message with no picture comes back as the very same object.
      if (!m || (!Array.isArray(m.thumbs) && !(Array.isArray(m.images) && m.images.length))) return m;
      const { thumbs, ...bare } = m;
      const kept = keep.has(i) ? { ...bare, thumbs } : bare;
      if (!Array.isArray(m.images) || !m.images.length) return kept;
      const { images, ...rest } = kept;
      return { ...rest, content: `${rest.content || ''} [${images.length === 1 ? 'A picture was' : `${images.length} pictures were`} here; pictures are not kept when a conversation is saved.]`.trim() };
    });
  }

  /**
   * Whether the model can read pictures: true or false for a cloud model, which
   * its provider decides, and null for one whose abilities are not known here.
   */
  function canSee(modelValue) {
    const H = window._H, P = window.HCProviders;
    const v = String(modelValue || '');
    if (!v.startsWith('cloud:') || !H || !H.parseCloudModel || !P || !P.readsImages) return null;
    const { provider, modelId } = H.parseCloudModel(v);
    return !!P.readsImages(provider, modelId);
  }

  const SAFE_PICTURE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const full = new Map();   // preview id -> the picture at full size, while the conversation is open
  let ids = 0;

  /**
   * The previews of a message's pictures as markup for its bubble. Each is
   * `{ thumb, full, name }`, or just the preview's data address, as a saved
   * conversation has it. Only a picture written as data is drawn: nothing
   * here is fetched.
   */
  function picturesHtml(list) {
    const items = (Array.isArray(list) ? list : []).map((p) => (typeof p === 'string' ? { thumb: p, full: p, name: '' } : p))
      .filter((p) => p && SAFE_PICTURE.test(String(p.thumb || '')));
    if (!items.length) return '';
    const buttons = items.map((p, i) => {
      const id = ++ids;
      if (p.full && SAFE_PICTURE.test(String(p.full))) full.set(id, p.full);
      const label = `Open picture ${i + 1}${p.name ? `: ${p.name}` : ''}`;
      return `<button type="button" class="cdr-user-pic" data-pic="${id}" data-name="${esc(p.name || '')}" title="${esc(label)}" aria-label="${esc(label)}"><img src="${p.thumb}" alt="" draggable="false"></button>`;
    }).join('');
    return `<div class="cdr-user-pics">${buttons}</div>`;
  }

    // ── The panel ───────────────────────────────────────────────────────────

  let files = [];
  let onChange = () => {};
  let modelOf = () => '';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** A small preview of a loaded picture, JPEG, made smaller again if it is not small enough. */
  function thumbOf(img) {
    for (const [side, quality] of [[THUMB_SIDE, 0.72], [260, 0.6], [180, 0.5]]) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= THUMB_CHARS) return url;
    }
    return '';
  }

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
        resolve({ dataUrl, base64: dataUrl.split(',')[1], thumb: thumbOf(img) });
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
    }).join('') + (left && left.length ? `<span class="cdr-attach-left">Not attached: ${esc(left.join('; '))}</span>` : '') +
      (files.some((f) => f.kind === 'picture') && canSee(modelOf()) === false ? '<span class="cdr-attach-left">The chosen model cannot read pictures. Pick one that can, such as Gemini, Anthropic or OpenAI, or the picture is not seen.</span>' : '');
  }

  /**
   * Wire the button, the hidden file picker, pasting into the box and dropping
   * onto the panel. `changed` runs when the attachments change.
   */
  function mount({ panel, input, button, picker, list, changed, model }) {
    listEl = list;
    if (typeof model === 'function') modelOf = model;
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
    const pictures = taken.filter((f) => f.kind === 'picture' && f.thumb);
    return {
      content: requestContent(task, taken),
      images: taken.filter((f) => f.kind === 'picture').map((f) => f.base64),
      names: taken.map((f) => f.name),
      // What the conversation draws: each picture's preview, and it at full size to open.
      pictures: pictures.map((f) => ({ thumb: f.thumb, full: f.dataUrl, name: f.name })),
      thumbs: pictures.map((f) => f.thumb),
    };
  }

  /** A picture, full size, over the panel; a click, or Escape, closes it. */
  function enlarge(src, name) {
    if (!SAFE_PICTURE.test(String(src || ''))) return;
    const host = document.getElementById('coder-mode-wrap') || document.body;
    host.querySelector('.cdr-lightbox')?.remove();
    const back = document.activeElement;
    const box = document.createElement('div');
    box.className = 'cdr-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', name ? `Picture: ${name}` : 'Picture');
    box.innerHTML = `<img src="${src}" alt="${esc(name || 'Attached picture')}">${name ? `<div class="cdr-lightbox-name">${esc(name)}</div>` : ''}<button type="button" class="cdr-lightbox-close" aria-label="Close the picture"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); box.remove(); if (back && back.focus) back.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    host.appendChild(box);
    box.querySelector('.cdr-lightbox-close').focus();
  }

  // A preview in a message opens its picture, wherever the message is drawn.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest && e.target.closest('.cdr-user-pic');
      if (b) enlarge(full.get(Number(b.dataset.pic)) || (b.querySelector('img') || {}).src, b.dataset.name);
    });
  }

  window.HCCodeAttach = {
    MAX_FILES, MAX_PICTURES, TEXT_BUDGET, PICTURE_SIDE,
    THUMB_SIDE, THUMB_CHARS, THUMB_STORE_BUDGET, SAFE_PICTURE,
    kindOf, requestContent, shownRequest, forStorage, canSee, picturesHtml, enlarge, mount, take, add, refresh: () => render(),
    count: () => files.length,
  };
})();
