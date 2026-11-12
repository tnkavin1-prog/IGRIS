# Implementation Status

Updated 2026-11-12, version 1.0.0. This report distinguishes implemented code, executed evidence, and remaining integration/hardening work. It is not a production-safety certification.

## Desktop P2/P3 delivery

| Area                 | Delivered                                                                                                                                       | Executed evidence / limits                                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vision autonomy      | Gemini REST screenshot planner, one-action loop, independent verifier, bounded iterations, cancellation, no retry of identical failed mutations | Unit tests cover mapping, replan, verification failure, approval stops, and cancellation. Real read-only model probe recognized the OCR fixture and independently verified completion. Full real-model mutation workflow remains untested.                                             |
| Browser CDP          | Visible/interactive text ranking, occlusion checks, CDP pointer clicks, native value setters, form filling, file uploads, exception propagation, deep open-shadow-root/same-origin-frame traversal, single-strategy scrolling | Isolated Chrome React/form/upload probe passed. Deep-DOM and one-scroll-per-call behaviour are unit-tested; live multi-frame pages and PDF viewer interaction remain untested.                                                                                                       |
| OCR                  | Offline Windows.Media.Ocr, word/line rectangles mapped to physical desktop coordinates                                                          | Real fixture “Gemetron OCR 123” recognized. Primary display only; 0.75 confidence is heuristic.                                                                                                                                                                                        |
| Wake word            | Opt-in English Windows speech recognizer for “Hey Gematron”, confidence threshold, cooldown, idle-only helper, foreground microphone handoff      | Synthesized-speech self-test and service tests passed. Settings enable/disable exercised in Chromium. Real microphone handoff remains untested.                                                                                                                                        |
| Audio capture        | Separate CSP-compatible AudioWorklet artifact; hardware-rate fallback/resampling                                                                | Chromium oscillator tests at 16 kHz and 48 kHz passed at about 16 capture messages/second. Physical mic and acoustic playback remain untested.                                                                                                                                         |
| Live key handling    | Permanent desktop key in main process, WebSocket header authentication                                                                          | Real `setupComplete` response with header authentication; package scan excluded the configured key. Not encrypted at rest.                                                                                                                                                             |
| Application skills   | Runtime catalog and execution tools with availability/parameter checks                                                                          | Unit coverage; external applications required. Autonomous loop blocks dangerous skill actions even with auto-approval. General voice execution still depends on the desktop approval setting.                                                                                          |
| Audit / dead modules | Metadata-only persistent SHA-256 JSONL chain; removed simulated supervisor/recovery and unused cloud relay                                      | Restart, corruption, defensive-copy, and privacy tests passed. Local tamper evidence only; corrupt logs are rejected, disk write failure disables disk appends.                                                                                                                        |
| Portable runtime     | Checkout-relative resources and installed writable state under local app data; runtime notes removed from tracking                              | Packaged archive startup used isolated data directory and real native cursor reads. Local notes remain on disk and are ignored.                                                                                                                                                        |
| Installer            | electron-builder NSIS x64, fresh native-helper compilation, bundled OCR/wake scripts/icon/dependencies                                          | Unsigned installer built. Archive/resources checked for secrets and runtime memory. Packaged archive launched through installed Electron 34 harness; visible bar/orb/full/console transitions and native resizing passed. Direct executable launch and install/uninstall are untested. |
| Updates              | Off by default, packaged-only opt-in, separate download and restart confirmations                                                               | Unit tests passed. No hosted release/download/install test; GitHub access check failed authentication. No publishing or pushing performed.                                                                                                                                             |
| HUD regression       | Restored missing bar/orb rendering and compact controls                                                                                         | Chromium and packaged-archive mode-switch probes passed, including keyboard orb expansion and missing-key error display in the browser mock.                                                                                                                                           |

## Verification scope

The packaged smoke test loaded the actual archive and bundled dependencies through an Electron 34 bootstrap, with isolated writable state and protocol registration suppressed. It did not execute the NSIS installer or validate an installed shortcut/protocol association.

Real API probes consumed Google API usage but did not mutate the user's desktop or signed-in browser accounts. OCR and synthesized wake recognition ran locally. Browser interaction probes used isolated local fixtures.

Current final typecheck, unit, lint, build, and E2E outcomes are recorded below after execution; earlier extension reports contain historical counts only.

## Separate Chrome extension

The extension has its own 52-tool catalog, semantic element registry, mandatory consequential-action approval policy, and bridge-minted ephemeral-token session manager. Its reconnect/resumption, origin/host checks, and consent policy must not be represented as desktop protections. Older extension-specific evidence is in [TEST_REPORT.md](TEST_REPORT.md).

Prompt framing is a mitigation, not proof against arbitrary prompt injection. Neither surface should be treated as a multi-user network service.

## Hardening delivery (2026-11-12)

| Area                   | Change                                                                                                                                                                                                 | Evidence                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Control API identity   | Per-install token (`X-Gematron-Control-Token`), origin classifier, loopback Host pin, identity required for `/summon`, `/focus`, `/kimi/dispatch`                                                        | Unit tests cover token validation, web-origin rejection, empty-Origin rejection, DNS-rebinding Host rejection, and an end-to-end summon with the real HTTP server. |
| Shell capability policy | Four tiers (`safe`, `caution`, `dangerous`, `blocked`) covering data destruction, security tampering, credential access, persistence, encoded payloads, and download-and-execute; compound commands analysed as a whole | 9 policy tests; blocked commands are never executed, dangerous commands require explicit human approval at plan and execution time.            |
| Approval defaults      | Automatic approval now defaults to `false` in workflow engine, memory store, Live settings, and operator goals; `dangerous` steps always gate on a human decision even when auto-approval is on            | Workflow tests cover dangerous-command gating and blocked-command failure without execution.                                                   |
| Live coordinates       | Model frame pixels are mapped to physical desktop pixels through recorded frame geometry; `coordinate_space: "physical"` opts out; window captures clear the frame                                  | 8 mapper tests plus Live tool tests for mapped clicks and new smooth-move/horizontal-scroll/key-state handlers.                                  |
| Live resilience        | Exponential-backoff reconnect, manual-disconnect suppression, resumption-handle capture and reuse, `goAway` handling, sliding-window context compression                                               | Live tests cover resumption handles, setup reuse, no reconnect after manual disconnect, and first backoff delay.                               |
| CDP deep DOM           | Text lookup, clicks, typing, and uploads traverse open shadow roots and same-origin iframes with frame-chain coordinate translation; scrolling picks one strategy (container, else one wheel event)       | 4 new CDP tests assert deep-query helpers, frame translation, single container scroll, and a single wheel fallback.                             |
| Extension approval      | Automatic approval is now opt-in on the extension too: a missing stored value can no longer switch it on, so a fresh install always asks before a consequential action             | 2 new storage unit tests plus the offline Live approval end-to-end suite, which gates a submit-like click, traps focus and honours a denial.      |
| Overlay chrome          | The overlay panel renders its drag strip with minimize-to-orb, dock-to-side-panel and close controls, and the host resizes the frame to the active view (pill, panel, orb, expanded) | Overlay end-to-end suite covers the default panel, the expanded surface, the orb, closing, and that a second request does not stack a second frame. |

## Remaining priorities

1. Validate physical microphone wake/Live ownership, playback/barge-in acoustics, mixed-monitor real actions, and complete model-driven workflows.
2. Test direct packaged executable launch, installation/uninstallation, protocol associations, signed builds, and hosted updates.

The unused cloud relay and simulated recovery/supervision modules were removed rather than marketed as working infrastructure. Role labels in audit records are informational, not RBAC. No immutable audit or drive-specific storage guarantee is claimed.

## Reverification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run dist:desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/wake-word.ps1 -SelfTest
```

Packaging does not publish. Physical microphone, model action, and installer/update checks require separate supervised testing on non-sensitive fixtures.
