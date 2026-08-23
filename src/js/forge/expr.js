// ============================================================
// expr.js — letting a design do arithmetic
//
// Every number in a plan used to be a literal. A design could not write
// `wall = 2` and then `outer = inner + wall`, and it could not say "this fin,
// twenty-four times around Y". So anything regular — gear teeth, cooling fins,
// a bolt circle, stair treads, a grille, a row of ribs — had to be enumerated
// part by part, with the model doing trigonometry in its head, one literal at a
// time. That is precisely where a model falls apart, and it is where a plan that
// arrived as eighteen disconnected shards came from.
//
// This is the smallest thing that fixes it: numbers, the five arithmetic
// operators, brackets, a handful of functions, and named variables. That is all.
//
// **There are no strings, no property access, no assignment, no function
// definitions, no imports, no loops and no way to name anything the caller has
// not put in scope.** The tokeniser rejects every character outside that set
// before the parser ever runs, and a name that is not a declared variable or one
// of the listed functions is an error rather than a lookup. So there is no
// sandbox to argue about here: a design's arithmetic cannot reach anything,
// because there is nothing in the language with which to reach.
//
// Nothing throws. An expression that will not parse comes back as an error with
// a reason, and the caller decides — which for a plan means leaving the field
// alone and reporting it, never guessing a number and building it anyway.
//
// Pure: no THREE, no DOM, no network, no clock.
//
// Run the checks with: npm run check:forge-expr
// ============================================================
(function () {
  "use strict";

  // What a design may call. Every one takes numbers and returns a number, and
  // between them they cover the arithmetic a part actually needs: placing
  // something around a circle, keeping a wall above a minimum, halving an
  // outside diameter. Nothing here can observe anything.
  const FUNCTIONS = {
    min: Math.min,
    max: Math.max,
    abs: Math.abs,
    sqrt: Math.sqrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sign: Math.sign,
    pow: Math.pow,
    hypot: Math.hypot,
    // Degrees, because a person and a model both think about a bolt circle in
    // degrees and radians are where the mistakes come from.
    rad: (deg) => (deg * Math.PI) / 180,
    deg: (rad) => (rad * 180) / Math.PI,
    clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  };

  const CONSTANTS = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };

  // A variable may be written in terms of another, so resolving one can need
  // another resolved first. This is how deep that is allowed to go before the
  // answer is that the design has written a circle.
  const MAX_VAR_DEPTH = 32;

  /**
   * Split an expression into the only things it is allowed to contain.
   *
   * The whitelist is here rather than in the parser on purpose: a character
   * this function does not recognise never reaches anything that could act on
   * it. A quote, a dot outside a number, a bracket, a semicolon — all stop
   * here, named, before any evaluation begins.
   */
  function tokenise(text) {
    const src = String(text);
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
      if (ch >= "0" && ch <= "9" || (ch === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
        const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        if (!match) return { error: `a number could not be read at position ${i}` };
        tokens.push({ kind: "number", value: Number(match[0]) });
        i += match[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const match = /^[A-Za-z_]\w*/.exec(src.slice(i));
        tokens.push({ kind: "name", value: match[0] });
        i += match[0].length;
        continue;
      }
      if ("+-*/%^(),".includes(ch)) {
        tokens.push({ kind: ch });
        i++;
        continue;
      }
      return { error: `"${ch}" is not something an expression may contain` };
    }
    return { tokens };
  }

  /**
   * Read the tokens as arithmetic.
   *
   * Ordinary precedence: brackets, then a power, then multiply and divide, then
   * add and subtract. A power binds to the right, so 2^3^2 is 2^9 the way it is
   * written on paper.
   */
  function parse(tokens, scope) {
    let at = 0;
    const peek = () => tokens[at];
    const take = () => tokens[at++];

    function primary() {
      const t = peek();
      if (!t) throw new Error("the expression ends where a number was expected");
      if (t.kind === "number") { take(); return t.value; }
      if (t.kind === "(") {
        take();
        const value = expression();
        if (peek()?.kind !== ")") throw new Error("a bracket was opened and not closed");
        take();
        return value;
      }
      if (t.kind === "name") {
        take();
        const name = t.value;
        if (peek()?.kind === "(") {
          take();
          const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ? FUNCTIONS[name] : null;
          if (!fn) throw new Error(`there is no function called "${name}"`);
          const args = [];
          if (peek()?.kind !== ")") {
            args.push(expression());
            while (peek()?.kind === ",") { take(); args.push(expression()); }
          }
          if (peek()?.kind !== ")") throw new Error(`the arguments to "${name}" were not closed`);
          take();
          const value = fn(...args);
          if (!Number.isFinite(value)) throw new Error(`"${name}" did not produce a usable number`);
          return value;
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
        // Own properties only. A name must be something the caller put in
        // scope, never something every object happens to carry.
        if (scope && Object.prototype.hasOwnProperty.call(scope, name)) {
          const value = Number(scope[name]);
          if (!Number.isFinite(value)) throw new Error(`"${name}" is not a number`);
          return value;
        }
        throw new Error(`nothing is called "${name}"`);
      }
      throw new Error("an expression may not start there");
    }

    function unary() {
      const t = peek();
      if (t?.kind === "-") { take(); return -unary(); }
      if (t?.kind === "+") { take(); return unary(); }
      return power();
    }

    function power() {
      const base = primary();
      if (peek()?.kind === "^") { take(); return Math.pow(base, unary()); }
      return base;
    }

    function term() {
      let value = unary();
      for (;;) {
        const t = peek();
        if (t?.kind === "*") { take(); value *= unary(); continue; }
        if (t?.kind === "/") {
          take();
          const by = unary();
          if (by === 0) throw new Error("a division by zero");
          value /= by;
          continue;
        }
        if (t?.kind === "%") {
          take();
          const by = unary();
          if (by === 0) throw new Error("a remainder by zero");
          value %= by;
          continue;
        }
        return value;
      }
    }

    function expression() {
      let value = term();
      for (;;) {
        const t = peek();
        if (t?.kind === "+") { take(); value += term(); continue; }
        if (t?.kind === "-") { take(); value -= term(); continue; }
        return value;
      }
    }

    const value = expression();
    if (at !== tokens.length) throw new Error("there is more after the expression than the expression");
    return value;
  }

  /**
   * A number, from a number or from something written as arithmetic.
   *
   * Never throws and never guesses. A caller that gets an error leaves the field
   * as it found it, because a wrong number silently built is worse than a field
   * that stayed where the design put it and said so.
   */
  function evaluate(input, scope) {
    if (typeof input === "number") {
      return Number.isFinite(input) ? { value: input } : { error: "not a usable number" };
    }
    if (typeof input !== "string" || !input.trim()) return { error: "nothing to evaluate" };
    const lexed = tokenise(input);
    if (lexed.error) return { error: lexed.error };
    if (!lexed.tokens.length) return { error: "nothing to evaluate" };
    try {
      const value = parse(lexed.tokens, scope || {});
      if (!Number.isFinite(value)) return { error: "did not come out as a usable number" };
      return { value };
    } catch (err) {
      return { error: err?.message || "could not be read" };
    }
  }

  /**
   * Resolve a plan's variables, which may be written in terms of each other.
   *
   * Repeated passes rather than a dependency graph: a plan has a handful of
   * variables, and the number of passes is capped, so a design that has written
   * a circle stops with a name rather than hanging. Order in the object does not
   * matter, which it would if this resolved in one pass.
   */
  function resolveVars(vars) {
    const values = {};
    const issues = [];
    const source = vars && typeof vars === "object" && !Array.isArray(vars) ? vars : {};
    const names = Object.keys(source);
    let remaining = names.slice();
    for (let depth = 0; depth < MAX_VAR_DEPTH && remaining.length; depth++) {
      const stuck = [];
      for (const name of remaining) {
        if (Object.prototype.hasOwnProperty.call(FUNCTIONS, name) || Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
          issues.push({ code: "reserved-name", name, detail: `"${name}" is already part of the language` });
          continue;
        }
        const out = evaluate(source[name], values);
        if (out.error) stuck.push(name);
        else values[name] = out.value;
      }
      if (stuck.length === remaining.length) break;
      remaining = stuck;
    }
    for (const name of remaining) {
      const out = evaluate(source[name], values);
      issues.push({ code: "unresolved-var", name, detail: out.error || "could not be worked out" });
    }
    return { values, issues };
  }

  /**
   * Resolve every number in a plan, wherever a design is allowed to write one.
   *
   * Only the places a number belongs: where a part sits, how it is turned, how
   * it is scaled, its shape's parameters, how many times it repeats, and how big
   * the object is. A name is a name and is never evaluated — the alternative is
   * an app that treats a part called "body" as something to look up.
   */
  function resolvePlan(plan) {
    const issues = [];
    if (!plan || typeof plan !== "object") return { plan, issues };
    const { values: scope, issues: varIssues } = resolveVars(plan.vars);
    issues.push(...varIssues);

    const resolveAt = (value, where) => {
      if (typeof value === "number" || value == null) return value;
      if (typeof value !== "string") return value;
      const out = evaluate(value, scope);
      if (out.error) {
        issues.push({ code: "bad-expression", where, detail: `${value} — ${out.error}` });
        return value;
      }
      return out.value;
    };

    // Depth-first over arrays of numbers, so a lathe's list of points and a
    // triple both work without either being enumerated here.
    const resolveDeep = (value, where) => {
      if (Array.isArray(value)) return value.map((v, i) => resolveDeep(v, `${where}[${i}]`));
      if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value)) out[key] = resolveDeep(value[key], `${where}.${key}`);
        return out;
      }
      return resolveAt(value, where);
    };

    const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
    const resolvedNodes = nodes.map((node, i) => {
      if (!node || typeof node !== "object") return node;
      const where = String(node.id || node.name || `node ${i + 1}`);
      const out = { ...node };
      for (const field of ["position", "rotation", "scale"]) {
        if (out[field] !== undefined) out[field] = resolveDeep(out[field], `${where}.${field}`);
      }
      if (out.params !== undefined) out.params = resolveDeep(out.params, `${where}.params`);
      // A repeat carries a count and a step, which are numbers, and an axis,
      // which is a name. Resolving the whole object treated "y" as something to
      // look up and reported every pattern in the plan as a broken expression.
      if (out.repeat && typeof out.repeat === "object" && !Array.isArray(out.repeat)) {
        const spec = { ...out.repeat };
        for (const field of ["count", "angle"]) {
          if (spec[field] !== undefined) spec[field] = resolveAt(spec[field], `${where}.repeat.${field}`);
        }
        if (spec.along !== undefined) spec.along = resolveDeep(spec.along, `${where}.repeat.along`);
        out.repeat = spec;
      }
      if (out.opacity !== undefined) out.opacity = resolveAt(out.opacity, `${where}.opacity`);
      return out;
    });

    const resolved = { ...plan, nodes: resolvedNodes };
    if (plan.sizeMm !== undefined) resolved.sizeMm = resolveAt(plan.sizeMm, "sizeMm");
    return { plan: resolved, issues, scope };
  }

  window.HCForgeExpr = {
    FUNCTIONS,
    CONSTANTS,
    MAX_VAR_DEPTH,
    evaluate,
    resolveVars,
    resolvePlan,
  };
})();
