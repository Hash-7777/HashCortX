// ==============================================================
// Settings — key-shaped text kept from cloud models
//
// The switch in Settings → HashCoder that says whether what looks like a key
// in a tool result is kept from a model off this computer. The rule and the
// setting are in js/secret-shapes.js; this only shows it and changes it.
//
// Loaded with the other settings panes, after the panel is in the page.
// Published as window.HCCloudKeysPane. Checked by scripts/checks/secret-shapes.mjs.
// ==============================================================
(function () {
  'use strict';

  const box = document.getElementById('cdrSetKeepKeys');
  const K = () => window.HCSecretShapes;

  /** The switch set from what is stored. */
  function refresh() { if (box && K()) box.checked = K().keepFromCloud(); }

  if (box) box.addEventListener('change', () => { if (K()) K().setKeepFromCloud(box.checked); });
  refresh();

  window.HCCloudKeysPane = { refresh };
})();
