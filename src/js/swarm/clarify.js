// ==============================================================
// Asking before building something personal
//
// A team asked for "a portfolio website for a software developer" has nothing
// to build it from: no name, no projects, no contact. It used to be told to
// invent realistic ones, so the site belonged to a made-up person and every
// detail had to be found and replaced by hand.
//
// So before a run starts, the task is looked at once for facts only the person
// asking can give — their name, their work, their business — and when some are
// missing they are asked, the way a coding assistant asks before it guesses.
// What they answer goes to every agent as fact; what they leave blank becomes a
// clearly marked placeholder, never an invention. A task that needs nothing
// personal starts straight away.
//
// Deciding what to ask takes one small model call. When no model answers, a
// short list written here is asked for the kinds of task that are always
// personal — a portfolio, a CV — so the run still does not guess.
//
// Pure: text in, text out. Loaded before the Agent Swarm and published as
// window.HCSwarmClarify. Checked by scripts/checks/swarm-clarify.mjs.
// ==============================================================

(function () {
  'use strict';

  const MAX_QUESTIONS = 6;

  /** Tasks that are about a particular person or business by their nature. */
  // Spelling is forgiven where it is commonly slipped: portofolio, portfollio.
  const PERSONAL = /port\w{0,2}f\w{0,2}lio|\b(?:resume|résumé|cv)\b|curriculum vitae|cover letter|about me|personal (?:site|website|page|brand|blog)|my (?:own )?(?:business|company|shop|store|restaurant|cafe|café|clinic|practice|studio|agency|brand|startup|band|wedding|family|team|product|app|portfolio|resume|cv)|linkedin|biography|\bbio\b|wedding|invitation/i;

  const SYSTEM = `You decide whether a task needs facts that only the person who asked can give, before a team of AI agents builds it.
Ask ONLY for details that are personal to them or specific to their situation and that the team would otherwise have to invent: their name, contact details and links, their own work, projects, experience and skills, their company or brand, their products and prices, dates, places, the people involved, and choices only they can make when the result depends on them.
Do not ask about anything the task already states. Do not ask about what the team can decide well itself: layout, structure, sections, wording, technology, design, colours unless the person must choose them.
Return only JSON, no markdown:
{"questions":[{"id":"short_id","question":"One short question","hint":"an example of an answer"}]}
At most ${MAX_QUESTIONS} questions, the most important first. If nothing personal is missing, return {"questions":[]}.`;

  /** The call that decides what to ask. */
  function messages(task) {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Task: ${String(task || '').trim()}` },
    ];
  }

  const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * The questions in a model's answer, or null when the answer could not be
   * read at all — which is different from a readable answer asking nothing.
   */
  function parseQuestions(text) {
    const raw = String(text || '');
    // A fenced answer is read through the app's one fence reader, js/fences.js.
    const fenced = window.HCFences ? window.HCFences.jsonBlock(raw) : null;
    const body = fenced != null ? fenced : raw;
    const start = body.search(/[[{]/);
    if (start < 0) return null;
    const end = body.lastIndexOf(body[start] === '{' ? '}' : ']');
    let parsed = null;
    try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { parsed = null; }
    if (parsed === null) return null;
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.questions) ? parsed.questions : null);
    if (!list) return null;
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const question = clean(typeof item === 'string' ? item : item && item.question, 240);
      if (question.length < 4 || seen.has(question.toLowerCase())) continue;
      seen.add(question.toLowerCase());
      const id = clean(item && item.id, 40).replace(/[^\w-]/g, '_') || `q${out.length + 1}`;
      out.push({ id, question, hint: clean(item && item.hint, 120) });
      if (out.length === MAX_QUESTIONS) break;
    }
    return out;
  }

  /** Whether a task is personal by its nature, whatever a model says. */
  const looksPersonal = (task) => PERSONAL.test(String(task || ''));

  /** What to ask when no model could be asked, for a task that is plainly personal. */
  function fallbackQuestions(task) {
    if (!looksPersonal(task)) return [];
    return [
      { id: 'name', question: 'What name should it use?', hint: 'Sara Ahmed' },
      { id: 'about', question: 'What do you do, in a sentence or two?', hint: 'Backend engineer building payment systems in Go' },
      { id: 'work', question: 'Which projects, work or achievements should it show, with links?', hint: 'Ledger API — github.com/you/ledger' },
      { id: 'skills', question: 'Which skills or services should it list?', hint: 'Go, PostgreSQL, Kubernetes' },
      { id: 'contact', question: 'How should people contact you?', hint: 'email, LinkedIn, GitHub' },
    ];
  }

  /**
   * The task every agent is given: the person's words, then what they
   * answered as fact, then what they left blank as placeholders.
   */
  function taskWithAnswers(task, answered) {
    const base = String(task || '').trim();
    const list = (Array.isArray(answered) ? answered : []).filter((a) => a && clean(a.question, 240));
    if (!list.length) return base;
    const given = list.filter((a) => clean(a.answer, 4000));
    const blank = list.filter((a) => !clean(a.answer, 4000));
    const parts = [base];
    if (given.length) {
      parts.push(`Details from the person who asked. Use them exactly, and do not add to them or invent others of the same kind:\n${given.map((a) => `- ${clean(a.question, 240)} ${String(a.answer).trim()}`).join('\n')}`);
    }
    if (blank.length) {
      parts.push(`Not given: ${blank.map((a) => clean(a.question, 240)).join(' ')} Where one of these is needed, write a clearly marked placeholder in square brackets, such as [Your name], for the person to fill in. Never invent it.`);
    }
    return parts.join('\n\n');
  }

  window.HCSwarmClarify = { MAX_QUESTIONS, messages, parseQuestions, looksPersonal, fallbackQuestions, taskWithAnswers };
})();
