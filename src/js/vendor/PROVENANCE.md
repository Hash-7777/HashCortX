# Vendored JavaScript libraries

The libraries in this folder ship with the app and load from its own origin.
None of them is fetched from a CDN at runtime.

## What is recorded here

| File | Library | Version | Licence |
|---|---|---|---|
| `mermaid.min.js` | Mermaid | 11.17.2 | MIT |

The other files in this folder were added before this record was kept. Their
versions and licences are still to be written down here.

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
