// ==============================================================
// The choice of how much HashCoder may do without asking
//
// One small menu beside the box a request is written in: Manual, Accept edits
// or Auto (js/code/permissions.js says what each allows, and the guard holds
// it). The menu shows what is in force and says what it means when it is
// hovered; choosing Auto says so once more in the notice bar, because it is
// the one that asks less. Manual and Accept edits are kept for next time,
// Auto is not.
//
// Loaded before the Coder mode and published as window.HCCodePermissionBar.
// Checked by scripts/checks/permissions.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Fill `select` with the modes and keep it, and `guard`, in step. False when there is nothing to mount on. */
  function mount(select, guard) {
    const P = window.HCCodePermissions;
    if (!select || !guard || !P || select.dataset.mounted === '1') return false;
    select.dataset.mounted = '1';
    for (const m of P.MODES) {
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = m.label;
      select.appendChild(option);
    }
    const helpOf = (id) => (P.MODES.find((m) => m.id === id) || {}).help || '';
    const show = () => {
      select.value = guard.mode();
      select.title = `${select.getAttribute('aria-label') || ''}: ${helpOf(select.value)}`;
    };
    select.addEventListener('change', () => {
      guard.setMode(select.value);
      show();
      if (select.value === 'auto') guard.notify(helpOf('auto'), 'info');
    });
    show();
    return true;
  }

  window.HCCodePermissionBar = { mount };
})();
