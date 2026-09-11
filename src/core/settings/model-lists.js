// ==============================================================
// Settings — Update model lists
//
// Says what each provider answered the last time it was asked for its models
// — how many came back, or why none did — and asks them all again on request.
// The menu used to fall back to a hand-written list without a word when a
// provider could not be reached, and nothing in the app said so.
//
// Also says how many models are being kept out of the menu because their
// provider reported them gone (js/model-routes.js), and can offer them again.
//
// Reaches for window._H (refreshModelLists, modelListReport), HCModelRoutes
// and HCProviders, all of which exist by the time a person can open Settings.
// Nothing here is passed a key or reads one. Published as
// window.HCSettingsModelLists; the APIs pane calls render() when it opens.
// ==============================================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const labelOf = (provider) => (window.HCProviders && window.HCProviders.get(provider) && window.HCProviders.get(provider).label) || provider;

  /** One provider's last answer, as a line a person can read. */
  function describe(r) {
    if (r.state === 'ok') return { cls: 'ml-ok', state: `${r.count} model${r.count === 1 ? '' : 's'}`, why: r.note || '' };
    if (r.state === 'blocked') return { cls: 'ml-off', state: 'not offered', why: 'its servers refuse requests from inside apps like this one' };
    if (r.state === 'empty') return { cls: 'ml-bad', state: 'none usable', why: r.note || 'it listed no model this app can chat with' };
    if (r.state === 'error') return { cls: 'ml-bad', state: 'not updated', why: `${r.error || 'no answer'} — the menu shows the last list that arrived` };
    return null;
  }

  function render() {
    const host = $('modelListsReport');
    if (!host || !window._H || !window._H.modelListReport) return;
    const rows = window._H.modelListReport()
      .map((r) => ({ r, l: describe(r) }))
      .filter((x) => x.l)
      .sort((a, b) => labelOf(a.r.provider).localeCompare(labelOf(b.r.provider)));
    host.textContent = '';
    for (const { r, l } of rows) {
      const li = document.createElement('li');
      li.className = l.cls;
      const name = document.createElement('b');
      name.textContent = labelOf(r.provider);
      const state = document.createElement('span');
      state.className = 'ml-state';
      state.textContent = l.state;
      li.append(name, state);
      if (l.why) {
        const why = document.createElement('span');
        why.className = 'ml-why';
        why.textContent = `— ${l.why}`;
        li.append(why);
      }
      host.append(li);
    }
    const gone = window.HCModelRoutes ? window.HCModelRoutes.listRetired() : [];
    const goneBox = $('modelListsGone');
    if (goneBox) {
      goneBox.hidden = !gone.length;
      $('modelListsGoneText').textContent = `${gone.length} model${gone.length === 1 ? ' is' : 's are'} kept out of the menu because the provider said ${gone.length === 1 ? 'it is' : 'they are'} gone.`;
    }
  }

  async function update() {
    const btn = $('modelListsUpdate');
    const when = $('modelListsWhen');
    if (!btn || !window._H || !window._H.refreshModelLists) return;
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      await window._H.refreshModelLists();
      if (when) when.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) {
      if (when) when.textContent = `Could not update: ${(err && err.message) || err}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update model lists';
      render();
    }
  }

  $('modelListsUpdate')?.addEventListener('click', update);
  $('modelListsForgetGone')?.addEventListener('click', async () => {
    window.HCModelRoutes?.forgetRetired();
    await update();
  });

  window.HCSettingsModelLists = { render, update };
})();
