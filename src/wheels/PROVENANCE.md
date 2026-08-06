# Vendored Python wheels

These are the packages the Python sandbox installs so the agent can produce
real Word, Excel and PDF files. They are shipped with the app rather than
fetched at runtime.

## Why they are here rather than downloaded

Pyodide bundles pandas, numpy, matplotlib, pillow, lxml and typing_extensions
in its own distribution, so those arrive with the runtime. These five are not
in that distribution, and `micropip` fetches anything missing from PyPI.

PyPI is not in the app's `connect-src`, so every one of those installs was
refused. The result was silent: the install failure was caught and logged, the
sandbox came up without the packages, and the first `from docx import Document`
failed with an import error — while the tool description and the README both
promised Word, Excel and PDF output.

Adding PyPI to the policy would have fixed the symptom and handed the sandbox
the ability to install any package a model asked for. Vendoring them instead
follows the rule already in `docs/ARCHITECTURE.md`: *before adding a host to
the policy, vendor the library*. It also means the Python sandbox needs the
network only for the Pyodide runtime itself, not for its packages.

`src/core/sandbox/pyodide.js` installs these by path, from the app's own
origin. No PyPI, no extra host in the policy.

## What is here

| Package | Version | Licence | Why |
|---|---|---|---|
| `python_docx` | 1.2.0 | MIT | Word documents |
| `openpyxl` | 3.1.5 | MIT | Excel workbooks |
| `et_xmlfile` | 2.0.0 | MIT | required by openpyxl |
| `reportlab` | 5.0.0 | BSD (Copyright (c) 2000-2025, ReportLab Inc.) | PDF documents |
| `charset_normalizer` | 3.4.9 | MIT | required by reportlab |

All five are pure-Python wheels (`py3-none-any`), which is what Pyodide can
install without a compiler. Every licence permits redistribution; this
repository ships under MIT.

## Updating one

Take the `py3-none-any` wheel from PyPI, drop it in, delete the old file and
update the version in the table above and the filename list in
`src/core/sandbox/pyodide.js`. Then run a **production** build and confirm the
sandbox still produces a `.docx`, an `.xlsx` and a `.pdf` — `tauri dev`
applies no Content Security Policy, so it cannot tell you whether this works.
