// ==============================================================
// The time anywhere — checks
//
// Loads the REAL src/js/chat/clock.js and holds that a place or a zone name
// is matched to the system's time zones, that the date, time and day there
// are worked out for a given moment — including when that place is already
// in tomorrow — and that the date tool uses it for a place it is asked about.
//
// Run with: npm run check:clock
// ==============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(here, '..', '..', 'src', ...p), 'utf8');
const sandbox = { window: {}, Intl, Date, String, Array, Object };
vm.createContext(sandbox);
vm.runInContext(src('js', 'chat', 'clock.js'), sandbox, { filename: 'clock.js' });
const C = sandbox.window.HCClock;

let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const zones = Intl.supportedValuesOf('timeZone');

console.log('A place or a zone name:');
ok('a zone written out', C.zoneOf('Asia/Tokyo', zones) === 'Asia/Tokyo' && C.zoneOf('asia/tokyo', zones) === 'Asia/Tokyo');
ok('a city the zone list names', C.zoneOf('Tokyo', zones) === 'Asia/Tokyo' && C.zoneOf('New York', zones) === 'America/New_York' && C.zoneOf('cairo', zones) === 'Africa/Cairo');
ok('a place the zone list does not name', C.zoneOf('Beijing', zones) === 'Asia/Shanghai' && C.zoneOf('India', zones) === 'Asia/Kolkata' && C.zoneOf('California', zones) === 'America/Los_Angeles');
ok('every place in the short list is a zone this system can tell the time in', Object.values(C.PLACES).every((z) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); return true; } catch { return false; } }));
ok('somewhere it does not know is said to be unknown, not guessed', C.zoneOf('Atlantis', zones) === null && C.zoneOf('', zones) === null);

console.log('\nThe date, the time and the day there:');
{
  const moment = new Date(Date.UTC(2026, 8, 23, 20, 12));
  const tokyo = C.at('Asia/Tokyo', moment);
  ok('in a place already in tomorrow, the day is tomorrow', tokyo.date === 'Thursday, 24 September 2026' && tokyo.time === '05:12' && tokyo.weekday === 'Thursday' && tokyo.utc_offset === 'UTC+9');
  const ny = C.at('America/New_York', moment);
  ok('and behind, it is still today', ny.date === 'Wednesday, 23 September 2026' && ny.time === '16:12' && ny.utc_offset === 'UTC-4');
  ok('the zone itself is named', tokyo.timezone === 'Asia/Tokyo' && /^UTC(\+0)?$/.test(C.at('UTC', moment).utc_offset));
}

console.log('\nThe date tool uses it:');
{
  const app = src('js', 'app.js');
  const tool = app.slice(app.indexOf('    current_datetime: {'), app.indexOf('    calculate: {'));
  ok('it takes a place, and works out the time there', /place: \{ type: "string"/.test(tool) && /HCClock\.zoneOf\(place/.test(tool) && /HCClock\.at\(zone, now\)/.test(tool));
  ok('a place it does not know is said so, with the time here', /not a place or time zone this computer knows/.test(tool));
  ok('it loads before the chat', src('boot.js').indexOf("'/js/chat/clock.js'") < src('boot.js').indexOf("'/js/app.js'"));
}

console.log(`\n${pass} passed, ${fail} failed  (src/js/chat/clock.js)`);
process.exit(fail ? 1 : 0);
