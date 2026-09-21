// ==============================================================
// Real photographs for a website the team builds
//
// A site's images had nowhere real to come from. Agents were told to use
// remote addresses, so they wrote addresses: example.com, services that shut
// down years ago, or file names nobody wrote. Every product in a shop was a
// broken picture, and the site looked unfinished however good its code was.
//
// So the app finds them. Before the team starts, a few short searches for the
// site's subject — "diamond engagement ring", made by the model that plans the
// run, never the request itself — go to Openverse (openverse.org), a free
// search of openly licensed images that needs no key. What comes back is a
// list of real photographs with their authors and licences, handed to every
// agent as the only photographs to use, with the credit each one's licence
// asks for.
//
// Only licences that allow use in a business's site, unchanged or cropped:
// public domain, CC0, CC BY and CC BY-SA. "No derivatives" is left out
// because a site crops a photograph to fit its layout, and "non-commercial"
// because a shop is commerce.
//
// It is the one place the Agent Swarm reaches a service that is not the model
// provider a person chose, so it is a setting: "Find real photos for
// websites", on unless turned off, and off whenever "Local only" is on. With it
// off, or when the search finds nothing, agents are told to draw imagery with
// CSS and inline SVG and never to write an image address at all.
//
// The fetch is handed in, so the checks run the real logic with no network.
// Loaded before the Agent Swarm and published as window.HCSwarmPhotos.
// Checked by scripts/checks/swarm-photos.mjs.
// ==============================================================

(function () {
  'use strict';

  const ENDPOINT = 'https://api.openverse.org/v1/images/';
  const PREF_KEY = 'hc_swarm_photos';
  const LICENCES = 'cc0,pdm,by,by-sa';
  const MAX_SEARCHES = 3;
  const PER_SEARCH = 8;
  const MAX_PHOTOS = 10;
  const SEARCH_MS = 12000;

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * The searches a plan asked for, as few words each as will do. Letters,
   * digits, spaces and hyphens only: a search is a subject, not a sentence,
   * and nothing else from the request goes with it.
   */
  function searchesOf(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const q = clean(String(raw || '').replace(/[^\p{L}\p{N}\s-]/gu, ' '), 40).toLowerCase();
      if (q.length < 3 || q.split(' ').length > 5 || out.includes(q)) continue;
      out.push(q);
      if (out.length === MAX_SEARCHES) break;
    }
    return out;
  }

  const PRINTED = /\b(?:catalog(?:ue)?s?|advert(?:isement)?s?|brochures?|posters?|magazines?|newspapers?|leaflets?|flyers?|scans?|page \d+)\b/i;
  const LICENCE_NAMES = { cc0: 'CC0', pdm: 'Public Domain', by: 'CC BY', 'by-sa': 'CC BY-SA' };

  /** One search result as a photograph the team can use, or null when it cannot be used. */
  function photoOf(r) {
    if (!r || typeof r !== 'object') return null;
    const url = String(r.url || '');
    if (!/^https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?$/i.test(url)) return null;
    const licence = String(r.license || '').toLowerCase();
    if (!LICENCE_NAMES[licence]) return null;
    const width = Number(r.width) || 0;
    const height = Number(r.height) || 0;
    if (width && width < 640) return null;
    // A scan of a printed page is filed as a photograph too, and it is not a
    // picture of the subject: a catalogue page is not a ring.
    if (PRINTED.test(String(r.title || ''))) return null;
    const page = /^https:\/\//i.test(String(r.foreign_landing_url || '')) ? String(r.foreign_landing_url) : '';
    return {
      url,
      title: clean(r.title, 80) || 'Untitled',
      creator: clean(r.creator, 60) || 'unknown',
      licence: `${LICENCE_NAMES[licence]}${licence === 'cc0' || licence === 'pdm' ? '' : ` ${clean(r.license_version, 6)}`}`.trim(),
      page,
      shape: width && height ? (width >= height * 1.15 ? 'landscape' : height >= width * 1.15 ? 'portrait' : 'square') : 'unknown',
    };
  }

  /**
   * The photographs for a set of searches: each search asked once, results
   * that cannot be used dropped, one photograph per title so a series of
   * near-identical shots does not fill the list.
   */
  async function find({ searches, fetch: fetchFn, signal, timeoutMs = SEARCH_MS } = {}) {
    const qs = searchesOf(searches);
    if (!qs.length || typeof fetchFn !== 'function') return { photos: [], searched: [] };
    const photos = [];
    const titles = new Set();
    const urls = new Set();
    const searched = [];
    for (const q of qs) {
      if (signal && signal.aborted) break;
      const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&license=${LICENCES}&mature=false&page_size=${PER_SEARCH}`;
      let data = null;
      const own = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const stop = () => own && own.abort();
      if (signal) signal.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(stop, timeoutMs);
      try {
        const res = await fetchFn(url, { signal: own ? own.signal : undefined, headers: { Accept: 'application/json' } });
        if (res && res.ok) data = await res.json();
      } catch { data = null; }
      finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
      searched.push(q);
      for (const r of (data && Array.isArray(data.results) ? data.results : [])) {
        const p = photoOf(r);
        if (!p || urls.has(p.url) || titles.has(p.title.toLowerCase())) continue;
        urls.add(p.url);
        titles.add(p.title.toLowerCase());
        photos.push({ ...p, search: q });
        if (photos.length === MAX_PHOTOS) return { photos, searched };
      }
    }
    return { photos, searched };
  }

  /** The credit a photograph's licence asks for, as a visitor would read it. */
  const creditOf = (p) => `"${p.title}" by ${p.creator} (${p.licence})`;

  /**
   * What an agent on a website is told about images. With photographs: the
   * exact addresses, the credit, and nothing invented. Without: draw.
   */
  function briefOf(photos) {
    const list = Array.isArray(photos) ? photos : [];
    if (!list.length) {
      return `\n\nIMAGES: no photographs are available for this site. Do not write any image address at all — not a remote one, not a local file. Make the imagery with CSS (gradients, shapes, texture) and small inline SVG drawings made for this subject, so nothing on the page is a broken picture.`;
    }
    const lines = list.map((p, i) => `${i + 1}. ${p.url} — ${p.title}, ${p.shape}. Credit: ${creditOf(p)}${p.page ? `, ${p.page}` : ''}`);
    return `\n\nPHOTOGRAPHS FOR THIS SITE. These are real, openly licensed photographs of its subject, and the only photographs to use. Copy the addresses exactly; never write any other image address, and never an image file of your own:
${lines.join('\n')}
Every photograph the site shows must be credited where a visitor can read it — a line in the footer does — with its title, its author and its licence, linked to its page. The licence requires it. Where none of them suits a spot, use CSS or an inline SVG there instead.`;
  }

  /** The photographs a site shows whose authors it never credits. */
  function uncredited(files, photos) {
    const list = Array.isArray(photos) ? photos : [];
    if (!list.length) return [];
    const text = [...(files && typeof files.values === 'function' ? files.values() : Object.values(files || {}))]
      .map((f) => String((f && f.content) != null ? f.content : f || '')).join('\n');
    return list.filter((p) => text.includes(p.url) && !(p.creator !== 'unknown' && text.includes(p.creator)));
  }

  // ── The setting ───────────────────────────────────────────────────

  const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

  /** Whether the app may search for photographs now. Off under "Local only". */
  function allowed(doc = typeof document !== 'undefined' ? document : null) {
    const local = doc && doc.getElementById('privacyLocal');
    if (local && local.checked) return false;
    const s = store();
    try { return !s || s.getItem(PREF_KEY) !== 'off'; } catch { return true; }
  }

  /** Wire the setting's box, once it is on the page. */
  function wire(doc = typeof document !== 'undefined' ? document : null) {
    const box = doc && doc.getElementById('swarmPhotos');
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    const s = store();
    try { box.checked = !s || s.getItem(PREF_KEY) !== 'off'; } catch { box.checked = true; }
    box.addEventListener('change', () => { try { s && s.setItem(PREF_KEY, box.checked ? 'on' : 'off'); } catch { /* kept for this session only */ } });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wire());
    else wire();
  }

  window.HCSwarmPhotos = { ENDPOINT, PREF_KEY, LICENCES, MAX_PHOTOS, searchesOf, photoOf, find, creditOf, briefOf, uncredited, allowed, wire };
})();
