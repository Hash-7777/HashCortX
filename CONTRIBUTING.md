# Contributing to HashCortx

Thanks for considering a contribution. HashCortx is a local-first desktop AI app, and contributions that respect that principle (no telemetry, no required cloud services, user data stays local) are the most welcome.

## Before you start

- **Open an issue first** for anything non-trivial. A 5-minute conversation about the approach saves both of us hours of rework if your PR isn't a fit.
- Bug fixes with a clear repro can skip straight to a PR.
- Cosmetic-only changes (formatting, renaming, doc tweaks) are unlikely to be merged unless they fix something concretely confusing.

## Development setup

```bash
git clone https://github.com/Hash-7777/HashCortX.git
cd HashCortX
npm install
npm run tauri dev
```

Requirements: macOS, Node 18+, Rust toolchain (`rustup`), Xcode Command Line Tools.

Build a distributable:
```bash
npm run tauri build
# → src-tauri/target/release/bundle/dmg/
```

## Code style

- **JS:** match what's already there — no new linter, no new formatter. The codebase is plain JS, no TypeScript, no bundler.
- **Rust:** `cargo fmt` before committing.
- **HTML/CSS:** match the existing terminal-green / JetBrains Mono aesthetic. Don't introduce new fonts or color systems.

## Architecture rules

- `core/` modules must never import from Tauri. All native calls go through `src/platform/index.js`.
- Every filesystem or shell call from a tool must go through `HC.guard.request()` — no exceptions.
- API keys must use `keychain.rs`, never localStorage or plaintext config files.
- No telemetry. No analytics. No "phone home." Ever.

## Pull requests

- Keep PRs focused. One feature or one fix per PR.
- Update `README.md` or `MODES_GUIDE.txt` if your change affects user-visible behavior.
- Include a "How I tested this" section in the PR description.
- Expect review feedback. Drive-by PRs that ignore the architecture rules above will be closed.

## What I'm *not* looking for

- Switching to a different framework (React, Vue, Svelte, etc.) — the plain-JS choice is deliberate.
- Bundlers, transpilers, or build steps beyond what Tauri already does.
- Telemetry of any kind, including "anonymous" or "opt-in" analytics.
- AI-generated PRs that don't show evidence of human review and testing.

## Questions

Open a [Discussion](https://github.com/Hash-7777/HashCortX/discussions) 
