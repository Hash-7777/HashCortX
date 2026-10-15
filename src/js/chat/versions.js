// ==============================================================
// Versions of a message in a chat
//
// Editing a message, or regenerating an answer, used to copy the chat up to
// that point into a new chat and carry on there: what followed it was left
// behind in the old one, out of sight, and the conversation seemed lost.
//
// Now the chat stays one chat. The edited message, or the new answer, is
// another version of the message it replaces, and each version keeps what
// followed it. "‹ 2/3 ›" under the message moves between them, bringing back
// the conversation that went with each one. Nothing is thrown away.
//
// A message with versions holds them as `versions: [{ message, tail }]`, the
// message as it was and the messages that followed it, and `version`, the
// one shown. The one shown is the chat itself: its message is the message,
// its tail the rest of the chat, so what is stored for it is kept empty and
// filled again when another version is shown. A version's own messages may
// have versions of their own.
//
// Pure: nothing here draws or saves. Published as window.HCVersions.
// Checked by scripts/checks/chat-versions.mjs.
// ==============================================================

(function () {
  'use strict';

  /** A message without its versions: what a version holds of it. */
  function strip(m) {
    if (!m || typeof m !== 'object') return m;
    const { versions, version, ...rest } = m;
    return rest;
  }

  /**
   * The versions of the message at `idx`, with the one shown taken as it is
   * now, followed by the rest of the chat: `{ list, at }`.
   */
  function snapshot(messages, idx) {
    const list = Array.isArray(messages) ? messages : [];
    const cur = list[idx];
    if (!cur) return { list: [], at: 0 };
    const kept = Array.isArray(cur.versions) && cur.versions.length ? cur.versions.map((v) => ({ ...v })) : [{ message: strip(cur), tail: [] }];
    const at = Array.isArray(cur.versions) && cur.versions.length ? clampAt(cur.version, kept.length) : 0;
    kept[at] = { message: strip(cur), tail: list.slice(idx + 1) };
    return { list: kept, at };
  }

  const clampAt = (v, n) => Math.max(0, Math.min(n - 1, Number.isInteger(v) ? v : n - 1));

  /**
   * The chat with what is now at `idx` made the newest version of what was
   * there (`snap`, from snapshot), the others kept. When nothing came to take
   * its place (the answer failed before it began), what was there is shown
   * again, as it was.
   */
  function adopt(messages, idx, snap) {
    const list = Array.isArray(messages) ? messages.slice() : [];
    if (!snap || !snap.list.length) return list;
    const now = list[idx];
    if (!now) {
      const back = snap.list[snap.at];
      const restored = snap.list.length > 1 ? { ...back.message, versions: snap.list.map((v, i) => (i === snap.at ? { message: v.message, tail: [] } : v)), version: snap.at } : back.message;
      return [...list.slice(0, idx), restored, ...back.tail];
    }
    const all = [...snap.list, { message: strip(now), tail: [] }];
    list[idx] = { ...strip(now), versions: all, version: all.length - 1 };
    return list;
  }

  /** The chat with the message at `idx` edited to `next`, as its newest version: the edit and nothing after it. */
  function branch(messages, idx, next) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list[idx] || !next) return list.slice();
    return adopt([...list.slice(0, idx), next], idx, snapshot(list, idx));
  }

  /** The chat with version `v` of the message at `idx` shown, and the conversation that went with it. */
  function show(messages, idx, v) {
    const list = Array.isArray(messages) ? messages : [];
    const cur = list[idx];
    if (!cur || !Array.isArray(cur.versions) || !cur.versions[v] || v === cur.version) return list.slice();
    const snap = snapshot(list, idx);
    const pick = snap.list[v];
    const versions = snap.list.map((x, i) => (i === v ? { message: x.message, tail: [] } : x));
    return [...list.slice(0, idx), { ...pick.message, versions, version: v }, ...(pick.tail || [])];
  }

  /** Which version a message shows, and of how many: `{ at, count }` counted from 1, or null for one with no other. */
  function of(m) {
    const n = m && Array.isArray(m.versions) ? m.versions.length : 0;
    return n > 1 ? { at: clampAt(m.version, n) + 1, count: n } : null;
  }

  /** A message's versions as they are saved, each message cleaned by `clean`, the one shown holding nothing it would repeat. */
  function forStorage(m, clean) {
    if (!m || !Array.isArray(m.versions) || m.versions.length < 2) return undefined;
    const at = clampAt(m.version, m.versions.length);
    return m.versions.map((v, i) => (i === at ? { message: clean(strip(m)), tail: [] } : { message: clean(v.message), tail: (v.tail || []).map(clean) }));
  }

  const CHEVRON = (points) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"/></svg>`;

  /** "‹ 2/3 ›" under a message with versions, or '' for one without: its buttons say "ver-prev" and "ver-next". */
  function switchHtml(m) {
    const v = of(m);
    if (!v) return '';
    return `<span class="msg-versions" role="group" aria-label="Version ${v.at} of ${v.count}">` +
      `<button class="msg-action msg-ver" data-action="ver-prev" title="Previous version" aria-label="Previous version"${v.at === 1 ? ' disabled' : ''}>${CHEVRON('15 18 9 12 15 6')}</button>` +
      `<span class="msg-ver-n">${v.at}/${v.count}</span>` +
      `<button class="msg-action msg-ver" data-action="ver-next" title="Next version" aria-label="Next version"${v.at === v.count ? ' disabled' : ''}>${CHEVRON('9 18 15 12 9 6')}</button></span>`;
  }

  window.HCVersions = { strip, snapshot, adopt, branch, show, of, forStorage, switchHtml };
})();
