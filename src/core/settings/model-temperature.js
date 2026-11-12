// ==============================================================
// Settings — each model's recommended temperature
//
// The switch in Settings → HashCoder that sends a model whose maker
// recommends a temperature that temperature in place of the slider's. The
// setting and the families' values are in js/model-profile.js; this only
// shows the switch and changes it.
//
// Loaded with the other settings panes, after the panel is in the page.
// Published as window.HCModelTemperaturePane. Checked by scripts/checks/model-profile.mjs.
// ==============================================================
(function () {
  'use strict';

  const box = document.getElementById('cdrSetFamilyTemp');
  const M = () => window.HCModelProfile;

  /** The switch set from what is stored. */
  function refresh() { if (box && M()) box.checked = M().familyTemperature(); }

  if (box) box.addEventListener('change', () => { if (M()) M().setFamilyTemperature(box.checked); });
  refresh();

  window.HCModelTemperaturePane = { refresh };
})();
