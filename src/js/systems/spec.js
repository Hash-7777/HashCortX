// ============================================================
// systems/spec.js — deciding whether a generated system is usable
//
// The ERP mode asks a model to design a whole business application and gets
// back a wall of text that is supposed to contain JSON. Everything downstream —
// the modules, the screens, the records, the money — rests on two questions
// answered here: can that answer be read at all, and is what it says complete
// enough to build from.
//
// Both were answered inside a four-thousand-line file where nothing could look
// at them. This is the same move that was made for the 3D mode: the judgement
// comes out to where it can be handed an input and asked what it decides.
//
// WHAT THE READER IS UP AGAINST. A model asked for JSON returns JSON most of
// the time. The rest of the time it returns JSON wrapped in a code fence, or
// two code fences, or a sentence of explanation on either side, or JSON with a
// trailing comma, or a comment in the middle of it. Refusing those is refusing
// a perfectly good answer over its packaging, which reads to a person as the
// app failing when the model did not. So four attempts are made, in order of
// how much they assume, and the first that produces an object wins.
//
// WHAT THE GATE IS FOR. A spec that parses can still be useless: three modules
// where five were asked for, a module pointing at an entity nobody defined, an
// invoice with no amount on it. The gate says what is missing in words a model
// can be sent back with, rather than letting a half-formed system through to
// be discovered a screen at a time.
//
// Pure: strings and plain objects in, plain values out. No DOM, no network, no
// clock, no module state.
//
// Run the checks with: npm run check:systems-spec
// ============================================================
(function () {
  "use strict";

  /** The screens a module may ask for. Anything else is a mistake, not a hint. */
  const VALID_SCREENS = ["dashboard", "list", "kanban", "report", "split", "cards", "timeline", "calendar", "metric", "feed"];

  /** An identifier from anything a person or a model wrote. */
  function slug(raw, fallback = "item") {
    return String(raw || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  }

  /** A copy that cannot fail, whatever the platform has. */
  function cloneSafe(obj) {
    try { return structuredClone(obj); } catch { return JSON.parse(JSON.stringify(obj || {})); }
  }

  /**
   * Entities keyed by identifier, however the model chose to list them.
   *
   * A map is what the schema asks for and a list is what models often send.
   * Both mean the same thing, so both are read rather than one being refused.
   */
  function entityMap(entities) {
    const map = {};
    if (entities && typeof entities === "object" && !Array.isArray(entities)) {
      Object.entries(entities).forEach(([key, entity]) => {
        const id = slug(entity?.id || key);
        if (id) map[id] = entity || {};
      });
    } else if (Array.isArray(entities)) {
      entities.forEach((entity) => {
        const id = slug(entity?.id || entity?.name);
        if (id) map[id] = entity || {};
      });
    }
    return map;
  }

  /**
   * The JSON inside whatever a model actually sent.
   *
   * Four attempts, in order of how much each assumes. Each is only reached
   * because the one before it failed, so an ordinary answer costs one parse
   * and only a mangled one pays for the rest.
   */
  function parseJson(raw) {
    if (!raw) return null;
    const text = String(raw).trim();

    // 1. It is JSON, which is the usual case.
    try { return JSON.parse(text); } catch {}

    // 2. It is JSON in a code fence, possibly with prose around it.
    const stripped = text.replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.match(/```(?:json)?\s*([\s\S]*?)```/);
      return inner ? ` ${inner[1]} ` : " ";
    });
    try { return JSON.parse(stripped.trim()); } catch {}

    // 3. There is an object in there somewhere. Every `{` is tried as a start
    //    and matched to its closing brace, and the LARGEST thing that parses
    //    wins — a model explaining itself often writes a small example object
    //    before the real answer, and taking the first would take the example.
    const opens = [];
    for (let i = 0; i < text.length; i++) if (text[i] === "{") opens.push(i);
    let best = null;
    let bestLength = 0;
    for (const start of opens) {
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        if (depth === 0) {
          try {
            const candidate = text.slice(start, i + 1);
            const parsed = JSON.parse(candidate);
            if (typeof parsed === "object" && candidate.length > bestLength) {
              best = parsed;
              bestLength = candidate.length;
            }
          } catch {}
          break;
        }
      }
    }
    if (best) return best;

    // 4. Last resort: take out the things JSON does not allow but a model
    //    writes anyway — a trailing comma, a comment — and try the widest
    //    span, trimming from each end. Bounded to sixty characters either
    //    side, because this is a rescue and not a search.
    const clean = text.replace(/,\s*([}\]])/g, "$1").replace(/\/\/.*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const from = clean.indexOf("{");
    const to = clean.lastIndexOf("}");
    if (from !== -1 && to !== -1 && to > from) {
      for (let start = from; start < Math.min(from + 60, clean.length); start++) {
        for (let end = to; end > Math.max(to - 60, start); end--) {
          try {
            const parsed = JSON.parse(clean.slice(start, end + 1));
            if (typeof parsed === "object") return parsed;
          } catch {}
        }
      }
    }
    return null;
  }

  /**
   * What is missing from a spec, in words it can be sent back with.
   *
   * Says everything wrong at once rather than the first thing wrong: a model
   * given one complaint fixes one thing, and the next attempt fails on the
   * next. Capped, because a spec that is wrong in thirty ways is not going to
   * be argued into shape and the list stops being readable long before then.
   */
  function validate(raw) {
    const issues = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["Top-level SystemSpec must be a JSON object."];

    const modules = Array.isArray(raw.modules) ? raw.modules : [];
    const entities = entityMap(raw.entities);
    if (!String(raw.name || "").trim()) issues.push("Missing non-empty name.");
    if (modules.length < 5) issues.push("modules must include at least 5 business modules.");
    if (Object.keys(entities).length < 3) issues.push("entities must define at least 3 entity schemas.");

    const screens = new Set();
    modules.forEach((module, index) => {
      if (!String(module?.name || "").trim()) issues.push(`modules[${index}] is missing name.`);
      if (!String(module?.entity || "").trim()) issues.push(`modules[${index}] is missing entity.`);
      if (!VALID_SCREENS.includes(module?.screen)) issues.push(`modules[${index}] has invalid or missing screen.`);
      if (module?.screen) screens.add(module.screen);
      const entity = entities[slug(module?.entity || "")];
      if (!entity) {
        issues.push(`Entity "${module?.entity || "(missing)"}" referenced by module "${module?.name || index}" is not defined.`);
        return;
      }
      const fields = Array.isArray(entity.fields) ? entity.fields : [];
      if (fields.length < 3) issues.push(`Entity "${module.entity}" must include at least 3 fields.`);
      // A business record with nothing countable on it is a list of labels.
      // The name is checked as well as the type, because a model that writes
      // an amount as text has still understood the job.
      if (!fields.some((f) => ["number"].includes(f?.type) || /amount|total|price|cost|revenue|salary|qty|quantity|balance|value/i.test(f?.id || f?.label || ""))) {
        issues.push(`Entity "${module.entity}" needs at least one numeric/business value field.`);
      }
      if (!fields.some((f) => f?.type === "date" || /date|time|due|created|updated/i.test(f?.id || f?.label || ""))) {
        issues.push(`Entity "${module.entity}" needs at least one date/time field.`);
      }
    });

    if (modules.length >= 5 && screens.size < 4) issues.push("Use at least 4 different screen types across modules.");
    return [...new Set(issues)].slice(0, 14);
  }

  /**
   * The rows a table should show: searched, filtered, sorted.
   *
   * `view` is `{ search, filters, sort }` and is passed in rather than read
   * from whatever the panel happens to be holding. That is the whole reason
   * this can be checked: what a person typed and what the table shows are now
   * an input and an output rather than two halves of one closure.
   */
  function prepareRecords(rows, view = {}) {
    let records = Array.isArray(rows) ? [...rows] : [];
    const query = String(view.search || "").trim().toLowerCase();
    if (query) {
      records = records.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(query)));
    }
    for (const rule of Array.isArray(view.filters) ? view.filters : []) {
      if (!rule || !rule.field || rule.value === "" || rule.value === undefined) continue;
      records = records.filter((r) => {
        const cell = String(r[rule.field] ?? "").toLowerCase();
        const value = String(rule.value).toLowerCase();
        switch (rule.op) {
          case "eq": return cell === value;
          case "neq": return cell !== value;
          case "starts": return cell.startsWith(value);
          case "gt": return Number(r[rule.field]) > Number(rule.value);
          case "lt": return Number(r[rule.field]) < Number(rule.value);
          default: return cell.includes(value);
        }
      });
    }
    const sort = view.sort || {};
    if (sort.field) {
      records.sort((a, b) => {
        const av = a[sort.field];
        const bv = b[sort.field];
        // Numbers by value, everything else by words. A column of amounts
        // sorted as text puts 100 before 20, which looks like the sort being
        // broken rather than the column being the wrong kind.
        const n = Number(av) - Number(bv);
        const cmp = Number.isFinite(n) && !Number.isNaN(n) ? n : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "desc" ? -cmp : cmp;
      });
    }
    return records;
  }

  window.HCSystemsSpec = { VALID_SCREENS, slug, cloneSafe, entityMap, parseJson, validate, prepareRecords };
})();
