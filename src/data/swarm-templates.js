// ==============================================================
// Agent Swarm starter templates
//
// The blueprints a person can start a swarm from: each one a team of agents
// with their roles, instructions, tools and settings, and how their work is
// joined together. This is content, not behaviour — editing what a template's
// agents are told is a change to this file and nothing else.
//
// Loaded before the Agent Swarm and published as window.HCSwarmTemplates.
// ==============================================================

(function () {
  'use strict';

  const ALL_TOOL_IDS = ["memory","web_search","fetch_url","wikipedia","pubmed","datetime","calculate","code_interpreter"];
  const TEMPLATES = [
    {
      name: "Research Swarm", icon: "🔬", description: "Deep research with fact-checking and synthesis",
      topology: "pipeline", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Researcher", icon: "🔬", role: "researcher", systemPrompt: "You are a thorough researcher. Search for information, gather facts, and produce detailed research notes on the given topic.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.7 },
        { id: "a2", name: "Fact-Checker", icon: "✅", role: "validator", systemPrompt: "You are a rigorous fact-checker. Review the research notes provided and identify which claims are well-supported, uncertain, or potentially incorrect.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.3 },
        { id: "a3", name: "Summarizer",  icon: "📝", role: "writer",     systemPrompt: "You are an expert summarizer. Synthesize the research and fact-check results into a clear, well-structured, cited summary report.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Dev Squad", icon: "💻", description: "Plan → Code → Review → Test cycle",
      topology: "sequential", aggregation: "hierarchical",
      agents: [
        { id: "a1", name: "Planner",    icon: "🗺️", role: "analyst",  systemPrompt: "You are a senior software architect. Break down the feature request into a clear implementation plan with subtasks, architecture decisions, and acceptance criteria.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 },
        { id: "a2", name: "Coder",      icon: "💻", role: "coder",    systemPrompt: "You are an expert software engineer. Implement the plan provided. Write clean, production-ready code with proper error handling.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 150, retries: 2, temperature: 0.4 },
        { id: "a3", name: "Reviewer",   icon: "🔍", role: "critic",   systemPrompt: "You are a senior code reviewer. Review the code for bugs, security issues, performance problems, and style violations. Be specific and constructive.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 },
        { id: "a4", name: "Documenter", icon: "📚", role: "writer",   systemPrompt: "You are a technical writer. Write clear, concise documentation for the code including function descriptions, usage examples, and edge cases.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3","a4"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }, { from:"a2", to:"a4" }] }
    },
    {
      name: "Debate Club", icon: "⚖️", description: "Advocate → Critic → Synthesizer for decisions",
      topology: "debate", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Advocate",     icon: "⚖️", role: "writer",     systemPrompt: "You are a persuasive advocate. Present the strongest possible case in favor of the proposed position. Be thorough and convincing.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.8 },
        { id: "a2", name: "Critic",        icon: "🔥", role: "critic",     systemPrompt: "You are a sharp critic. Challenge the proposal rigorously. Identify weaknesses, risks, and counterarguments. Be direct and analytical.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.8 },
        { id: "a3", name: "Synthesizer",   icon: "🌐", role: "supervisor", systemPrompt: "You are a neutral synthesizer. Review the advocate and critic arguments and produce a balanced, nuanced final verdict with clear recommendation.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a3" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Data Analyst", icon: "📊", description: "Extract → Analyze → Report pipeline",
      topology: "pipeline", aggregation: "synthesis",
      agents: [
        { id: "a1", name: "Extractor",   icon: "📥", role: "analyst",    systemPrompt: "You are a data extraction expert. Extract all key data points, metrics, and structured information from the provided content.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.3 },
        { id: "a2", name: "Statistician",icon: "📊", role: "analyst",    systemPrompt: "You are a statistician. Analyze the extracted data, identify patterns, trends, anomalies, and compute relevant statistics.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 },
        { id: "a3", name: "Reporter",    icon: "📋", role: "writer",     systemPrompt: "You are a data reporter. Transform the statistical analysis into a clear, executive-level report with key insights and actionable recommendations.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.6 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Security Audit", icon: "🛡️", description: "Parallel scan → Consensus verdict",
      topology: "parallel", aggregation: "voting",
      agents: [
        { id: "a1", name: "Scanner",    icon: "🔭", role: "analyst",    systemPrompt: "You are a security scanner. Analyze the provided code or config for security vulnerabilities, hardcoded secrets, and unsafe patterns.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.2 },
        { id: "a2", name: "Forensics",  icon: "🔬", role: "analyst",    systemPrompt: "You are a digital forensics expert. Examine the provided content for indicators of compromise, malicious logic, and suspicious behavior.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.2 },
        { id: "a3", name: "Reporter",   icon: "📋", role: "writer",     systemPrompt: "You are a security reporter. Combine the scanner and forensics findings into a structured security report with severity ratings and remediation steps.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4 }
      ],
      dag: { nodes: ["a1","a2","a3"], edges: [{ from:"a1", to:"a3" }, { from:"a2", to:"a3" }] }
    },
    {
      name: "Content Factory", icon: "✍️", description: "Research → Outline → Write → Edit",
      topology: "sequential", aggregation: "hierarchical",
      agents: [
        { id: "a1", name: "Researcher", icon: "🔍", role: "researcher", systemPrompt: "You are a content researcher. Gather key facts, statistics, and insights on the topic to inform a high-quality article.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.7 },
        { id: "a2", name: "Outliner",   icon: "📐", role: "analyst",    systemPrompt: "You are a content strategist. Create a detailed article outline with headings, key points per section, and narrative flow.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 60, retries: 1, temperature: 0.6 },
        { id: "a3", name: "Writer",     icon: "✍️", role: "writer",     systemPrompt: "You are a skilled content writer. Write a compelling, well-structured article based on the research and outline provided.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.75 },
        { id: "a4", name: "Editor",     icon: "✏️", role: "critic",     systemPrompt: "You are a professional editor. Polish the draft for clarity, flow, grammar, and engagement. Improve without changing the core message.", tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.5 }
      ],
      dag: { nodes: ["a1","a2","a3","a4"], edges: [{ from:"a1", to:"a2" }, { from:"a2", to:"a3" }, { from:"a3", to:"a4" }] }
    },
    {
      name: "Website Builder", icon: "🌐", description: "Design → HTML → CSS/Tailwind → JS → QA preview",
      topology: "pipeline", aggregation: "concat",
      task: "Build a modern landing page website",
      agents: [
        {
          id: "wb1", name: "Designer", icon: "🎨", role: "analyst",
          systemPrompt: "You are a UI/UX designer. Given a website brief, produce a detailed written design spec: layout sections, colour palette (hex), typography, component list, and Tailwind class strategy. Do NOT write code yet — output a structured design document.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 60, retries: 1, temperature: 0.7
        },
        {
          id: "wb2", name: "HTML Builder", icon: "🌐", role: "coder",
          systemPrompt: "You are an expert HTML developer. Using the design spec, write the complete semantic HTML for the website.\n\nOutput EXACTLY this format — do not deviate:\n```html index.html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>...</title>\n  <script src=\"https://cdn.tailwindcss.com\"></script>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  ...ALL content here, no truncation...\n  <script src=\"app.js\"></script>\n</body>\n</html>\n```\n\nRules: include ALL sections in full — never truncate with '...' or comments like '<!-- rest of content -->'.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.4
        },
        {
          id: "wb3", name: "Style Agent", icon: "🎨", role: "writer",
          systemPrompt: "You are a CSS expert. Write ALL custom CSS for this website (animations, gradients, custom fonts, component overrides, anything Tailwind can't handle alone).\n\nOutput EXACTLY this format:\n```css styles.css\n/* All custom CSS here */\n:root { ... }\n/* animations, custom components, etc. */\n```\n\nRules: always output the complete file even if minimal — never skip this file.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 90, retries: 1, temperature: 0.4
        },
        {
          id: "wb4", name: "JS Developer", icon: "⚡", role: "coder",
          systemPrompt: "You are a vanilla JavaScript developer. Add ALL interactivity: mobile nav toggle, smooth scroll, animations, carousels, modals, form validation, counters, etc.\n\nOutput EXACTLY this format:\n```javascript app.js\n// All JavaScript here\ndocument.addEventListener('DOMContentLoaded', () => {\n  ...\n});\n```\n\nRules: vanilla JS only (no frameworks), always output the complete file.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.4
        },
        {
          id: "wb5", name: "QA Agent", icon: "✅", role: "validator",
          systemPrompt: "You are a web QA engineer. Review index.html, styles.css, and app.js for: broken file references, unclosed tags, undefined CSS classes, JS errors, accessibility issues.\n\nFor each file that needs fixes, output the COMPLETE corrected version using the SAME format:\n```html index.html\n...full corrected file...\n```\n```css styles.css\n...full corrected file...\n```\n```javascript app.js\n...full corrected file...\n```\n\nIf a file is already correct, say so and do NOT re-output it.",
          tools: [...ALL_TOOL_IDS], memory: "project", timeout: 120, retries: 1, temperature: 0.3
        }
      ],
      dag: {
        nodes: ["wb1","wb2","wb3","wb4","wb5"],
        edges: [
          { from:"wb1", to:"wb2" }, { from:"wb1", to:"wb3" },
          { from:"wb2", to:"wb4" }, { from:"wb3", to:"wb4" },
          { from:"wb4", to:"wb5" }
        ]
      }
    }
  ];

  window.HCSwarmTemplates = { TEMPLATES, ALL_TOOL_IDS };
})();
