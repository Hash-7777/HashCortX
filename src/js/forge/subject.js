// ==============================================================
// What the thing actually is, worked out before any geometry is written
//
// THE DEFECT THIS REPLACES. Every prompt was matched against three regular
// expressions and given a route: "anatomical" for a word like skull or bone,
// "organic_diffusion" for a word like tree or cloud, and "parametric" for
// everything else. The run announced the route in the trace, said "SDF Kernel"
// or "Geometry Kernel" above it, and finished the stage with "sdf smoothed".
//
// None of it was real. The route never reached the model — the call that
// designs the object was handed the prompt and the same system text every
// time, whether it was building a femur or a doorknob. There is no SDF kernel
// and nothing was smoothed. The diffusion route could not even be taken: the
// run rewrote it to parametric on the line after it was chosen, because no
// diffusion backend was ever built. So the Forge sorted the world into three
// buckets, told the person which bucket they were in, and then designed
// everything exactly one way.
//
// That is what a templated mode looks like from the inside. Not a template
// that fires — a label that does nothing while the single generic path runs.
//
// WHAT HAPPENS INSTEAD. The model is asked what the thing IS before it is
// asked to build it: its parts and the shape each part wants to be, the axis
// it lies along, its real size, whether it is one thing or several, where
// material has to come out, what repeats, and which plane its halves sit
// either side of. That answer is read, checked, and written into the design
// call, so the geometry is designed against the object in front of it rather
// than against a generic instruction sheet.
//
// There is no list of things the Forge can be asked for, and this file must
// never grow one. When no model can be reached, derive() below reads what the
// words themselves settle — a measurement written in the prompt, whether
// several things were asked for, whether it has to be hollow — and leaves the
// rest unanswered rather than guessing. An unanswered field is simply not
// mentioned to the design call, which then decides it, as it always did.
//
// The brief is a reading of the request, never a limit on it. briefLines()
// says so to the model in as many words, because a brief that is obeyed
// literally is just the template again, one layer further in.
//
// Pure: text in, plain values out. No DOM, no storage, no network. The call
// that asks a model lives in the mode, beside the one that asks for geometry.
//
// Loaded before the Forge mode and published as window.HCForgeSubject.
// Checked by scripts/checks/forge-subject.mjs.
// ==============================================================

(function () {
  'use strict';

  /** The most parts a brief may name. A design of 6 to 16 is what is asked for. */
  const MAX_PARTS = 16;
  /** The most repeated features or cuts a brief may name. */
  const MAX_NOTES = 6;
  /** The most separate things one request may ask for. */
  const MAX_OBJECTS = 8;
  /** The largest real size a brief may claim, in millimetres. */
  const MAX_SIZE_MM = 4000;

  /** The shapes the assembler can build, so a brief cannot name one it cannot. */
  const SHAPES = ['mesh', 'lathe', 'extrude', 'capsule', 'sphere', 'cone', 'torus', 'box', 'cylinder'];
  const AXES = ['x', 'y', 'z'];

  const SYSTEM = [
    'You are given a request for a 3D model. Before any geometry is written, say what the thing IS.',
    '',
    'Return only JSON. No markdown, no prose, no comments.',
    '',
    '{',
    '  "subject": "the thing, in three or four words",',
    '  "make": "one sentence on how it is put together",',
    '  "parts": [{"name": "body", "shape": "extrude", "note": "the silhouette, carries the form"}],',
    '  "lies": "x",',
    '  "sizeMm": 150,',
    '  "objects": 1,',
    '  "hollow": false,',
    '  "symmetry": "z",',
    '  "repeats": ["24 teeth about y"],',
    '  "cuts": ["bore through the body"]',
    '}',
    '',
    '- "parts": every part the thing needs and nothing it does not, largest first. Six to sixteen for',
    '  most objects. "shape" is one of: ' + SHAPES.join(', ') + '. Pick the shape that describes the',
    '  part in ONE piece rather than approximating it with several. The largest part carries the',
    '  silhouette and is almost never a box or a sphere.',
    '- "lies": the axis the longest side runs along, from how the thing rests in life. A fish, a car,',
    '  a plane, an animal lie along x or z. A bottle, a lamp, a tower, a person stand, so "y".',
    '- "sizeMm": the real longest side in millimetres. A mug is about 95, a phone 150, a chair 900.',
    '- "objects": how many separate things the request asks for. A bicycle is one thing with many',
    '  parts. A chess set, a knife and fork, or three dice are several.',
    '- "hollow": true when material has to come out of it for it to be what it is.',
    '- "symmetry": the plane the two matching halves sit either side of, or null when it has none.',
    '- "repeats": features that occur many times, each said as a count and an axis.',
    '- "cuts": material that has to be taken away for the thing to be right.',
    '',
    'Answer for the request in front of you, whatever it is: a tool, a creature, a building, a piece',
    'of jewellery, a toy, a machine part, a vehicle, a sculpture, a fitting for something else. There',
    'is no list of things you can be asked for. If the request is unlike anything above, describe it',
    'on its own terms; do not bend it towards something more familiar.',
  ].join('\n');

  function messages(prompt) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Request: ${String(prompt || '').trim()}` },
    ];
  }

  function clean(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function axisOf(value) {
    const name = clean(value, 8).toLowerCase();
    return AXES.includes(name) ? name : null;
  }

  function shapeOf(value) {
    const name = clean(value, 20).toLowerCase();
    return SHAPES.includes(name) ? name : '';
  }

  function countOf(value, max) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 0;
  }

  /**
   * A model's answer as a brief, or null when it could not be read at all —
   * which is different from a readable answer that says little.
   */
  function readBrief(text) {
    const raw = String(text || '');
    const fenced = window.HCFences ? window.HCFences.jsonBlock(raw) : null;
    const body = fenced != null ? fenced : raw;
    const start = body.indexOf('{');
    if (start < 0) return null;
    const end = body.lastIndexOf('}');
    if (end <= start) return null;
    let parsed = null;
    try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  }

  function notesOf(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const line = clean(raw, 120);
      const key = line.toLowerCase();
      if (line.length < 3 || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
      if (out.length === MAX_NOTES) break;
    }
    return out;
  }

  function partsOf(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const source = typeof raw === 'string' ? { name: raw } : raw;
      if (!source || typeof source !== 'object') continue;
      const name = clean(source.name, 48);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, shape: shapeOf(source.shape), note: clean(source.note, 120) });
      if (out.length === MAX_PARTS) break;
    }
    return out;
  }

  /**
   * A brief with everything in it checked and in range, whatever it came from.
   *
   * A field that could not be read is left empty rather than filled with a
   * stand-in. briefLines() leaves an empty field out of the design call, and
   * the design call decides it the way it always did — which is the whole
   * reason nothing here guesses.
   */
  function normalise(raw) {
    const brief = raw && typeof raw === 'object' ? raw : {};
    return {
      subject: clean(brief.subject, 60),
      make: clean(brief.make, 240),
      parts: partsOf(brief.parts),
      lies: axisOf(brief.lies),
      sizeMm: Math.min(Math.max(Number(brief.sizeMm) > 0 ? Number(brief.sizeMm) : 0, 0), MAX_SIZE_MM),
      objects: countOf(brief.objects, MAX_OBJECTS),
      hollow: brief.hollow === true,
      symmetry: axisOf(brief.symmetry),
      repeats: notesOf(brief.repeats),
      cuts: notesOf(brief.cuts),
    };
  }

  // Words that settle a question on their own. These are not a catalogue of
  // subjects — there is deliberately no such list here — they are the few
  // things the request states outright, which is all that can be known without
  // asking a model.
  const SEVERAL = /\b(pair|set of|collection|group|scene|diorama|row of|series of|both)\b/;
  const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, dozen: 8 };
  const HOLLOW = /\b(mug|cup|bowl|vase|pot|jar|bottle|tube|pipe|ring|box|case|shell|enclosure|housing|container|tray|basket|planter|hollow|holder|cover|lid|bucket|tank|funnel|socket|sleeve)\b/;
  const CUT = /\b(hole|holes|bore|slot|slots|vent|vents|cutout|cut-out|cutouts|groove|grooves|thread|threaded|keyway|window|windows|aperture|perforat\w*|drill\w*|countersink|counterbore)\b/;
  const UNIT_MM = { mm: 1, millimetre: 1, millimeter: 1, cm: 10, centimetre: 10, centimeter: 10, m: 1000, metre: 1000, meter: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4 };

  /**
   * The size the prompt itself states, in millimetres, or 0 when it states
   * none. The largest measurement written is taken as the longest side, which
   * is what sizeMm means; a smaller one in the same sentence is a detail.
   */
  function sizeFromPrompt(prompt) {
    const q = String(prompt || '').toLowerCase();
    let best = 0;
    const re = /(\d+(?:\.\d+)?)\s*(millimetres?|millimeters?|centimetres?|centimeters?|metres?|meters?|inches|inch|mm|cm|m|in|")\b/g;
    let match;
    while ((match = re.exec(q)) !== null) {
      const unit = match[2].replace(/s$/, '');
      const factor = UNIT_MM[unit] || UNIT_MM[match[2]];
      if (!factor) continue;
      const mm = Number(match[1]) * factor;
      if (mm > 0 && mm <= MAX_SIZE_MM && mm > best) best = mm;
    }
    return best;
  }

  /**
   * How many separate things the words ask for, or 0 when they do not say.
   */
  function objectsFromPrompt(prompt) {
    const q = String(prompt || '').toLowerCase();
    if (SEVERAL.test(q)) return 2;
    for (const [word, n] of Object.entries(NUMBER_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(q)) return Math.min(n, MAX_OBJECTS);
    }
    // A digit before a plural noun, but not before a unit: "5 inches tall"
    // describes one thing. Deliberately conservative — it wants a plural in
    // "s", so "6 dice" is not counted. Reading too many separate things stops
    // the assembler tidying a stray cluster away, and a miss here only leaves
    // the design exactly as the model wrote it.
    const digits = q.match(/\b([2-8])\s+(?!inch(es)?\b|feet\b|metres?\b|meters?\b|millimet(re|er)s?\b|centimet(re|er)s?\b)[a-z]{3,}s\b/);
    if (digits) return Math.min(Number(digits[1]), MAX_OBJECTS);
    return 0;
  }

  /**
   * What the words settle by themselves, used when no model could be reached.
   *
   * It answers four things and leaves the rest empty on purpose. A derived
   * brief that invented a parts list would be the template returning by the
   * back door, and it would be wrong more often than the design call, which
   * can actually picture the object.
   */
  function derive(prompt) {
    const q = String(prompt || '').toLowerCase();
    const cuts = [];
    if (CUT.test(q)) cuts.push('the openings the request names, each written as a subtracted part');
    return normalise({
      subject: '',
      make: '',
      parts: [],
      lies: null,
      sizeMm: sizeFromPrompt(prompt),
      objects: objectsFromPrompt(prompt),
      hollow: HOLLOW.test(q),
      symmetry: null,
      repeats: [],
      cuts,
    });
  }

  /**
   * The brief a run works from: the model's answer where it said something,
   * and what the words settle where it did not.
   *
   * A measurement written in the request wins over one the model chose. The
   * person typed a number; that is not a field to be second-guessed.
   */
  function merge(fromModel, prompt) {
    const derived = derive(prompt);
    if (!fromModel) return { ...derived, from: 'words' };
    const brief = normalise(fromModel);
    if (!brief.parts.length && !brief.subject) return { ...derived, from: 'words' };
    const stated = sizeFromPrompt(prompt);
    return {
      ...brief,
      sizeMm: stated || brief.sizeMm,
      objects: Math.max(brief.objects, derived.objects),
      hollow: brief.hollow || derived.hollow,
      cuts: brief.cuts.length ? brief.cuts : derived.cuts,
      from: 'model',
    };
  }

  /**
   * The brief as the lines that go into the design call, or '' when it settled
   * nothing worth saying.
   *
   * Every field is here only if it was answered. The closing line is not
   * decoration: a brief read as a specification is the template again, so the
   * design call is told plainly that it may build what the brief missed.
   */
  function briefLines(brief) {
    const b = brief && typeof brief === 'object' ? brief : {};
    const lines = [];
    if (b.subject) lines.push(`- It is: ${b.subject}`);
    if (b.make) lines.push(`- How it goes together: ${b.make}`);
    if (b.parts && b.parts.length) {
      lines.push('- The parts it needs, largest first:');
      for (const part of b.parts) {
        const shape = part.shape ? ` — ${part.shape}` : '';
        const note = part.note ? ` (${part.note})` : '';
        lines.push(`    ${part.name}${shape}${note}`);
      }
    }
    if (b.lies) lines.push(`- Its longest side runs along ${b.lies.toUpperCase()}. Orient it that way.`);
    if (b.sizeMm) lines.push(`- Its real longest side is about ${Math.round(b.sizeMm)} mm, so "sizeMm" is about that.`);
    if (b.symmetry) lines.push(`- Its two halves sit either side of ${b.symmetry.toUpperCase()}. Build one side and set "mirror": "${b.symmetry}" on it.`);
    if (b.hollow) lines.push('- It is hollow. Take the inside out with a part that has "op": "subtract"; do not model a thin skin.');
    if (b.cuts && b.cuts.length) lines.push(`- Material to take away, each written as a subtracted part: ${b.cuts.join('; ')}`);
    if (b.repeats && b.repeats.length) lines.push(`- Features that repeat — write ONE part and give it "repeat": ${b.repeats.join('; ')}`);
    if (!lines.length) return '';
    return [
      'What this is, worked out before the geometry:',
      ...lines,
      'This is a reading of the request, not a limit on it. If the object needs a part that is not',
      'listed here, build it; if a part listed here does not belong, leave it out. The request is',
      'what you are answering.',
    ].join('\n');
  }

  /**
   * The line the design call is given about how many separate things to build.
   *
   * It replaces a fixed instruction that said "one object, nothing floating
   * beside it" on every run — which is right for a bracket and wrong for a
   * chess set, and there was no way for a run to say which it had.
   */
  function subjectRule(objects) {
    const n = countOf(objects, MAX_OBJECTS);
    if (n >= 2) {
      return `- The request asks for ${n} separate things. Parts WITHIN each thing must touch or overlap it; the things themselves stand apart from each other, arranged the way they would be set down in life.`;
    }
    return '- Every part must touch or overlap another. One object, nothing floating beside it.';
  }

  /** How many separate things a run should keep, or 0 when nothing settled it. */
  function subjectsOf(brief) {
    return brief && typeof brief === 'object' ? countOf(brief.objects, MAX_OBJECTS) : 0;
  }

  function summaryOf(brief) {
    const b = brief && typeof brief === 'object' ? brief : {};
    const bits = [];
    if (b.subject) bits.push(b.subject);
    if (b.parts && b.parts.length) bits.push(`${b.parts.length} part${b.parts.length === 1 ? '' : 's'}`);
    if (b.sizeMm) bits.push(`${Math.round(b.sizeMm)} mm`);
    if (b.objects >= 2) bits.push(`${b.objects} separate things`);
    if (b.symmetry) bits.push(`mirrored on ${b.symmetry}`);
    if (b.hollow) bits.push('hollow');
    return bits.length ? bits.join(' · ') : 'nothing settled in advance';
  }

  window.HCForgeSubject = {
    MAX_PARTS, MAX_NOTES, MAX_OBJECTS, MAX_SIZE_MM, SHAPES, SYSTEM,
    messages, readBrief, normalise, derive, merge, briefLines, subjectRule, subjectsOf,
    summaryOf, sizeFromPrompt, objectsFromPrompt,
  };
})();
