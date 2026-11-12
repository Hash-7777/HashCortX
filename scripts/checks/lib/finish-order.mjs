// ==============================================================
// The order of HashCoder's finishing checks, read from its source
//
// When the agent would finish, HashCoder runs its finishing checks one after
// another, and the first with something to say sends the run back. They are
// one list, `const finish = [...]` in src/modes/code/mode.js, each entry
// `{ id, words, run }`: `words` when it is asked only of an answer in words.
// This reads that list as its source has it, so a check can hold where its
// own entry stands in it and what the entry runs, and that the list is walked
// in order, stopping at the first that answers.
//
// Used by the checks of each finishing check (code-facts, code-keep,
// code-review, code-site, code-verify, code-wiring).
// ==============================================================

/** `{ ids, entry(id), walked }` for the source of src/modes/code/mode.js. */
export function finishOrder(mode) {
  const at = mode.indexOf('const finish = [');
  const end = at < 0 ? -1 : mode.indexOf('}];\n', at);
  const list = at < 0 || end < 0 ? '' : mode.slice(at, end + 3);
  const parts = list.split(/(?=\{ id: ')/).slice(1);
  const ids = parts.map((p) => /^\{ id: '(\w+)'/.exec(p)[1]);
  return {
    ids,
    /** The source of one entry, '' when there is none. */
    entry: (id) => parts.find((p) => p.startsWith(`{ id: '${id}'`)) || '',
    /** Whether `ids` stand next to each other in this order. */
    inOrder: (...want) => ids.join(',').includes(want.join(',')),
    /** The answer site walks the list in order, skips a words-only check when the answer has none, and stops at the first that answers. */
    walked: /let back = null; for \(const f of finish\) if \(\(!f\.words \|\| finalText\.trim\(\)\) && \(back = await f\.run\(finalText\)\)\) break;/.test(mode),
  };
}
