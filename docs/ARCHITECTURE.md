# Architecture

This document describes how Gemini Browser Live is put together, why the boundaries sit where they do, and what happens on the wire during a session.

---

## 1. System context

```
┌──────────────┐   voice   ┌──────────────────────────┐   WSS    ┌──────────────────┐
│    User      │◄─────────►│  Chrome side panel       │◄────────►│  Gemini Live API │
└──────────────┘           │  (React + agent runtime) │          └──────────────────┘
                           └────┬───────────────┬─────┘
                                │ chrome.*      │ HTTPS (token only)
                                ▼               ▼
                     ┌────────────────┐  ┌──────────────────┐
                     │ Content script │  │  Local bridge    │
                     │ (current tab)  │  │  (Node process)  │
                     └────────────────┘  └────────┬─────────┘
                                                  │ REST
                                                  ▼
                                         ┌──────────────────┐
                                         │ Gemini token API │
                                         └──────────────────┘
```

Three processes, one trust boundary:

| Process        | Trust                           | Responsibilities                                                        |
| -------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Side panel     | Trusted UI, no permanent secret | Audio I/O, Live connection, agent loop, approvals, all `chrome.*` calls |
| Content script | Untrusted page context          | DOM observation and interaction, isolated from page JS                  |
| Local bridge   | Trusted secret holder           | API key custody, ephemeral token minting, origin/host/rate checks       |

The content script runs in Chrome's isolated world. It can read and mutate the DOM, but page JavaScript cannot call its functions or read its variables directly.

---

## 2. Why the side panel owns browser control

MV3 service workers are killed after ~30 s of inactivity, cannot hold an AudioContext reliably, and have no DOM. Putting the agent loop in the service worker would mean:

- audio capture in an offscreen document with extra message hops,
- tool execution racing worker termination,
- approval UI coordination across three contexts.

Instead:

- The **side panel** is a normal extension page. It owns the microphone, playback, Live WebSocket, tool executor, and approval UI.
- The **service worker** is intentionally thin: it opens the panel on action click, handles keyboard commands, and routes status queries.
- The **content script** is injected on demand with `chrome.scripting.executeScript` into the active tab, so no persistent content script runs on every page.

The trade-off: closing the side panel ends the session. That is documented behaviour, and the transcript is optionally persisted.

---

## 3. Module map

### 3.1 `packages/shared`

Single source of truth shared by all three processes.

| Module             | Responsibility                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `constants.ts`     | Audio rates, bridge defaults, storage keys, message names, hard limits                    |
| `models.ts`        | Live model registry with verified capability flags                                        |
| `tools.ts`         | 52-tool catalog: names, descriptions, JSON schemas, risk metadata                         |
| `json-schema.ts`   | Derives both runtime validators and Gemini-compatible schemas from one definition         |
| `safety.ts`        | Hard-block schemes, risk keyword heuristics, URL/navigation validation, page-text framing |
| `live-protocol.ts` | Types for Live setup, server messages, function calls/responses                           |
| `protocol.ts`      | Internal message types, `AppSettings`, conversation entries, `LiveStatus`                 |
| `errors.ts`        | Error codes, `ToolError`, retryability, hints                                             |
| `index.ts`         | Public surface                                                                            |

Keeping the catalog and safety policy shared means the UI, executor, and tests cannot drift apart.

### 3.2 `apps/chrome-extension`

```
src/
  background.ts            service worker: commands, action click, status
  content/
    content-script.ts      message loop, operation dispatch
    registry.ts            element handle registry with generations
    dom.ts                 visibility, role/name derivation, bounding boxes
    reader.ts              snapshots, text extraction, tables, links, images
    locator.ts             semantic element lookup and scoring
    interact.ts            click/type/select/submit/hover/scroll with verification
  tools/
    executor.ts            52 capabilities, permission checks, evidence
    page.ts                tab targeting, navigation, injection, waits
    snapshots.ts           screenshot store, state store, page-state diffing
  live/
    bridge.ts              typed bridge client
    setup.ts               Live setup payload construction
    client.ts              WebSocket lifecycle, message decoding
    session-manager.ts     token → connect → reconnect → rotation
    system-instruction.ts  policy prompt
  agent/
    orchestrator.ts        validate → assess → approve → execute → verify → report
  audio/
    capture.ts             16 kHz AudioWorklet capture + VAD
    playback.ts            24 kHz ring-buffer playback + barge-in flush
    resampler.ts           fallback linear resampler
    pcm.ts                 base64/Int16 conversions
    worklet-*.ts           AudioWorklet processors
  sidepanel/
    controller.ts          all side effects, single source of UI truth
    App.tsx                snapshot rendering via useSyncExternalStore
    SettingsPanel.tsx      connection, voice, agent, access, privacy
    ApprovalSheet.tsx      consent UI
    Onboarding.tsx         first-run flow
    storage.ts             settings/secret/transcript persistence
    status.ts              status derivation and copy
    permissions.ts         optional permission requests
    *.tsx, styles.css      UI components and design system
```

### 3.3 `apps/local-bridge`

```
src/
  config.ts        .env parsing, validation, extension-ID derivation, masking
  auth.ts          bearer extraction, constant-time compare, origin/host checks
  rate-limit.ts    sliding-window limiter
  token-service.ts token minting, caching, single-flight
  app.ts           three routes, security headers, body limits
  server.ts        startup, graceful shutdown, diagnostics
  logger.ts        structured, redacting logger
```

Deliberately dependency-free HTTP. The attack surface is three routes; every security check is explicit and unit-testable. This is a documented deviation from the original Fastify plan (see `TECHNICAL_RESEARCH.md`).

---

## 4. Session lifecycle

```
idle
 │  user presses Start live
 ▼
requesting-mic ──► connecting ──► listening
                       │              │
                       │              ├── model audio ──► speaking
                       │              ├── tool call  ──► acting ──► listening
                       │              └── interruption ──► listening
                       │
                       ├── token expiring ──► reconnecting ──► listening
                       └── error ──► error / quota
 │
 └── user stops ──► closed
```

### Start sequence

1. `controller.start()` validates settings and requests microphone permission.
2. `AudioCapture.start()` creates an `AudioContext`, loads `capture-worklet.js`, and begins emitting 32 ms frames of Int16 PCM.
3. `LiveSessionManager.start()` calls `POST /api/token` with the model ID, gate secret, and extension origin.
4. The bridge validates the origin, host, rate limit, and gate secret, then mints a single-use ephemeral token via the Gemini `auth_tokens` API.
5. The side panel opens `wss://…BidiGenerateContentConstrained?access_token=…`.
6. On open, it sends the setup payload: model, nested `generationConfig`, system instruction, tools (only if browser control is enabled), transcription config, and `sessionResumption: {}`.
7. On `setupComplete`, the manager reports `listening`. If this is a fresh session and context is enabled, the current page context is sent with `turnComplete: false` so the model does not reply unprompted.
8. Audio frames flow continuously. Server audio is queued into the playback ring buffer.

### Reconnect and rotation

Ephemeral tokens are single-use. The manager:

- schedules a proactive reconnect ~60 s before `expiresAt`,
- mints a fresh token for every attempt,
- passes the latest `sessionResumption` handle when one exists,
- backs off 1 s → 2 s → 4 s → 8 s → 15 s, max 5 attempts,
- stops reconnecting when the user explicitly stopped.

### Stop sequence

`controller.stop()` cancels pending approvals, aborts running tools, stops capture, flushes playback, closes the socket, and returns status to `idle`/`closed`.

---

## 5. Tool-call pipeline

Every function call goes through the same six stages. This is the core safety property of the system.

```
LiveFunctionCall
   │
   ▼
1. Validate      schema from the shared catalog; unknown tools rejected
   │
   ▼
2. Prepare       resolve targets, check optional permissions, build preview
   │
   ▼
3. Assess        hard block? approval required? risk label + reasons
   │
   ▼
4. Approve       user click in ApprovalSheet, 120 s timeout, cancellable
   │
   ▼
5. Execute       ToolExecutor with AbortSignal and 25 s deadline
   │
   ▼
6. Verify        re-observe page state, confirm mutation, return evidence
   │
   ▼
FunctionResponse { result | error }
```

### Stage details

1. **Validate** — `validateToolArgs` checks required fields, types, enums, ranges, array bounds, and URL schemes. Errors are returned to the model with `retryable: true` when correcting the arguments could help.
2. **Prepare** — the executor resolves a `TargetLocator` (ref, selector, text, role, or coordinates) and checks optional permissions _before_ asking the user. For screenshots and visual clicks it captures a preview.
3. **Assess** — `assessActionRisk` combines hard blocks, the tool's declared risk, and semantic text (button labels, form context). `confirmRisky` lowers the threshold for ordinary actions, but submit-like actions remain gated.
4. **Approve** — the orchestrator emits an `ApprovalRequest`; the controller renders it. Only `controller.resolveApproval(true)` unblocks execution. Page text has no path to this function.
5. **Execute** — `ToolExecutor.execute` runs against the target tab via the content script or `chrome.*` APIs. Cancellation aborts both the promise and the browser operation where possible.
6. **Verify** — mutating tools capture a fingerprint before and after. Navigation waits for a settled document. Downloads poll `chrome.downloads.search` until completion or timeout. The response includes `changed`, target summary, and any relevant state so the model can reason from evidence rather than assumption.

### Ordering and concurrency

Tool calls are serialized through a promise chain. A turn may contain multiple calls; they run in order. Cancellation (`interrupted` from the server) marks queued calls cancelled and aborts the running one.

### Step budget

`maxToolSteps` (default 12) caps tool rounds per user turn. Exceeding it returns a non-retryable error telling the model to summarise and ask the user.

---

## 6. Audio pipeline

### Capture

```
getUserMedia(16 kHz, mono, echoCancellation, noiseSuppression)
   → AudioContext (browser-native rate)
   → capture-worklet.js (downsample to 16 kHz, Int16, 32 ms frames)
   → base64
   → { realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }
```

The worklet performs a streaming linear resample so the output rate is exactly 16 kHz regardless of the hardware rate. Prefix padding (0–500 ms) is sent to the server so the first syllable is not clipped, and the local VAD trims trailing silence (250–2000 ms) to reduce token usage.

### Playback

```
server audio (24 kHz base64)
   → decode to Float32
   → playback-worklet ring buffer
   → AudioContext destination
```

The ring buffer allows an instant flush on `interrupted` or when the user starts speaking, without tearing down the AudioContext. Output volume is applied at the gain node.

### Barge-in

Two layers:

- **Server VAD** is authoritative for turn boundaries and sends `interrupted`.
- **Local flush** clears queued audio immediately when interruption arrives, so the model never keeps talking over the user.

---

## 7. Page observation model

The content script maintains a registry of interactive elements.

Each element gets:

- a stable `ref` for the lifetime of a page generation,
- role and accessible name derived from ARIA, labels, text, and attributes,
- bounding box in CSS pixels,
- optional value/checked/disabled state (never for password fields),
- a context string used by the risk assessor (e.g. surrounding form legend).

Snapshots are bounded:

| Limit             | Value        | Reason                            |
| ----------------- | ------------ | --------------------------------- |
| Snapshot text     | 9,000 chars  | Fit the context window            |
| Snapshot elements | 120          | Keep responses useful             |
| Full page text    | 30,000 chars | Explicit full-read only           |
| Links             | 100          | Avoid link farms                  |
| Tool response     | 14,000 chars | Hard cap before sending to Gemini |

A page fingerprint (URL, title, generation, scroll, element count, text length, structural digest) is used for verification and for `compare_page_states`.

All page text passed to the model is wrapped in an explicit untrusted-data frame. The system instruction tells the model that this text is data, never instructions. Structured fields that originate in the page — element names, table cells, link text, titles, bookmark and history titles, screenshot titles, and download filenames — are escaped or collapsed at the page boundary before they reach the executor, so no field can forge a prompt delimiter.

---

## 8. State and persistence

| Data                               | Where                                                                   | Lifetime         |
| ---------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| Settings                           | `chrome.storage.local` under `gbl.settings.v1`                          | Until reset      |
| Bridge secret                      | `chrome.storage.local` under `gbl.bridgeSecret.v1`                      | Until reset      |
| Transcript                         | In memory by default; `chrome.storage.local` only if retention = device | 120 entries max  |
| Onboarding flag                    | `chrome.storage.local`                                                  | Until reset      |
| Page generation / element registry | Content script memory                                                   | Until navigation |
| Screenshots                        | Side panel memory, 10-minute TTL                                        | Session          |
| Ephemeral token                    | Side panel memory                                                       | ~30 min          |
| API key                            | Bridge process memory                                                   | Process lifetime |

Settings changes apply to the next session. The UI says so explicitly.

---

## 9. UI architecture

`controller.ts` is the only place that performs side effects. React is a pure projection:

```
controller (mutable state + event emitters)
   │  getSnapshot() / subscribe()
   ▼
App.tsx (useSyncExternalStore)
   ├── Header            connection + bridge status
   ├── SessionBar        start/stop, mute, volume
   ├── Transcript        conversation + tool entries
   ├── Composer          typed turns
   ├── ApprovalSheet     consent
   ├── SettingsPanel     5 tabs
   ├── Onboarding        first-run
   └── Toasts            transient feedback
```

This avoids the classic React bug where an effect re-runs on every render and opens duplicate sockets. It also makes the controller directly unit-testable in Node/happy-dom.

### Status derivation

`status.ts` maps raw session/tool/approval state to a single `LiveStatus`, then to copy and colour. The header, session card, and composer all read the same derived value, so they cannot disagree.

---

## 10. Error model

Errors are typed, not strings.

```ts
class ToolError extends Error {
  code: ErrorCode;
  retryable: boolean;
  hint?: string;
}
```

| Code                | Meaning                                            | Model guidance                  |
| ------------------- | -------------------------------------------------- | ------------------------------- |
| `INVALID_ARGS`      | Schema or semantic validation failed               | Correct and retry once          |
| `NOT_FOUND`         | Target element/text missing                        | Re-observe the page             |
| `NOT_VISIBLE`       | Element exists but is not interactable             | Scroll or choose another target |
| `PERMISSION_DENIED` | Browser control off or optional permission missing | Ask the user                    |
| `USER_DENIED`       | Approval declined or blocked by policy             | Do not retry                    |
| `NAVIGATION_FAILED` | URL invalid, blocked, or load failed               | Report and ask                  |
| `TOOL_TIMEOUT`      | Deadline exceeded                                  | Report partial state            |
| `PAGE_UNSUPPORTED`  | Protected Chrome surface                           | Ask the user to navigate        |
| `INTERNAL`          | Unexpected failure                                 | Report honestly                 |

The system instruction forbids claiming success when a tool returned an error. Tests assert that errors reach the model as structured data, not exceptions.

---

## 11. Build and release

```
scripts/build.mjs
  ├── Vite    → side panel (hashed JS/CSS)
  ├── esbuild → background (ESM)
  ├── esbuild → content script (IIFE)
  ├── esbuild → worklets (IIFE)
  ├── esbuild → bridge (ESM, Node 20+)
  ├── copy    → manifest, icons, HTML
  └── assert  → every expected artifact exists and is non-empty
```

`scripts/release.mjs` then:

1. runs the build unless `--no-build`,
2. validates that every file referenced by the manifest exists,
3. writes a deterministic ZIP (fixed timestamps, sorted entries, manifest at root),
4. writes `SHA256SUMS.txt`.

The ZIP writer is dependency-free so the release path is auditable and reproducible on Windows.

---

## 12. Design decisions and trade-offs

| Decision                            | Why                                                                     | Cost                                            |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Side panel owns the agent loop      | Audio + `chrome.*` + UI in one lifetime-safe context                    | Closing the panel ends the session              |
| Content script injected on demand   | No persistent script on every page; lower overhead and privacy exposure | First tool call on a tab pays injection latency |
| Shared tool catalog                 | Schema, safety, and UI cannot drift                                     | Rebuild required to add tools                   |
| Dependency-free bridge              | Small, auditable, no supply-chain surface                               | No framework niceties                           |
| Ephemeral tokens                    | Key never enters Chrome                                                 | Extra round trip per reconnect                  |
| Serialized tool calls               | Predictable state, simpler verification                                 | No parallel tab operations                      |
| Bounded observations                | Context safety                                                          | Very large pages need targeted reads            |
| Code-enforced approvals             | Model and page cannot self-authorize                                    | Occasional extra click                          |
| Native-audio model only for control | Extended-thinking cannot call tools                                     | Two model modes with different capabilities     |

---

## 13. Extension points

- **Add a tool** — add an entry to `packages/shared/src/tools.ts`, a handler in `tools/executor.ts`, and a title in `agent/orchestrator.ts`. The schema validator, Gemini declaration, and risk assessment update automatically.
- **Add a model** — add a `LiveModelSpec` with verified capability flags. The bridge allowlist derives from the registry.
- **Change the approval policy** — edit `packages/shared/src/safety.ts`. Tests in `tests/unit/shared/safety.test.ts` define the contract.
- **Add a page operation** — extend `PageOp`, implement in `content-script.ts`, call it from `PageBridge`.
