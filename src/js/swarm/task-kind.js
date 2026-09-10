// ==============================================================
// What kind of task a swarm was given, and what that asks of it
//
// When the God Agent designs a team, and when a run is started, the task is
// read for what kind of work it is — building a site, debugging, research,
// analysis — and whether it is a big one. That decides how many agents a team
// gets, which files and reports it owes, the quality rules it is held to, and
// how much each agent may pass to the next.
//
// Moved out of the Agent Swarm unchanged, so the readings can be checked on
// their own.
//
// Pure: text in, plain values out. No DOM, no storage, no network.
//
// Loaded before the Agent Swarm and published as window.HCSwarmTaskKind.
// Checked by scripts/checks/swarm-task-kind.mjs.
// ==============================================================

(function () {
  'use strict';

  // Whether a task asks for something to be built for the web.
  //
  // It used to look for a word — html, css, javascript, backend — anywhere in
  // the task, so "What is the difference between HTML and CSS?" and a report
  // on the JavaScript market were read as website builds, while "A one-page
  // site for a tea shop" and "a to-do app in React" were not. It now asks:
  // is the task a question or a piece of writing, which is never a build; and
  // is the thing to be made — or the thing the task names — built for the web.
  // "Design a logo for my website" mentions a website but makes a logo.
  const THING = "(web\\s*sites?|web\\s*pages?|webpages?|web\\s*apps?|landing\\s*pages?|home\\s*pages?|one-page|single-page|sites?|apps?|front-?ends?|back-?ends?|dashboards?|portfolios?|storefronts?|online\\s+(shop|store)s?|games?|forms?|calculators?|widgets?|html|css|javascript|react|vue|svelte)\\b";
  // Up to three words between the verb and the thing, none of them a word
  // like "for" or "about" that moves on to something else.
  const FILLER = "((?!(about|on|of|for|with|in|to|from|by|like)\\s)[\\w'’-]+\\s+){0,3}";
  const SAYS_SO = /\b(code only|output code|full working)\b/i;
  const ASKS = /^\s*(what|why|how|when|where|who|which|whose|explain|describe|compare|summari[sz]e|research|analy[sz]e|review|list|tell me|teach me|is|are|was|were|does|do|did)\b/i;
  const WRITES = /\b(write|make|create|draft|prepare|produce|generate)\s+(me\s+)?(an?\s+|the\s+|some\s+|my\s+|our\s+)?([\w-]+\s+){0,2}(reports?|essays?|articles?|blog\s*posts?|summar(y|ies)|guides?|tutorials?|overviews?|proposals?|plans?|strateg(y|ies)|emails?|letters?|poems?|stor(y|ies)|papers?|outlines?|presentations?|slides|pitch(es)?|analys[ie]s|comparisons?|lists?|tables?|spreadsheets?|schedules?|recipes?|itinerar(y|ies)|budgets?|checklists?|resumes?|cvs?)\b/i;
  const MAKES_IT = new RegExp(`\\b(build|make|create|code|develop|design|generate|write|implement|set\\s*up|scaffold|rebuild|redo|redesign|need|want)\\s+(me\\s+|us\\s+)?(an?\\s+|the\\s+|my\\s+|our\\s+|some\\s+)?${FILLER}${THING}`, "i");
  const NAMES_IT = new RegExp(`^\\s*((an?|my|our)\\s+${FILLER}${THING}|(web\\s*sites?|web\\s*pages?|landing\\s*pages?|web\\s*apps?|portfolios?|dashboards?|online\\s+(shop|store)s?)\\b)`, "i");

  function isCodeBuildTask(desc) {
    const d = String(desc || "");
    if (SAYS_SO.test(d)) return true;
    if (ASKS.test(d) || WRITES.test(d)) return false;
    return MAKES_IT.test(d) || NAMES_IT.test(d);
  }

  function isBigAssignment(desc) {
    return isCodeBuildTask(desc) || /\b(big|large|complex|production|full working|full-stack|full stack|complete|entire|multi-agent|swarm|polish|revise|enterprise|app|platform|system)\b/i.test(desc || "");
  }

  function recommendedAgentBounds(desc) {
    if (isCodeBuildTask(desc)) return { min: 5, target: 6, max: 7 };
    if (isBigAssignment(desc)) return { min: 4, target: 5, max: 7 };
    return { min: 3, target: 4, max: 5 };
  }

  function classifyTask(desc) {
    const d = String(desc || "").toLowerCase();
    if (isCodeBuildTask(d)) return "code_build";
    if (/debug|fix|bug|error|stack trace|broken/i.test(d)) return "debugging";
    if (/security|audit|malware|vulnerab|threat|sandbox/i.test(d)) return "security";
    if (/data|csv|spreadsheet|chart|analytics|analysis|dataset/i.test(d)) return "data_analysis";
    if (/research|find|compare|summar|report|paper|news/i.test(d)) return "research";
    if (/strategy|plan|business|market|launch|roadmap|decision/i.test(d)) return "strategy";
    if (/write|copy|brand|creative|story|content/i.test(d)) return "creative";
    return isBigAssignment(d) ? "complex_planning" : "general";
  }

  function taskRequiresBackend(desc) {
    return /\b(auth|login|signup|account|admin|dashboard|database|db|order\s+(submission|management|tracking|storage)|inventory|checkout|payment|stripe|api|cms|booking|server|backend|back-end)\b/i.test(desc || "");
  }

  function artifactContractsForTask(desc) {
    const category = classifyTask(desc);
    if (category === "code_build") {
      const artifacts = [
        { name: "implementation_brief.json", ownerRole: "planner", required: true, format: "compact JSON brief" },
        { name: "index.html", ownerRole: "coder", required: true, format: "complete fenced html file" },
        { name: "styles.css", ownerRole: "coder", required: true, format: "complete fenced css file" },
        { name: "app.js", ownerRole: "coder", required: true, format: "complete fenced javascript file" },
        { name: "visible_image_manifest.json", ownerRole: "coder", required: true, format: "remote https image URLs plus alt text and fallback behavior" },
        { name: "interaction_manifest.json", ownerRole: "coder", required: true, format: "cart, buttons, animations, and localStorage behavior" },
        { name: "validation_fixes.md", ownerRole: "validator", required: true, format: "patch list or corrected full code blocks" },
        { name: "final_code_bundle", ownerRole: "supervisor", required: true, format: "final complete code blocks only" },
      ];
      if (taskRequiresBackend(desc)) artifacts.splice(4, 0, { name: "server.js", ownerRole: "coder", required: true, format: "complete fenced backend file" });
      else artifacts.splice(4, 0, { name: "NO_BACKEND_NEEDED", ownerRole: "coder", required: true, format: "literal backend decision" });
      return artifacts;
    }
    if (category === "data_analysis") return [
      { name: "analysis_plan.json", ownerRole: "planner", required: true, format: "questions, metrics, assumptions" },
      { name: "findings.md", ownerRole: "analyst", required: true, format: "evidence-backed findings" },
      { name: "final_analysis.md", ownerRole: "supervisor", required: true, format: "single reconciled answer" },
    ];
    return [
      { name: "work_plan.json", ownerRole: "planner", required: true, format: "deliverables, assumptions, risks, acceptance criteria" },
      { name: "specialist_outputs", ownerRole: "specialist", required: true, format: "compact specialist findings" },
      { name: "final_answer", ownerRole: "supervisor", required: true, format: "single reconciled user-visible answer" },
    ];
  }

  function qualityGatesForTask(desc) {
    const gates = ["final output directly satisfies the user request", "no duplicated intermediate reports", "assumptions and risks are explicit when relevant"];
    if (isCodeBuildTask(desc)) gates.push(
      "code-only final output when requested",
      "all referenced files are present",
      "product/gallery images use visible https URLs or inline SVG/data URI fallbacks; no broken placeholder/local image paths",
      "cart interactions are wired end-to-end with add/remove/quantity/total/count and localStorage persistence when a cart is requested",
      "animations are implemented with CSS transitions/keyframes or requestAnimationFrame and respect reduced-motion",
      "final code is integrated; HTML references the exact CSS/JS filenames that are output",
      "no DOCX/PDF/report generation for website code",
      "responsive/mobile layout considered",
      "no placeholder content unless intentionally marked"
    );
    if (taskRequiresBackend(desc)) gates.push("backend need is justified and API/data flow is coherent");
    return gates;
  }

  function budgetControlsForTask(desc) {
    return {
      maxContextCharsPerDependency: isCodeBuildTask(desc) ? 6000 : 4000,
      maxIntermediateWords: isBigAssignment(desc) ? 900 : 650,
      maxToolRounds: 8,
      finalOutputOwnerOnly: true,
      allowToolUseByDefault: !isCodeBuildTask(desc),
    };
  }

  window.HCSwarmTaskKind = {
    isCodeBuildTask, isBigAssignment, recommendedAgentBounds, classifyTask, taskRequiresBackend,
    artifactContractsForTask, qualityGatesForTask, budgetControlsForTask,
  };
})();
