// ============================================================
// sandbox/patterns.js — the Sandbox's instant pattern scan
//
// Before any model reads pasted code, a fixed list of patterns is run over
// it. It needs no model and no network, it gives the same answer every time,
// and what it finds is handed to the model that writes the verdict — so it is
// the one part of a scan that does not depend on how good a model is. A small
// local model can call a credential stealer clean; this cannot.
//
// The list missed the three commonest things malicious code does: it read no
// credential or key file, it did not see a secret posted to a bare IP address
// or a download piped straight into a shell, and it did not see text written
// to talk the reviewing model round ("ignore all previous instructions"),
// which is aimed at exactly this kind of scanner.
//
// Each finding names its line and what matched, and every pattern is found
// once, at its first match.
//
// Pure: text in, findings out. Published as window.HCSandboxPatterns.
// Run the checks with: npm run check:sandbox-patterns
// ============================================================
(function () {
  "use strict";

  const PATTERNS = [
    { rx: /eval\s*\(/gi,                          sev: "HIGH",   msg: "eval() call — can execute arbitrary code" },
    { rx: /exec\s*\(/gi,                          sev: "HIGH",   msg: "exec() call — executes shell commands" },
    { rx: /subprocess\.call|subprocess\.Popen|os\.system/gi, sev: "HIGH", msg: "Shell execution via subprocess/os" },
    { rx: /child_process|\.exec\(|\.spawn\(/gi,   sev: "HIGH",   msg: "Node.js child_process shell execution" },
    { rx: /base64[_\-\s]?decode|atob\(|b64decode/gi, sev: "MEDIUM", msg: "Base64 decode — may hide payload" },
    { rx: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){6,}/gi, sev: "MEDIUM", msg: "Hex-encoded byte string — possible obfuscation" },
    { rx: /chr\(\d+\)\s*\+\s*chr\(\d+\)/gi,       sev: "MEDIUM", msg: "Character code concatenation — obfuscation pattern" },
    { rx: /import\s+socket|net\.connect|net\.createConnection/gi, sev: "MEDIUM", msg: "Raw socket connection" },
    { rx: /\/bin\/sh|\/bin\/bash|cmd\.exe|powershell/gi, sev: "HIGH", msg: "Shell reference — may be a shell command" },
    { rx: /(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|iex\s*\(\s*(?:new-object|iwr|invoke-webrequest)/gi, sev: "CRITICAL", msg: "Download piped straight into a shell" },
    { rx: /\.aws\/credentials|\.ssh\/id_[a-z0-9]+|\.ssh\/authorized_keys|\.netrc|\.git-credentials|\.docker\/config\.json|\.kube\/config|login\.keychain|Login Data|wallet\.dat|\.npmrc|\.pypirc/gi, sev: "CRITICAL", msg: "Reads a credential or key file" },
    { rx: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#][^\s'"`)]*)?/gi, sev: "HIGH", msg: "Talks to a bare IP address — no domain name" },
    { rx: /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)|disregard\s+(?:all\s+)?(?:previous|prior|your)\s+(?:instructions|rules)|(?:report|mark|classify)\s+(?:this|the)\s+(?:file|code|script)\s+as\s+(?:safe|clean|benign)/gi, sev: "CRITICAL", msg: "Text written to talk the reviewing model round (prompt injection)" },
    { rx: /stratum\+tcp|mining\.pool|xmrig|monero|cryptonight/gi, sev: "CRITICAL", msg: "Cryptomining indicator" },
    { rx: /reverse.?shell|bind.?shell|meterpreter|metasploit/gi, sev: "CRITICAL", msg: "Reverse/bind shell reference" },
    { rx: /keylog|keystroke|GetAsyncKeyState|SetWindowsHookEx/gi, sev: "CRITICAL", msg: "Keylogger indicator" },
    { rx: /HKEY_LOCAL_MACHINE|HKLM|RegSetValue|RegCreateKey/gi, sev: "HIGH", msg: "Windows registry modification" },
    { rx: /startup|autorun|\.lnk|currentversion\\run/gi, sev: "HIGH", msg: "Persistence mechanism — startup/autorun" },
    { rx: /wget\s+http|curl\s+-[sS].*http|urllib\.request|requests\.get/gi, sev: "MEDIUM", msg: "Remote file download" },
    { rx: /os\.remove|shutil\.rmtree|rm\s+-rf|del\s+\/[sqf]/gi, sev: "MEDIUM", msg: "Destructive file deletion" },
    { rx: /Encrypt|AES\.|Fernet\.|encrypt\s*\(/gi, sev: "LOW",  msg: "Encryption — possible ransomware if combined with file ops" },
    { rx: /\b(4444|31337|12345|6667|9050)\b/g,   sev: "MEDIUM", msg: "Known malware port number in code" },
  ];

  /** Every pattern found in `code`, at its first match: { sev, msg, match, line }. */
  function scan(code) {
    const text = String(code || "");
    const findings = [];
    for (const { rx, sev, msg } of PATTERNS) {
      rx.lastIndex = 0;
      const m = rx.exec(text);
      if (m) findings.push({ sev, msg, match: m[0], line: text.slice(0, m.index).split("\n").length });
    }
    return findings;
  }

  window.HCSandboxPatterns = { PATTERNS, scan };
})();
