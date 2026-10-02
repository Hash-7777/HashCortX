// ==============================================================
// Counting a benchmark's runs, when a task was run more than once
//
// One run of one task says little: a small model that passes a task once may
// fail it the next time with nothing changed, and a change that moves a
// benchmark by one task may be noise. Running each task more than once and
// counting passes of runs is how a number is told from noise.
//
// A task whose runs all passed is steady, one whose runs all failed is steady
// the other way, and one that did both is mixed: that count is the noise in
// the run, and the size a change has to beat.
//
// A run that never reached the agent says nothing about it, and is left out
// of every count.
//
// Pure: rows in, counts out. Checked by scripts/checks/bench-tally.mjs.
// ==============================================================

/** Whether a row is one in which the agent actually worked. */
export const didRun = (row) => !!row && !row.notRun && !(row.notes || []).some((note) => /^the run did not complete/.test(note));

/** Rows grouped by task, in the order the tasks first appear. */
export function groupRows(rows) {
  const by = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    if (!by.has(row.task)) by.set(row.task, []);
    by.get(row.task).push(row);
  }
  return [...by].map(([task, list]) => {
    const ran = list.filter(didRun);
    const passes = ran.filter((r) => r.pass).length;
    const kind = !ran.length ? 'not run' : passes === ran.length ? 'steady pass' : passes === 0 ? 'steady fail' : 'mixed';
    return { task, rows: list, ran: ran.length, passes, notRun: list.length - ran.length, kind };
  });
}

/** "2/2", "1/2", "0/2", or "-" for a task that never ran. */
export const fraction = (group) => (group.ran ? `${group.passes}/${group.ran}` : '-');

/** The counts over every group. */
export function overall(groups) {
  const sum = (f) => groups.reduce((t, g) => t + f(g), 0);
  return {
    tasks: groups.length,
    runs: sum((g) => g.ran),
    passes: sum((g) => g.passes),
    steadyPass: groups.filter((g) => g.kind === 'steady pass').length,
    steadyFail: groups.filter((g) => g.kind === 'steady fail').length,
    mixed: groups.filter((g) => g.kind === 'mixed').length,
    notRun: groups.filter((g) => g.kind === 'not run').length,
  };
}

/**
 * Two runs of the benchmark set side by side: only the tasks that ran in
 * both, each with its passes and runs on either side.
 */
export function pair(nowRows, thenRows) {
  const then = new Map(groupRows(thenRows).map((g) => [g.task, g]));
  return groupRows(nowRows)
    .filter((g) => g.ran > 0 && then.has(g.task) && then.get(g.task).ran > 0)
    .map((now) => ({ task: now.task, now, then: then.get(now.task) }));
}

const number = (n) => Number(n || 0).toLocaleString('en-US');
const mean = (list, f) => (list.length ? list.reduce((t, r) => t + (Number(f(r)) || 0), 0) / list.length : 0);

/** The table when each task was run more than once: passes of runs, and which tasks gave different answers. */
export function repeatedLines(rows) {
  const groups = groupRows(rows);
  const out = ['  task                    passes  min (mean)  steps (mean)  failed edits  result'];
  for (const g of groups) {
    const ran = g.rows.filter(didRun);
    const minutes = ran.length ? mean(ran, (r) => (r.seconds || 0) / 60).toFixed(1) : '-';
    const steps = ran.length ? mean(ran, (r) => r.steps).toFixed(1) : '-';
    out.push(`  ${g.task.padEnd(24)}${fraction(g).padEnd(8)}${minutes.padEnd(12)}${steps.padEnd(14)}${String(ran.reduce((t, r) => t + (r.failedEdits || 0), 0)).padEnd(14)}${g.kind}`);
  }
  const t = overall(groups);
  out.push(`  passed ${t.passes} of ${t.runs} runs over ${t.tasks} task${t.tasks === 1 ? '' : 's'}${t.notRun ? ` (${t.notRun} never ran)` : ''}`);
  out.push(`  every run passed: ${t.steadyPass} · no run passed: ${t.steadyFail} · both: ${t.mixed} (the noise a change has to beat)`);
  return out;
}

/**
 * One model's run set beside an earlier one: only the tasks that ran in both,
 * with every figure per run, so a task run twice can be set beside one run
 * once. `then` is a label for the earlier run.
 */
export function comparisonLines(model, nowRows, thenRows, label) {
  const shared = pair(nowRows, thenRows);
  if (!shared.length) return null;
  const side = (which) => shared.flatMap((p) => p[which].rows.filter(didRun));
  const was = side('then');
  const now = side('now');
  const passed = (list) => list.filter((r) => r.pass).length;
  const tokens = (r) => (r.tokens || {});
  const out = [`Against ${label || 'the earlier run'} · ${model} · ${shared.length} tasks in both`];
  out.push(`  passed ${passed(was)} of ${was.length} runs then, ${passed(now)} of ${now.length} now`);
  out.push(`  minutes a run ${mean(was, (r) => (r.seconds || 0) / 60).toFixed(1)} then, ${mean(now, (r) => (r.seconds || 0) / 60).toFixed(1)} now`);
  out.push(`  tokens in a run ${number(Math.round(mean(was, (r) => tokens(r).input)))} then, ${number(Math.round(mean(now, (r) => tokens(r).input)))} now`);
  if (now.some((r) => tokens(r).cacheRead) || was.some((r) => tokens(r).cacheRead)) out.push(`  tokens from a provider's cache a run ${number(Math.round(mean(was, (r) => tokens(r).cacheRead)))} then, ${number(Math.round(mean(now, (r) => tokens(r).cacheRead)))} now`);
  if (was.every((r) => r.reading != null) && now.every((r) => r.reading != null)) out.push(`  seconds reading requests a run ${mean(was, (r) => r.reading).toFixed(1)} then, ${mean(now, (r) => r.reading).toFixed(1)} now`);
  out.push(`  failed edits a run ${mean(was, (r) => r.failedEdits).toFixed(1)} then, ${mean(now, (r) => r.failedEdits).toFixed(1)} now`);
  // A task moved when its pass rate did, not when it was run a different number of times.
  const rate = (g) => g.passes / g.ran;
  for (const p of shared) if (rate(p.then) !== rate(p.now)) out.push(`  ${p.task}: ${fraction(p.then)} then, ${fraction(p.now)} now`);
  return out;
}
