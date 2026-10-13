// ==============================================================
// What a fetched web page holds besides its words — checks
//
// Loads the REAL src/js/page-facts.js and holds what it takes from a page
// (title, pictures, logo, colours, contact details, its other pages, all
// with absolute addresses), what it leaves out, and how it reads
// DuckDuckGo's plain results page. Then drives HashCoder's fetch_url and
// web_search through the real platform/tauri/hashcoder.js with the network
// stood in for. The business is invented; its number is in the range kept
// for fiction.
//
// Run with: npm run check:page-facts
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { URL, console, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src('js', 'page-facts.js'), sandbox, { filename: 'page-facts.js' });
vm.runInContext(src('js', 'page-text.js'), sandbox, { filename: 'page-text.js' });
const F = sandbox.HCPageFacts;

let pass = 0;
let fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const BASE = 'https://lanternlane.example/';
const PAGE = `<!doctype html><html><head><title>Lantern Lane Pharmacy &amp; Clinic</title>
<meta name="description" content="A family pharmacy in Bristol.">
<meta property="og:image" content="/img/share.jpg"><meta name="theme-color" content="#1F6F5C">
<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/apple.png">
<link rel="stylesheet" href="/css/site.css">
<style>:root{--brand:#1f6f5c;--accent:#E8B04A} .x{color:#333333;background:#fff} .y{color:#000}</style>
<script>var tracking = "#abcdef";</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},{"@type":"Pharmacy","name":"Lantern Lane Pharmacy","telephone":"+44 20 7946 0123","email":"care@lanternlane.example","address":{"@type":"PostalAddress","streetAddress":"12 Lantern Lane","addressLocality":"Bristol","postalCode":"BS1 4AB"},"openingHours":"Mo-Sa 08:00-21:00","sameAs":["https://www.instagram.com/lanternlanepharmacy","https://example.org/not-social"],"logo":{"@type":"ImageObject","url":"/img/logo.svg"},"foundingDate":"1961"}]}</script>
<script type="application/ld+json">{ broken json </script>
</head><body><header><img src="/img/logo.svg" alt="Lantern Lane logo" class="site-logo"><nav><a href="/about">About <b>us</b></a><a href="/contact#form">Contact</a><a href="/contact">Contact again</a><a href="https://elsewhere.example/x">Partner</a><a href="/brochure.pdf">Brochure</a><a href="#top">Top</a></nav></header>
<img src="data:image/gif;base64,R0lGOD" alt="inline"><img data-src="img/counter.jpg" alt="Our counter" width="800" height="600"><img src="/px/1x1.gif" width="1" height="1"><img src="/hidden.png" style="display:none">
<img srcset="/img/team-400.jpg 400w, /img/team-800.jpg 800w" alt="The team">
<p>Call us on 020 7946 0123 or write to hello@lanternlane.example. Retina file logo@2x.png. Order 20240115.</p>
<a href="tel:+442079460123">Call</a><a href="mailto:Hello@LanternLane.example?subject=hi">Mail</a><a href="https://facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://www.facebook.com/lanternlane">Facebook</a>
<div style="background-image: url('/img/hero.jpg')"></div><script>document.write('<img src="/from-script.png">')</script></body></html>`;

console.log('A page, read for what it holds:');
const r = F.read(PAGE, BASE);
ok('its title and description, entities read', r.title === 'Lantern Lane Pharmacy & Clinic' && r.description === 'A family pharmacy in Bristol.' && r.siteName === 'Lantern Lane Pharmacy');
const urls = r.images.map((i) => i.url);
ok('its pictures, every address made absolute, the share picture first', urls[0] === 'https://lanternlane.example/img/share.jpg' && urls.includes('https://lanternlane.example/img/logo.svg') && urls.includes('https://lanternlane.example/img/counter.jpg') && urls.includes('https://lanternlane.example/img/hero.jpg'), urls.join(' '));
ok('a lazy picture by its data-src, and the largest of a srcset', urls.includes('https://lanternlane.example/img/counter.jpg') && urls.includes('https://lanternlane.example/img/team-800.jpg'));
ok('each with its words and, where given, its size', r.images.find((i) => /counter/.test(i.url)).alt === 'Our counter' && r.images.find((i) => /counter/.test(i.url)).width === 800);
ok('not an inline picture, a tracking pixel or a hidden one', !urls.some((u) => /^data:|1x1|hidden\.png/.test(u)));
ok('nor markup a script writes, which is not part of the page', !urls.some((u) => /from-script/.test(u)));
ok('the logo its structured data names comes first, then pictures named as one, then its icons', r.logos[0].url === 'https://lanternlane.example/img/logo.svg' && r.logos[0].from === 'structured data' && r.logos.some((l) => /favicon-32\.png$/.test(l.url) && /32x32/.test(l.from)) && r.logos.some((l) => /apple\.png$/.test(l.url)));
ok('its colours: the theme colour and those its styles name, never black or white', r.colours[0] === '#1f6f5c' && r.colours.includes('#e8b04a') && !r.colours.includes('#ffffff') && !r.colours.includes('#000000'), r.colours.join(' '));
ok('not a colour written in a script', !r.colours.includes('#abcdef'));
const c = r.contact;
ok('one phone number written three ways is one', c.phones.length === 1 && c.phones[0] === '+44 20 7946 0123', c.phones.join(' | '));
ok('its email addresses, in lower case, and no file name that looks like one', c.emails.includes('care@lanternlane.example') && c.emails.includes('hello@lanternlane.example') && !c.emails.some((e) => /@2x/.test(e)), c.emails.join(' '));
ok('its address and hours from its structured data', c.addresses[0] === '12 Lantern Lane, Bristol, BS1 4AB' && c.hours[0] === 'Mo-Sa 08:00-21:00' && c.founded === '1961');
ok('its social accounts, not a share button or another site', c.social.includes('https://www.instagram.com/lanternlanepharmacy') && c.social.includes('https://www.facebook.com/lanternlane') && !c.social.some((s) => /sharer|example\.org/.test(s)), c.social.join(' '));
ok('a number in the text that is a date or an order is not a phone', !c.phones.some((p) => /20240115/.test(p)));
const links = r.links.map((l) => `${l.text}>${l.url}`);
ok('its other pages, by their words, each once, without the part after #', links.includes('About us>https://lanternlane.example/about') && links.filter((l) => l.endsWith('/contact')).length === 1, links.join(' | '));
ok('not another site, a file or the page itself', !links.some((l) => /elsewhere|\.pdf|#top|>https:\/\/lanternlane\.example\/$/.test(l)));
ok('its stylesheets, to read for more colours', r.stylesheets[0] === 'https://lanternlane.example/css/site.css');
ok('a page with nothing in it gives empty lists, not a failure', (() => { const e = F.read('', BASE); return e.title === '' && e.images.length === 0 && e.contact.phones.length === 0 && e.links.length === 0; })());
ok('a broken block of structured data is passed over', F.structured('<script type="application/ld+json">{ no</script>').length === 0);
ok('no more than its limits', (() => { const many = Array.from({ length: 60 }, (_, i) => `<img src="/i${i}.jpg" alt="p${i}"><a href="/p${i}">Page ${i}</a>`).join(''); const m = F.read(many, BASE); return m.images.length === F.MOST_IMAGES && m.links.length === F.MOST_LINKS; })());
ok('only web addresses are made absolute', F.absolute('/a', BASE) === 'https://lanternlane.example/a' && F.absolute('javascript:alert(1)', BASE) === '' && F.absolute('data:x', BASE) === '' && F.absolute('mailto:a@b.c', BASE) === '' && F.absolute('ftp://x/y', BASE) === '');
ok('the note says whose they are, and what was not read', /the site's own/.test(F.NOTE) && /only for the business they belong to/.test(F.NOTE) && /stylesheets were not read/.test(F.NOTE));

console.log('\nDuckDuckGo\'s plain results page:');
{
  const html = `<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flanternlane.example%2Fabout&amp;rut=abc">Lantern Lane <b>Pharmacy</b> - About</a></h2><a class="result__snippet" href="x">Family pharmacy since <b>1961</b>.</a></div></div>
<div class="result result--ad results_links"><h2><a class="result__a" href="//duckduckgo.com/y.js?ad_domain=x">An advert</a></h2></div>
<div class="result results_links"><h2><a href="https://other.example/page" class="result__a">Other &amp; more</a></h2><div class="result__snippet">Second.</div></div>
<div class="result results_links"><h2><a class="result__a" href="https://duckduckgo.com/settings">Settings</a></h2></div>`;
  const s = F.searchResults(html);
  ok('each result with its real address, taken out of the redirect', s[0] && s[0].url === 'https://lanternlane.example/about' && s[0].title === 'Lantern Lane Pharmacy - About' && s[0].snippet === 'Family pharmacy since 1961.', JSON.stringify(s[0]));
  ok('an advert and a link back to the search site are left out', s.length === 2 && s[1].url === 'https://other.example/page' && s[1].title === 'Other & more' && s[1].snippet === 'Second.');
  ok('a page with no results gives none', F.searchResults('<html>nothing</html>').length === 0);
}

console.log('\nHashCoder reads a page and searches through it:');
{
  const fetched = [];
  const asked = [];
  const pages = { [BASE]: PAGE, 'https://html.duckduckgo.com/html/?q=Lantern%20Lane%20Pharmacy': `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(BASE)}">Lantern Lane</a><a class="result__snippet">Bristol.</a></div>` };
  sandbox.HC = {
    isTauri: true,
    guard: { request: async (kind, target) => { asked.push(`${kind} ${target}`); return true; }, busy: () => ({ done() {} }) },
    invoke: async () => null,
  };
  sandbox._H = {
    fetchPage: async (url) => { fetched.push(url); return pages[url] != null ? { html: pages[url], url } : null; },
    tavilyReady: () => false,
  };
  sandbox.fetch = async () => { throw new Error('no network in a check'); };
  vm.runInContext(src('platform', 'tauri', 'hashcoder.js'), sandbox, { filename: 'hashcoder.js' });
  const tool = (name) => sandbox.HC.code.TOOL_DEFINITIONS.find((t) => t.name === name);
  const out = JSON.parse(await tool('fetch_url').fn({ url: BASE }));
  ok('fetch_url asks first, then gives the text with the title, pictures, logo, colours, contact and links', asked[0] === `fetch ${BASE}` && out.title === 'Lantern Lane Pharmacy & Clinic' && out.images.length > 3 && out.logos[0] && out.colours[0] === '#1f6f5c' && out.contact.phones[0] === '+44 20 7946 0123' && out.links.length >= 2 && /Call us on/.test(out.text) && /the site's own/.test(out.note));
  const long = '<p>' + 'word '.repeat(5000) + '</p><p>THE END</p>';
  pages['https://long.example/'] = long;
  const first = JSON.parse(await tool('fetch_url').fn({ url: 'https://long.example/' }));
  const next = JSON.parse(await tool('fetch_url').fn({ url: 'https://long.example/', offset: first.nextOffset }));
  ok('a long page is read a part at a time, and offset reads on', first.nextOffset > 0 && /offset/.test(first.text) && /THE END/.test(next.text) && !('images' in next));
  const missing = JSON.parse(await tool('fetch_url').fn({ url: 'https://gone.example/' }));
  ok('a page that cannot be read says so, and what to try', /could not be read/.test(missing.error) && /home page/.test(missing.error));
  const found = JSON.parse(await tool('web_search').fn({ query: 'Lantern Lane Pharmacy' }));
  ok('web_search without a key reads DuckDuckGo\'s results through the same reader, after asking', found.source === 'duckduckgo' && found.results[0].url === BASE && asked.includes('fetch https://html.duckduckgo.com/html/') && /fetch_url/.test(found.note));
  const fd = tool('fetch_url'), ws = tool('web_search');
  ok('the tools say so to the model', /pictures with their addresses/.test(fd.description) && /offset/.test(JSON.stringify(fd.parameters)) && /DuckDuckGo's results/.test(ws.description) && /business, place, person or topic/.test(ws.description));
  const boot = src('boot.js');
  ok('it loads before app.js and HashCoder', boot.indexOf("'/js/page-facts.js'") > 0 && boot.indexOf("'/js/page-facts.js'") < boot.indexOf("'/js/app.js'"));
  const app = src('js', 'app.js');
  ok('app.js hands over the page as it came, through the same checked reader', /async function fetchUrl\(url, \{ raw = false \} = \{\}\)/.test(app) && /if \(out\?\.ok\) return raw \? \{ html: String\(out\.text \|\| ''\), url: out\.finalUrl \|\| url \} : HCPageText\.stripHtml\(out\.text\);/.test(app) && /fetchPage: \(url\) => fetchUrl\(url, \{ raw: true \}\),/.test(app));
  ok('this check is part of npm run check', /npm run check:page-facts\b/.test(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/page-facts.js)`);
process.exit(fail ? 1 : 0);
