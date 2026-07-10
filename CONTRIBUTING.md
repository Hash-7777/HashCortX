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
- **HTML/CSS:** use the tokens in `src/css/vars.css`. Don't introduce new fonts or colour systems — there are already three, which is two too many. See [docs/BRAND.md](docs/BRAND.md) before picking a colour.

## Architecture rules

- `src/platform/` is the only place allowed to touch `window.__TAURI__`. Mode files reach native code through it, never directly. (There is no `core/` directory — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).)
- Mode files in `src/js/` must not import one another. Cross-module access goes through the `window._H` bridge.
- Every filesystem or shell call from a tool must go through `HC.guard.request()` — no exceptions — and is independently re-checked against the Rust denylist.
- API keys currently live in a plain-text JSON bundle in the app's own local store, **not** in the Keychain. That is a deliberate trade tied to the build being unsigned. Read [docs/SECURITY.md](docs/SECURITY.md) before changing anything about key handling.
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

Open a [Discussion](https://github.com/Hash-7777/HashCortX/discussions) instead of an issue.
