# Changelog

All notable changes to Gemini Browser Live. Entries are grouped by development cycle.

## Cycle 10 — 2026-11-05 (floating overlay)

- UI: **floating overlay surface**. `Alt+Shift+S` (or the toolbar action)
  injects a `chrome-extension://` iframe over the current tab inside an open
  shadow root. The frame is pinned 20 px from the bottom-right, 404×648 px,
  collapses to a 64×64 orb, can be dragged, and closes without touching the
  page. The side panel remains the fallback where Chrome forbids injection.
- UI: approval auto-expands a collapsed orb so a pending action cannot time out
  unseen.
- Fix: one audio engine across surfaces. A `chrome.storage.session` lock with a
  5 s heartbeat and 15 s expiry stops the overlay and side panel from capturing
  the microphone twice.
- Fix: soak renderer crash. Playwright's `trace: 'retain-on-failure'` recorded a
  continuous screencast (~17 MB per 36 s) and killed the renderer after ~50
  rounds. Tracing is now off in the soak config unless `SOAK_TRACE=1`.
- Test: 4 overlay E2E tests (geometry, collapse/expand, close, idempotent
  injection) and 6 overlay-bridge unit tests; 217 unit / 23 E2E total.
- Test: soak heap sampling via CDP, per-round progress logging, explicit crash
  detection, and `--mute-audio` in every browser launch.
- Test: exported CDP accessibility tree to `docs/evidence/ax-tree.json` and
  asserted every interactive role and dialog has an accessible name.
- DX: `npm run check:ci` validates the GitHub Actions workflow against the
  package scripts before a push.
- Docs: `docs/SCREEN_READER_CHECKLIST.md`, refreshed status matrix and test
  report, Windows-only support statement.
- Release: 17 files, 639.2 kB unpacked, SHA-256 `948410df…f1474`.

## Cycle 9 — 2026-11-04

- Test: live-model prompt-injection red team (`docs/evidence/redteam-1.txt`);
  the model refused to disclose its system prompt.
- Docs: record the successful live smoke run (setup 1556 ms, first audio
  2026 ms, round trip 2231 ms).

## Cycle 8 — 2026-11-04

- Fix: `scripts/setup-windows.ps1` now uses
  `RandomNumberGenerator.Create().GetBytes()`, which exists in PowerShell 5.1;
  `.env` generation works on stock Windows.
- Docs: TypeDoc API reference generation (`npm run docs:api`).

## Cycle 7 — 2026-11-04

- Feature: bridge `--version` and `--help` flags.
- Docs: refresh release evidence after the CLI change.

## Cycle 6 — 2026-11-04

- Test: `BridgeClient` unit tests for URL construction, secret handling, and
  error paths.
- Test: 5-round soak stability smoke (`npm run test:soak`).
- Docs: `CONTRIBUTING.md` with development setup and conventions.

## Cycle 5 — 2026-11-04

- Security: reject zero-width and bidi control characters in URLs.
- Docs: architecture note on the structured-field trust boundary; document the
  `activeTab` grant requirement for visual tools.
- DX: `npm run check` (typecheck + lint + format + unit tests).

## Cycle 4 — 2026-11-04

- Trust boundary: deep-escape every string in content-script replies before they
  reach the executor; sanitize tab titles, bookmark/history titles, screenshot
  titles, and download filenames; scrub sensitive parameters from URL
  fragments; ignore messages from foreign extension senders.
- Docs: record that optional-permission integration E2E is blocked by Chrome's
  native permission dialog; refresh release evidence (SHA-256 `218f9d…8450`).

## Cycle 3 — 2026-11-04

- Accessibility: layer-ordered dialog focus stack so only the topmost modal
  traps focus (settings-over-onboarding, approval-over-settings).
- E2E: prove 24 kHz PCM decode/playback and barge-in flush through the real
  AudioWorklet (non-zero output meter, then zero).

## Cycle 2 — 2026-11-04

- Security: bind approved actions to the inspected tab and document id
  (`TAB_GONE` / `ELEMENT_STALE`).
- Security: make the untrusted page-text boundary unforgeable (escape angle
  brackets with a budget-aware loop).
- E2E: offline Live approval harness with a fake bridge and mocked Live server.
- Security: re-check downloads after redirects and `Content-Disposition`.
- CI: GitHub Actions workflow (checks, browser E2E under Xvfb, release artifact).
- Accessibility: focus trap in every modal + axe-core WCAG A/AA audit.
- Docs: refresh release evidence (SHA-256 `289079…4bff0`).

## Cycle 1 — 2026-11-03

- Initial release: complete Chrome extension, local bridge, 52-tool executor,
  Gemini Live client, audio pipeline, premium side-panel UI, docs, tests.
- Smoke evidence: setup 2024 ms, first audio 2743 ms.

---

Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is
Semantic Versioning; the current released version is 1.0.0.
