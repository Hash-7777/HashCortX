<!--
Read CONTRIBUTING.md first. For anything non-trivial, open an issue before
writing code — a short conversation about the approach saves rework.
-->

## What this changes

<!-- One or two sentences. What is different after this PR, from a user's point of view? -->

## Why

<!-- Link the issue if there is one: Fixes #123 -->

## How I tested this

<!--
Required. Not "it builds" — what did you actually run, and what did you see?
If the change touches the UI, say which mode you exercised and what you clicked.
If it touches native calls, say whether the permission dialog appeared.
-->

## Checklist

- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] `cargo fmt` has been run, if I touched Rust.
- [ ] Mode files in `src/js/` do not import one another; cross-module access goes through `window._H`.
- [ ] Only `src/platform/` touches `window.__TAURI__`.
- [ ] Any new filesystem or shell call goes through `HC.guard.request()`.
- [ ] I added no telemetry, analytics, or network calls to anything other than a provider the user configured.
- [ ] I updated `README.md`, `MODES_GUIDE.txt` or the files in `docs/` if this changes user-visible behaviour.
- [ ] I updated `CHANGELOG.md` under `## [Unreleased]`.

## Notes for the reviewer

<!--
Anything you are unsure about, shortcuts you took, or things you deliberately
left out of scope. Say so here rather than leaving it to be discovered.
-->
