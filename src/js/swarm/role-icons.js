// ==============================================================
// The mark beside an agent, drawn
//
// An agent used to carry an icon typed as an emoji: a microscope, a laptop, a
// tick. Starter teams saved them, the God Agent was shown one in its schema,
// and the Result view drew them beside every turn — so a workspace that is
// otherwise line art had colour pictures in it, at whatever weight and
// baseline the platform font gave them.
//
// A mark is drawn from the agent's role instead, from this one set, so the
// canvas, the role picker, the template list and a run's conversation all show
// the same thing and nothing types a picture.
//
// Pure: a role in, SVG out. Loaded before the Agent Swarm and published as
// window.HCSwarmRoleIcons. Checked by scripts/checks/swarm-role-icons.mjs.
// ==============================================================

(function () {
  'use strict';

  /** Every role's mark, at 16 by 16, stroked in the colour around it. */
  const ROLE_SVGS = {
    researcher: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="6.5" cy="6.5" r="4.5"/><path d="m14 14-3.2-3.2"/></svg>`,
    writer:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M11 2.5a1.77 1.77 0 0 1 2.5 2.5L5 13.5 2 14l.5-3Z"/></svg>`,
    critic:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M14 2H2v9h5l3 3v-3h4Z"/><path d="M6 6h4M6 8.5h2"/></svg>`,
    coder:      `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="m5 4-3 4 3 4M11 4l3 4-3 4M9 2l-2 12"/></svg>`,
    analyst:    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="2" y="9" width="3" height="5" rx="1"/><rect x="6.5" y="6" width="3" height="8" rx="1"/><rect x="11" y="3" width="3" height="11" rx="1"/></svg>`,
    validator:  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M8 1 9.7 5.5H14l-3.8 2.8 1.5 4.5L8 10 4.3 12.8l1.5-4.5L2 5.5h4.3Z"/></svg>`,
    supervisor: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
    custom:     `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>`,
    aggregator: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M4 4h8M4 8h8M4 12h8"/><circle cx="2" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="2" cy="12" r="1" fill="currentColor" stroke="none"/></svg>`,
    planner:    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 7l2 2 4-4"/></svg>`,
  };
  const ORDER = ["researcher","writer","critic","coder","analyst","validator","supervisor","planner","aggregator","custom"];

  /** The mark for a role, or the plain one when a team names a role of its own. */
  function svgFor(role) {
    return ROLE_SVGS[String(role || '').trim().toLowerCase()] || ROLE_SVGS.custom;
  }

  /** The mark for the person asking, beside their turns. */
  const YOU_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.2a5 5 0 0 1 10 0"/></svg>`;

  /**
   * The mark as an element, ready to put in a page.
   *
   * The markup written here is this file's own, never a word from a model or a
   * saved team, which is why it is written here and not where it is shown:
   * everywhere it is used keeps its rule that only one place writes markup.
   */
  function nodeFor(role) {
    const host = document.createElement('span');
    host.innerHTML = role === 'you' ? YOU_SVG : svgFor(role);
    return host.firstElementChild;
  }

  window.HCSwarmRoleIcons = { ROLE_SVGS, ORDER, svgFor, YOU_SVG, nodeFor };
})();
