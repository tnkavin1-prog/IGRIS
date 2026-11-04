# Changelog

All notable changes to Gemini Browser Live. Entries are grouped by development cycle.

## Cycle 4 — 2026-11-04 (in progress)

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
