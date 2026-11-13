// ==============================================================
// Settings — sub-agents
//
// The switch in Settings → HashCoder that lets a model rated strong start
// sub-agents. Off to begin with: they are not yet proven on real runs. The
// setting and the rules are in js/code/delegate.js; this only shows the
// switch and changes it.
//
// Loaded with the other settings panes, after the panel is in the page.
// Published as window.HCSubAgentsPane. Checked by scripts/checks/code-delegate.mjs.
// ==============================================================
(function () {
  'use strict';

  const box = document.getElementById('cdrSetSubagents');
  const D = () => window.HCCodeDelegate;

  /** The switch set from what is stored. */
  function refresh() { if (box && D()) box.checked = D().switchedOn(); }

  if (box) box.addEventListener('change', () => { if (D()) D().switchOn(box.checked); });
  refresh();

  window.HCSubAgentsPane = { refresh };
})();
