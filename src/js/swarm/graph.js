// ============================================================
// swarm/graph.js — keeping a swarm of agents finite
//
// The Swarm Maker runs a set of agents wired to each other: this one's answer
// feeds that one's question. That wiring is a directed graph, and the single
// thing it must never contain is a cycle.
//
// A cycle is not a wrong answer. It is a run that never finishes, spending a
// person's model quota in a loop until they notice and stop it. Nothing about
// the shape of a blueprint says whether it has one, and a blueprint written by
// a model — which is where these come from — can easily contain one, because
// "the reviewer checks the writer" and "the writer revises after review" are
// both sensible sentences.
//
// So the graph is checked, and where a cycle is found the edge that closes it
// is removed rather than the run being refused. A swarm missing one connection
// still does most of what was asked; a swarm that will not start does nothing.
//
// The layout is here for the same reason: it walks the same graph, and a walk
// that assumes no cycles will quietly place nothing at all when there is one.
//
// Pure: agents and edges in, answers out. No DOM, no storage, no network.
//
// Run the checks with: npm run check:swarm-graph
// ============================================================
(function () {
  "use strict";

  /**
   * Whether any path leads back to where it started.
   *
   * Depth-first, marking what is on the current path as well as what has been
   * seen. Seen-and-finished is not a cycle — two agents can both feed a third
   * without that being a loop — so the two marks have to be kept apart.
   */
  function hasCycle(agents, edges) {
    const visited = {};
    const stack = {};
    const list = Array.isArray(edges) ? edges : [];
    function walk(id) {
      if (stack[id]) return true;
      if (visited[id]) return false;
      visited[id] = true;
      stack[id] = true;
      for (const e of list) {
        if (e && e.from === id && walk(e.to)) return true;
      }
      stack[id] = false;
      return false;
    }
    return (Array.isArray(agents) ? agents : []).some((a) => a && walk(a.id));
  }

  /**
   * The same edges with the ones that close a loop taken out.
   *
   * An edge pointing back at something still on the current path is what
   * closes a loop, and dropping it is what opens the graph up again. Every
   * agent is walked from, not only the first: a blueprint can hold two
   * unconnected groups, and a loop inside the second one would otherwise never
   * be reached.
   *
   * Edges between agents that are not in the list are dropped as well. An edge
   * to an agent nobody defined cannot be run, and leaving it in means a cycle
   * that no walk starting from a real agent can see.
   */
  function breakCycles(agents, edges) {
    const list = (Array.isArray(edges) ? edges : []).filter((e) => e && e.from && e.to);
    const known = new Set((Array.isArray(agents) ? agents : []).map((a) => a && a.id));
    const real = list.filter((e) => known.has(e.from) && known.has(e.to));
    const visited = {};
    const onPath = {};
    const safe = new Set(real);
    function walk(id) {
      visited[id] = true;
      onPath[id] = true;
      for (const e of real) {
        if (e.from !== id) continue;
        if (onPath[e.to]) { safe.delete(e); continue; }
        if (!visited[e.to]) walk(e.to);
      }
      onPath[id] = false;
    }
    for (const a of Array.isArray(agents) ? agents : []) {
      if (a && !visited[a.id]) walk(a.id);
    }
    return [...safe];
  }

  /**
   * Which column each agent belongs in, left to right.
   *
   * Everything with nothing feeding it goes first, then everything whose
   * feeders have all been placed, and so on — so an agent is always drawn to
   * the right of everything it waits for.
   *
   * A cycle stops that dead: nothing in a loop ever reaches a count of zero
   * waiting, so none of it would be placed at all and those agents would
   * simply not appear. Anything left over is given a column of its own at the
   * end, which is what makes the drawing show a broken blueprint rather than
   * hide part of it.
   */
  function layers(agents, edges) {
    const list = Array.isArray(agents) ? agents : [];
    const wires = (Array.isArray(edges) ? edges : []).filter((e) => e && e.from && e.to);
    if (!list.length) return [];
    const children = Object.fromEntries(list.map((a) => [a.id, []]));
    const waitingOn = Object.fromEntries(list.map((a) => [a.id, 0]));
    for (const e of wires) {
      if (children[e.from]) children[e.from].push(e.to);
      if (waitingOn[e.to] !== undefined) waitingOn[e.to]++;
    }
    const out = [];
    let queue = list.filter((a) => waitingOn[a.id] === 0).map((a) => a.id);
    const placed = new Set();
    while (queue.length) {
      out.push(queue);
      const next = [];
      for (const id of queue) {
        placed.add(id);
        for (const child of children[id] || []) {
          waitingOn[child]--;
          if (waitingOn[child] === 0 && !placed.has(child)) next.push(child);
        }
      }
      queue = next;
    }
    const stranded = list.filter((a) => !placed.has(a.id)).map((a) => a.id);
    if (stranded.length) out.push(stranded);
    return out;
  }

  /**
   * Where to draw each agent, from the columns above.
   *
   * Each column is centred vertically against the others, so a blueprint with
   * one agent in one column and four in the next does not read as the single
   * one having fallen to the top.
   */
  function positions(agents, edges, box = {}) {
    const nodeW = Number(box.nodeW) > 0 ? Number(box.nodeW) : 150;
    const nodeH = Number(box.nodeH) > 0 ? Number(box.nodeH) : 60;
    const gapX = Number(box.gapX) >= 0 ? Number(box.gapX) : 70;
    const gapY = Number(box.gapY) >= 0 ? Number(box.gapY) : 24;
    const height = Number(box.height) > 0 ? Number(box.height) : 480;
    const out = {};
    const columns = layers(agents, edges);
    columns.forEach((column, index) => {
      const total = column.length * nodeH + (column.length - 1) * gapY;
      const startY = Math.max(24, (height - total) / 2);
      column.forEach((id, i) => {
        out[id] = { x: 40 + index * (nodeW + gapX), y: startY + i * (nodeH + gapY) };
      });
    });
    return out;
  }

  window.HCSwarmGraph = { hasCycle, breakCycles, layers, positions };
})();
