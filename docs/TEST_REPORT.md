# Test Report

**Date:** 2026-11-04
**Build under test:** Gemini Browser Live v1.0.0
**Platform:** Windows 11, Node.js v24.18.0, npm 11.16.0, Chromium 156 (Playwright bundle)

This report contains only results that were actually produced by running the commands below. Where something was not tested, it says so.

---

## 1. Results summary

| Check            | Command                      | Result                                  | Evidence                       |
| ---------------- | ---------------------------- | --------------------------------------- | ------------------------------ |
| TypeScript       | `node scripts/typecheck.mjs` | ✅ Pass — 3 projects                    | Console output                 |
| Lint             | `npx eslint .`               | ✅ Pass — 0 errors, 0 warnings          | Console output                 |
| Formatting       | `npx prettier --check .`     | ✅ Pass                                 | Console output                 |
| Unit tests       | `npx vitest run`             | ✅ 16 files, 192 tests                  | Console output                 |
| E2E tests        | `npx playwright test`        | ✅ 17 tests, 42.6 s                     | `test-results/`                |
| Production build | `npm run release`            | ✅ 12 files, 625.0 kB                   | `release/chrome-extension/`    |
| ZIP integrity    | Expand + SHA-256 compare     | ✅ 12/12 files match, 0 mismatches      | `release/SHA256SUMS.txt`       |
| Live API smoke   | `npm run smoke:live`         | ✅ Setup 2,024 ms, first audio 2,743 ms | `docs/evidence/smoke-live.log` |

No test was skipped or marked as passing without execution.

### 1.1 Continuous integration

`.github/workflows/ci.yml` defines three jobs:

| Job       | Runs                                                        |
| --------- | ----------------------------------------------------------- |
| `checks`  | `npm ci`, typecheck, lint, format check, unit tests         |
| `e2e`     | Playwright Chromium install, `xvfb-run npm run test:e2e`    |
| `release` | `npm run release`, uploads the extension ZIP as an artifact |

**Status:** the workflow file is committed and Prettier-validated, but it has **not executed on GitHub** because this repository has no remote configured. Its status is therefore unverified; it is not claimed as a passing CI run.

---

## 2. Static checks

### TypeScript

```
▶ typecheck shared
✔ shared

▶ typecheck local-bridge
✔ local-bridge

▶ typecheck chrome-extension
✔ chrome-extension

All projects typecheck cleanly.
```

Exit code 0. The script runs `tsc --noEmit` per workspace against `tsconfig.base.json` with strict settings.

### ESLint

```
npx eslint .
(no output)
ESLINT_EXIT=0
```

Flat config covers TypeScript, React hooks, Node scripts, tests, and the bridge. No suppressions were added to make this pass.

### Prettier

```
Checking formatting...
All matched files use Prettier code style!
```

Markdown, TypeScript, TSX, MJS, JSON, CSS, and HTML are covered. Generated artifacts and evidence logs are ignored.

---

## 3. Unit tests

**Command:** `npx vitest run`
**Result:** 16 files passed, 192 tests passed, 6.39 s

| Suite                                  | Tests | What it covers                                                                                       |
| -------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `shared/safety.test.ts`                | 24    | Hard blocks, risk keywords, URL validation, untrusted-text framing, Unicode tokenisation             |
| `shared/prompt-injection.test.ts`      | 17    | Delimiter forgery, nested/forged blocks, role tags, controls, lookalike tags, inline-title escape    |
| `shared/catalog.test.ts`               | 12    | 52 unique tools, schema completeness, approval policy, descriptions                                  |
| `shared/json-schema.test.ts`           | 12    | Runtime validation, required fields, types, enums, array bounds, Gemini schema derivation            |
| `bridge/config.test.ts`                | 10    | `.env` parsing, BOM handling, validation errors, secret masking, extension-ID filtering              |
| `bridge/auth.test.ts`                  | 12    | Bearer extraction, constant-time compare, origin allowlist, host header checks                       |
| `bridge/rate-limit.test.ts`            | 6     | Sliding window, rejection, refill, isolation                                                         |
| `bridge/token-service.test.ts`         | 9     | Model allowlist, upstream payload, error mapping, redaction, timeouts                                |
| `bridge/app.test.ts`                   | 13    | Health/config/token routes, CORS, body limits, auth failures, rate limits                            |
| `extension/audio.test.ts`              | 16    | PCM conversion, base64, resampler, gain, frame sizing, ring buffer math                              |
| `extension/setup.test.ts`              | 13    | Nested `generationConfig`, thinking config, tools on/off, resumption, VAD clamps, title escaping     |
| `extension/storage.test.ts`            | 12    | Defaults, merge, validation, secret storage, retention, reset                                        |
| `extension/system-instruction.test.ts` | 6     | Policy content, injection warnings, verification language, model-specific text                       |
| `extension/executor-guards.test.ts`    | 7     | Tab/URL/document binding, `TAB_GONE`/`ELEMENT_STALE`, prepared-URL replay                            |
| `extension/downloads.test.ts`          | 10    | Redirect to executable, disguised filename, Chrome danger verdicts, non-web schemes                  |
| `extension/orchestrator.test.ts`       | 13    | Validation, approval gate, denial, timeout, cancellation, step limit, error mapping, prep forwarding |

### Notable behaviours asserted

- A tool call with invalid arguments never reaches the executor.
- A `confirm` assessment blocks execution until `resolveApproval(true)`.
- Denial returns `USER_DENIED` and does not retry.
- Approval timeout returns a non-retryable error.
- Cancellation aborts a running tool and marks queued calls cancelled.
- The step limit stops runaway loops.
- Page text cannot approve an action (no code path exists; tests assert the resolver is only reachable through the controller callback).
- A hostile page cannot forge the untrusted-content delimiter or a `<system>` role tag.
- A page title cannot inject newlines, fake bullets, or role tags into the orientation turn.
- Execution refuses a different tab, a different URL, or a same-URL reload after approval.
- The approved preparation object is forwarded to the executor for the re-check.
- A download that redirects to an executable, sends an executable under a document filename, or receives a dangerous Chrome verdict is blocked and removed.
- Array `minItems` / `maxItems` are enforced at runtime (a real defect found and fixed during development).
- BOM-prefixed `.env` files parse correctly (regression test added after a Windows setup issue).

---

## 4. End-to-end tests

**Command:** `npx playwright test`
**Environment:** headed Chromium, real unpacked extension, local fixture servers, mocked Live WebSocket
**Result:** 17 passed in 42.6 s

### 4.1 Extension and content script (`tests/e2e/extension.spec.mjs`)

| #   | Test                                                       | What it proves                                                                                              |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `extension loads and first-run onboarding renders`         | Manifest loads, service worker registers, side panel mounts, onboarding copy renders                        |
| 2   | `onboarding can be skipped and the live panel is usable`   | Onboarding completes, session card, Start live button, composer, privacy note render                        |
| 3   | `settings expose connection, access, and privacy controls` | Settings dialog opens, connection test button, optional capability toggles, privacy disclosure, close works |
| 4   | `content script snapshots and operates a real page`        | Content script injects into a real page, snapshot returns title/text/elements, click mutates the page       |
| 5   | `a full-page read is bounded and framed as data`           | Full-page read respects the 500-character test bound and returns a string framed as data                    |

### 4.2 Offline Live and approval harness (`tests/e2e/live-approval.spec.mjs`)

This suite uses a loopback fake bridge for token minting and Playwright's WebSocket router as the Live server. No Google traffic and no real credentials are involved, but the extension runs the production code path: bridge client → ephemeral token → Live setup → `setupComplete` → tool call → preparation → approval UI → executor → tool response.

| #   | Test                                                            | What it proves                                                                                                          |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 6   | `mints a token and completes a real Live setup handshake`       | Token request, constrained-URL connection, setup shape (model, nested audio config, 52 tools, resumption), audio frames |
| 7   | `gates a submit-like click behind approval, then acts`          | Real approval sheet appears; approving clicks the actual page; execution still targets the approved tab after switching |
| 8   | `the approval dialog passes axe and traps focus`                | Zero WCAG A/AA violations in the live approval sheet; Tab cannot escape it; initial focus is Deny                       |
| 9   | `an approval over settings owns focus and leaves settings open` | Higher-layer dialog wins the focus trap; the settings panel survives the interruption                                   |
| 10  | `a denied action sends USER_DENIED and causes no side effect`   | Deny resolves the real dialog, returns a structured error, and the page is untouched                                    |
| 11  | `a benign click runs without an approval prompt`                | The gate is not over-eager: a non-submit control executes immediately and returns a result                              |

### 4.3 Accessibility (`tests/e2e/accessibility.spec.mjs`)

axe-core 4.11 is injected into the real side-panel page and run against the WCAG 2.0/2.1 A and AA rule sets. Keyboard checks cover what axe cannot assert.

| #   | Test                                                  | What it proves                                                                                   |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 12  | `onboarding has no WCAG A/AA violations`              | The four-step first-run dialog has no detectable violations                                      |
| 13  | `the live panel has no WCAG A/AA violations`          | Header, session card, transcript, and composer are clean                                         |
| 14  | `every settings tab has no WCAG A/AA violations`      | Connection, Voice, Agent, Access, and Privacy panels are each audited                            |
| 15  | `the settings dialog traps focus and restores it`     | Focus enters the dialog, 10×Tab and 10×Shift+Tab stay inside, Escape returns focus to the opener |
| 16  | `the onboarding dialog traps focus`                   | The same trap holds for onboarding, including its tablist                                        |
| 17  | `a settings dialog opened from onboarding owns focus` | Layer priority stops the onboarding trap from stealing focus from the settings dialog            |

The audit runs against the built extension in headed Chromium, not a component harness. It is a snapshot of the reachable states listed above; it is not a manual screen-reader session.

### What the E2E suite does not do

- It does not connect to the real Gemini service; that path is covered by `npm run smoke:live` and the protocol probes.
- It uses Chromium's fake audio device; it does not capture a physical microphone or measure speaker output.
- It does not test downloads, bookmarks, or history against real Chrome data.

Those paths are covered by unit tests (logic), the Live smoke test (protocol), and manual verification (hardware).

### Screenshots produced

- `test-results/onboarding.png`
- `test-results/panel.png`
- `test-results/settings.png`

Copies used in documentation: `docs/assets/`.

---

## 5. Production build

**Command:** `npm run release`

```
▸ Running the production build
▸ Building the React side panel with Vite
▸ Bundling background, content script, and audio worklets
▸ Copying the manifest
▸ Drawing icons
▸ Bundling the local bridge

▸ Build artifacts
  manifest.json                      2.2 kB
  sidepanel.html                     0.4 kB
  background.js                      1.6 kB
  content-script.js                  89.5 kB
  audio/worklet-capture.js           0.5 kB
  audio/worklet-playback.js          3.0 kB
  icons/icon128.png                 11.7 kB
  bridge/dist/server.mjs           783.1 kB

▸ Release package
  extension   Gemini Browser Live v1.0.0
  files       12
  unpacked    625.0 kB
  archive     626.3 kB
  zip         release/Gemini-Browser-Live-Chrome.zip
  sha256      289079d6fbe78f3206fa6cd59e0bc5fd9e6f81da897254f91b2d92f91ff4bff0
```

### Artifact inventory

| File                            | Bytes   |
| ------------------------------- | ------- |
| `manifest.json`                 | 2,267   |
| `sidepanel.html`                | 460     |
| `background.js`                 | 1,618   |
| `content-script.js`             | 91,687  |
| `audio/worklet-capture.js`      | 513     |
| `audio/worklet-playback.js`     | 3,108   |
| `assets/sidepanel-BxH92Vnn.css` | 41,429  |
| `assets/sidepanel-DjC4ZAVX.js`  | 480,495 |
| `icons/icon16.png`              | 844     |
| `icons/icon32.png`              | 2,100   |
| `icons/icon48.png`              | 3,489   |
| `icons/icon128.png`             | 11,960  |

### ZIP verification

The archive was extracted to a temporary directory and every file was compared by SHA-256 against `release/chrome-extension/`:

```
files=12 mismatches=0
```

`release/SHA256SUMS.txt`:

```
289079d6fbe78f3206fa6cd59e0bc5fd9e6f81da897254f91b2d92f91ff4bff0  Gemini-Browser-Live-Chrome.zip
```

`manifest.json` sits at the archive root, so the ZIP can be distributed directly.

---

## 6. Live API smoke test

**Command:** `npm run smoke:live`
**Path:** built bridge → ephemeral token → constrained WebSocket → setup → one text turn

```
▸ Starting the built local bridge for the smoke test
▸ Bridge healthy on 127.0.0.1:47821
▸ Ephemeral token minted (expires 2026-11-03T18:34:29.470Z)
▸ Setup complete in 2024 ms
▸ First audio in 2743 ms (84003 bytes)
▸ Transcript: Smoke test passed.

✔ PASS — Live API round-trip completed in 3001 ms
```

### What this proves

- The bridge loads real configuration and starts.
- The gate secret and origin checks accept the smoke client.
- The Gemini token endpoint accepts the mint payload.
- The constrained WebSocket endpoint accepts the ephemeral token.
- The setup payload is accepted (`setupComplete`).
- The model returns audio and an output transcript for a text turn.
- The production protocol path works with the current API.

### What this does not prove

- Microphone capture and AudioWorklet playback in Chrome (unit-tested logic, manual use only).
- Tool execution inside a real session (verified separately in protocol probes with an echo tool; the 52 real tools are unit-tested).
- Long-session stability.

The earlier protocol probe (`docs/probe-results-2.json`) did verify a full tool round trip on the constrained endpoint:

```
toolCalls=1 (echo_value)
toolRoundTrip=true
outTranscript="Returned gamma."
```

---

## 7. Coverage by subsystem

| Subsystem                                 | Unit                                                      | E2E                    | Live API          | Manual                          |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------- | ----------------- | ------------------------------- |
| Shared safety / schema / catalog          | ✅ 48 tests                                               | —                      | —                 | —                               |
| Bridge config / auth / rate limit / token | ✅ 50 tests                                               | —                      | ✅ mint           | —                               |
| Bridge HTTP surface                       | ✅ 13 tests                                               | —                      | ✅ health         | —                               |
| Live setup builder                        | ✅ 12 tests                                               | —                      | ✅ accepted       | —                               |
| System instruction                        | ✅ 6 tests                                                | —                      | —                 | —                               |
| Orchestrator / approvals                  | ✅ 13 tests                                               | ✅ Approve/deny E2E    | —                 | ✅ UI reviewed                  |
| Approval tab/document binding             | ✅ 7 tests                                                | ✅ E2E switch-tab case | —                 | —                               |
| Prompt-injection boundary                 | ✅ 17-case corpus                                         | —                      | —                 | —                               |
| Audio math / resampling                   | ✅ 16 tests                                               | ⚠️ Fake device only    | —                 | ⚠️ Hardware not automated       |
| Storage / settings                        | ✅ 12 tests                                               | ✅ UI                  | —                 | —                               |
| UI rendering                              | —                                                         | ✅ 3 tests             | —                 | ✅ Screenshots                  |
| Content script                            | —                                                         | ✅ 2 tests             | —                 | ✅ Used during development      |
| 52 tools                                  | ✅ Catalog + schema                                       | ⚠️ Snapshot/click only | ⚠️ Echo tool only | ✅ Spot-checked                 |
| Downloads / bookmarks / history           | ✅ 10 download-policy tests; ⚠️ optional-permission paths | —                      | —                 | ❌ Not exercised with real data |
| Visual click / screenshots                | —                                                         | —                      | —                 | ❌ Not exercised                |

Legend: ✅ covered, ⚠️ partial, ❌ not covered, — not applicable.

---

## 8. Known gaps and limitations

1. **No automated physical-microphone test.** The E2E suite uses Chromium's fake audio device, so the capture and playback pipeline runs but acoustic behaviour and real hardware permissions are not measured. The worklet math is unit-tested; the real voice loop was verified manually.
2. **No automated real-Gemini tool test.** The offline E2E proves the full browser-side protocol path with a mocked Live server. A real session with credentials would be nondeterministic; the smoke test and protocol probes cover the real service.
3. **Optional-permission tools are not exercised against real Chrome data.** `downloads`, `bookmarks`, and `history` paths are guarded by runtime permission checks and policy tests, but no test creates a real download or reads a real bookmark.
4. **Visual tools are not automated.** `capture_viewport`, `describe_visible_page`, and `click_visual_target` require a real rendered page and model vision. They are implemented and reviewed, not E2E-tested.
5. **No cross-browser testing.** Chrome/Chromium only. The Side Panel API is not available in Firefox.
6. **No load or soak testing.** Long sessions rely on the sliding context window; behaviour beyond the smoke duration is unmeasured.
7. **Automated accessibility is a snapshot, not a screen-reader session.** axe-core reports zero WCAG A/AA violations on the tested states and the dialogs trap focus, but no manual NVDA/VoiceOver pass was performed.
8. **No macOS/Linux execution.** Setup was tested on Windows 11. The manual `.env` path is documented but not executed on those platforms.
9. **CI is unverified.** The workflow is committed but has never run on GitHub because no remote exists.
10. **Dev-dependency audit warnings.** `npm audit --omit=dev` reports 0 production vulnerabilities; the full tree reports moderate dev-only issues in the ESLint toolchain.
11. **Single-run latency numbers.** The smoke timings are observations, not a benchmark.

---

## 9. Reproducibility

### Full check

```powershell
npm run typecheck
npm run lint
npx prettier --check .
npx vitest run
npx playwright test
npm run release
npm run smoke:live
```

### Expected results

| Command                  | Expected                                     |
| ------------------------ | -------------------------------------------- |
| `npm run typecheck`      | Exit 0, three ✔ lines                        |
| `npm run lint`           | Exit 0, no output                            |
| `npx prettier --check .` | “All matched files use Prettier code style!” |
| `npx vitest run`         | 16 files, 192 tests passed                   |
| `npx playwright test`    | 17 passed                                    |
| `npm run release`        | 12 files, ZIP + SHA-256                      |
| `npm run smoke:live`     | `PASS — Live API round-trip completed`       |

### Requirements for the smoke test

- `apps/local-bridge/.env` with a real `GEMINI_API_KEY` and `LOCAL_GATE_SECRET`.
- Network access to `generativelanguage.googleapis.com`.
- Port 47821 free, or the bridge already running.

The smoke test starts the built bridge if it is not running and stops it afterwards.

---

## 10. Defects found and fixed during development

These are recorded because they demonstrate the tests are doing real work.

| Defect                                                    | Impact                                                     | Fix                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Approval acted on the active tab, not the approved one    | Switching tabs after approval could act on another page    | Preparation stores tab id, URL, and document id; execution fails closed  |
| Untrusted page block could be closed by page text         | Injected text could appear outside the data boundary       | Angle brackets escaped; delimiter is unforgeable                         |
| Page title could inject newlines/role tags                | Hostile title could forge prompt lines                     | Single-line sanitisation + escaping for inline fields                    |
| Downloads trusted the initial URL only                    | A redirect could deliver an executable after approval      | Final URL, filename, and Chrome danger re-checked; blocked files removed |
| Array `minItems` / `maxItems` not enforced at runtime     | Oversized tool arguments could reach executors             | Runtime validator now enforces bounds; tests added                       |
| Bridge reflected arbitrary `Origin` on readable endpoints | Any local page could read responses                        | CORS now only emits headers for allowlisted origins                      |
| `extractBearer` failed on leading whitespace              | Valid tokens rejected in edge cases                        | Trim before matching; test added                                         |
| Useless assignments in setup                              | Lint noise, unclear intent                                 | Removed                                                                  |
| Caught errors lost `cause`                                | Harder diagnosis                                           | Errors now preserve `cause`                                              |
| Keyword tokenisation broke on Unicode                     | Risk detection missed non-ASCII labels                     | Unicode-aware tokenisation; test added                                   |
| BOM-prefixed `.env` hid the first key                     | Bridge failed to start on Windows PowerShell-created files | BOM stripped; regression test added                                      |
| IPv6 loopback in CSP                                      | Chrome refused to load the extension                       | Removed `[::1]` entries; loopback validation restricted                  |

---

## 11. Sign-off

Within the scope described above, the build is functional and the tested paths pass. The untested paths are explicitly listed in section 8 and are marked PARTIAL or NOT TESTED in `docs/IMPLEMENTATION_STATUS.md`.

No result in this report was inferred, estimated, or copied from an earlier run without re-execution. The smoke test and E2E suite were run against the current build on the date stated at the top.
