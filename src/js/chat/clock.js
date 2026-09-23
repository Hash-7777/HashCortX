// ============================================================
// chat/clock.js — the time now, anywhere, worked out by the app
//
// The date tool gave the time where the computer is, and a model asked for
// the time in another city did the time-zone arithmetic itself: a small
// model got the hour right and the day wrong, because the city was already
// in tomorrow. The tool now takes a place or a time-zone name and gives the
// date, the time and the day there, worked out by the system's own clock
// data, so the model has nothing to add up.
//
// A place is matched to the system's time-zone list by name ("Tokyo" is
// Asia/Tokyo, "New York" is America/New_York), or through a short list of
// places that are not in its names ("Beijing", "India", "California").
//
// Pure: the zone list and the moment are arguments. Published as
// window.HCClock. Checked by scripts/checks/clock.mjs.
// ============================================================
(function () {
  "use strict";

  const PLACES = {
    beijing: "Asia/Shanghai", china: "Asia/Shanghai", "hong kong": "Asia/Hong_Kong",
    india: "Asia/Kolkata", kolkata: "Asia/Kolkata", calcutta: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata", mumbai: "Asia/Kolkata", bangalore: "Asia/Kolkata",
    japan: "Asia/Tokyo", korea: "Asia/Seoul", "south korea": "Asia/Seoul",
    egypt: "Africa/Cairo", uae: "Asia/Dubai", "abu dhabi": "Asia/Dubai", saudi: "Asia/Riyadh", "saudi arabia": "Asia/Riyadh", jeddah: "Asia/Riyadh", mecca: "Asia/Riyadh",
    uk: "Europe/London", england: "Europe/London", britain: "Europe/London", scotland: "Europe/London",
    france: "Europe/Paris", germany: "Europe/Berlin", spain: "Europe/Madrid", italy: "Europe/Rome", netherlands: "Europe/Amsterdam",
    california: "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", "silicon valley": "America/Los_Angeles",
    washington: "America/New_York", boston: "America/New_York", miami: "America/New_York", "new york city": "America/New_York", nyc: "America/New_York",
    texas: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", "san diego": "America/Los_Angeles",
    canada: "America/Toronto", brazil: "America/Sao_Paulo", "rio de janeiro": "America/Sao_Paulo",
    australia: "Australia/Sydney", melbourne: "Australia/Melbourne", "new zealand": "Pacific/Auckland",
    utc: "UTC", gmt: "UTC",
  };

  const norm = (s) => String(s || "").toLowerCase().replace(/[_]/g, " ").replace(/\s+/g, " ").trim();

  /** The time zone a place or zone name means, from the system's list, or null. */
  function zoneOf(place, zones) {
    const want = norm(place);
    if (!want) return null;
    const list = Array.isArray(zones) ? zones : [];
    const exact = list.find((z) => norm(z) === want);
    if (exact) return exact;
    if (PLACES[want]) return PLACES[want];
    const city = list.find((z) => norm(z.split("/").pop()) === want);
    return city || null;
  }

  /** The date, time and day in a zone at a moment, as words and numbers the model can read out. */
  function at(zone, moment = new Date()) {
    const parts = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...opts }).formatToParts(moment)
      .reduce((o, p) => { o[p.type] = p.value; return o; }, {});
    const d = parts({ weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" });
    return {
      timezone: zone,
      date: `${d.weekday}, ${d.day} ${d.month} ${d.year}`,
      time: `${d.hour}:${d.minute}`,
      weekday: d.weekday,
      utc_offset: String(d.timeZoneName || "").replace(/^GMT/, "UTC") || "UTC",
    };
  }

  window.HCClock = { zoneOf, at, PLACES };
})();
