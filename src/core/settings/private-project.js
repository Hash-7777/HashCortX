// ==============================================================
// Settings — the open project marked as private
//
// The switch in Settings → HashCoder that marks the project open now as
// private, so every run on it counts as holding private material and asks
// every time before it sends anything out. The rule and the list of marked
// projects are in js/code/outward.js; this only shows the switch for the
// project open when the HashCoder settings are shown, and changes it.
//
// Loaded with the other settings panes, after the panel is in the page.
// Published as window.HCPrivateProjectPane. Checked by scripts/checks/code-outward.mjs.
// ==============================================================
(function () {
  'use strict';

  const box = document.getElementById('cdrSetPrivate');
  const where = document.getElementById('cdrSetPrivateWhere');
  const O = () => window.HCCodeOutward;
  const rootNow = () => window.HC?.guard?.projectRoot?.() || '';
  const nameOf = (root) => String(root).split(/[\\/]/).filter(Boolean).pop() || String(root);

  /** The switch set for the project open now; off, and not to be changed, when none is. */
  function refresh() {
    if (!box || !O()) return;
    const root = rootNow();
    box.disabled = !root;
    box.checked = !!root && O().isPrivate(root);
    if (where) where.textContent = root ? `For ${nameOf(root)}, the project open now.` : 'No project is open.';
  }

  if (box) box.addEventListener('change', () => { const root = rootNow(); if (root && O()) O().setPrivate(root, box.checked); refresh(); });
  refresh();

  window.HCPrivateProjectPane = { refresh };
})();
