# Vendored JavaScript libraries

The libraries in this folder ship with the app and load from its own origin.
None of them is fetched from a CDN at runtime.

## What is recorded here

| Files | Library | Version | Licence | Compared with the published package |
|---|---|---|---|---|
| `mermaid.min.js` | Mermaid | 11.17.2 | MIT | Yes, byte for byte |
| `three/` | three.js | r184 | MIT | `three.module.min.js` only, by checksum |
| `marked.min.js` | marked | 15.0.7 | MIT | No |
| `highlight.min.js` | Highlight.js | 11.11.1 | BSD-3-Clause | No |
| `highlight-github-dark.min.css` | Highlight.js theme | not stated | not stated | No |
| `purify.min.js` | DOMPurify | 3.4.2 | Apache 2.0 and MPL 2.0, as stated | No |
| `pdf.min.js`, `pdf.worker.min.js` | pdf.js | 3.11.174 | Apache 2.0 | No |
| `jspdf.umd.min.js` | jsPDF | 2.5.1 | MIT, plus notices of its own parts | No |
| `xlsx.full.min.js` | SheetJS | 0.20.3 | not stated | No |

**How this was found.** Mermaid was taken from the npm registry for this
record and compared with the package. For the others, the version and licence
are what each file states about itself: in its header, or, where the header
has no version, in its code. Those files have not been compared with the
published packages, so a copy changed after it was made would not show here.
Each licence below is quoted as the file gives it. The notices inside each
file are left in place.

## marked 15.0.7

- **File:** `marked.min.js`. Version from its header.
- **Licence, as the file states it:** "Copyright (c) 2011-2025, Christopher
  Jeffrey. (MIT Licensed)", with https://github.com/markedjs/marked.
- **Used by:** Markdown in replies (`src/js/app.js`, `src/js/markdown-safe.js`,
  Coder and the Swarm workspace).

## Highlight.js 11.11.1

- **File:** `highlight.min.js`. Version and build from its header:
  "Highlight.js v11.11.1 (git: 08cb242e7d)".
- **Licence, as the file states it:** "(c) 2006-2024 Josh Goebel and other
  contributors. License: BSD-3-Clause".
- **Theme:** `highlight-github-dark.min.css`. Its header names it the GitHub
  Dark theme and gives no version and no licence. Highlight.js ships its
  themes with the library, but this file does not say which release it came
  from.
- **Used by:** code blocks in chat, Coder and the Sandbox.

## DOMPurify 3.4.2

- **File:** `purify.min.js`. Version from its header.
- **Licence, as the file states it:** "(c) Cure53 and other contributors |
  Released under the Apache license 2.0 and Mozilla Public License 2.0",
  pointing to github.com/cure53/DOMPurify/blob/3.4.2/LICENSE for the terms.
- **Used by:** cleaning rendered replies before they are shown
  (`src/js/app.js`, Finance).

## pdf.js 3.11.174

- **Files:** `pdf.min.js` and its worker, `pdf.worker.min.js`. The version is
  in the code of both; neither header gives it.
- **Licence, as both files state it:** "Copyright 2023 Mozilla Foundation.
  Licensed under the Apache License, Version 2.0", with
  http://www.apache.org/licenses/LICENSE-2.0.
- **Used by:** reading PDFs (`src/js/pdf-text.js`, Coder, Finance).

## jsPDF 2.5.1

- **File:** `jspdf.umd.min.js`. Version and build date from its header.
- **Licence, as the file states it:** the MIT permission notice in full, for
  James Hall, yWorks GmbH and the other contributors named in the header.
- **Parts with their own notices**, kept in place in the file: 23 more MIT
  notices for plugins and bundled code; a BSD-style notice from Adobe Systems;
  FPDF's notice, which places no restriction on use; a colour parser whose
  notice reads "Use it if you like it"; and an MD5 routine whose notice says
  its author specifies no particular licence.
- **Used by:** exporting PDF files (`src/js/export-format.js`,
  `src/js/app.js`).

## SheetJS 0.20.3

- **File:** `xlsx.full.min.js`. The version is in its code. The app used to
  load this file from
  `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` and
  vendored it in commit `e9db7e2`.
- **Licence:** the file names none. Its only notice is "(C) 2013-present
  SheetJS -- http://sheetjs.com". SheetJS publishes its Community Edition
  under Apache 2.0; that has not been confirmed from the package.
- **Used by:** Finance, which loads it only when a spreadsheet is read.

## three.js r184

- **Files:** `three/three.core.min.js`, `three/three.module.min.js`, five
  files in `three/examples/` (GLTFExporter, GLTFLoader, OrbitControls,
  RoomEnvironment, TransformControls) and two in `three/utils/`
  (BufferGeometryUtils, SkeletonUtils).
- **Version:** `three.core.min.js` states revision 184. The app used to load
  `three@0.184.0` from a CDN and vendored it in commit `e9db7e2`. In commit
  `8442c13`, `three.module.min.js` was matched to the published r184 build by
  checksum, and the core and the two utils files were added from that
  release.
- **Licence, as the two core files state it:** "Copyright 2010-2026 Three.js
  Authors. SPDX-License-Identifier: MIT". The example and utils files carry
  no notice of their own.
- **Used by:** 3D Forge.

## Mermaid 11.17.2

- **Source:** the npm package `mermaid@11.17.2`. The tarball's integrity is
  `sha512-V6K3C8EBdEsPFZXSKMJe6ppQOENxuHARr9GvHX4hh47lAbhMRD9qf4oEK7LoaRQxULMa80/qt5gHO73aCleBBg==`,
  the value the registry publishes for that version.
- **File:** `package/dist/mermaid.min.js`, copied unchanged. SHA-256
  `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8`.
- **Why this version:** it is the newest 11.x release, and it carries the
  upstream security fixes published since 11.4.1, the version it replaced.
  12.0.0 is a new major version and was not taken.
- **Used by:** chat, to draw `mermaid` code blocks in a reply, with
  `securityLevel: "strict"` (`src/js/app.js`).
- **Licence:** MIT. The notice below is reproduced as the licence requires.
  The bundle also carries the licence comments of the libraries built into
  it, at the end of the file.

```
The MIT License (MIT)

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
