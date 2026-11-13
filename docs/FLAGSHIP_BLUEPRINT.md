# Gemetron Flagship Blueprint — Jarvis/Ultron-Class Windows Voice Agent

> Status: **Design blueprint** (no source changes). Companion to `docs/PHASE1_ARCHITECTURE_AUDIT.md` and `docs/IMPLEMENTATION_PLAN.md`. Every "upgrade" below is expressed as a concrete contract, file target, and verification gate so it can be scheduled and measured. Effort estimates are engineer-days.

---

## 0. North star

**Definition of "flagship".** Gemetron is flagship-class when, on a stock Windows 11 machine with no pre-installed developer tools, a non-technical user can say a single sentence ("Find the Q3 report on my desktop, summarise it, email the summary to my team, and put the chart on slide 3 of the deck I have open") and the agent completes it end-to-end with:

- **< 1.5 s** from end-of-speech to first audible acknowledgement,
- **≥ 95 %** first-attempt success on the Benchmark A–F suite,
- **zero** unverified "success" claims (every reported success is backed by an observed state change),
- **zero** writes to `C:` outside the OS cache directories that cannot be redirected,
- **full** recoverability after a process crash mid-task,
- **human-in-the-loop** for every destructive / financial / account / messaging action, with an informed, risk-labelled approval card.

**Non-goals.** Not a multi-user network service; not a replacement for a real OS; not an unattended privileged agent. Gemetron remains a single-user, on-device, consent-gated assistant.

---

## 1. Guiding principles (100× better, not 10× more features)

1. **Outcome, not input.** A native call returning `true` means "the event was queued", never "the app did it". Every action must carry a `verified` field backed by an observed state change (window appeared, value read back, DOM mutated, file exists). Remove every hard-coded `success: true`.
2. **One resolver, one truth.** A single `resolveTarget()` consults browser gateway → executable table → memory aliases, in that order, and never lets a bare alias shadow a real path. Three `AppManagerService` instances with divergent behaviour collapse into one injected singleton.
3. **Observe → decide → act → verify → recover.** The agent loop is the only execution path. The deterministic workflow engine and the LLM planner become two strategies of the same `AgentRuntime`, not alternatives.
4. **Checkpoint everything.** No in-memory-only task state. Every step persists to `DATA_ROOT/tasks/*.json` on completion; a crash resumes from the last verified checkpoint.
5. **Bounded retry with a strategy ladder.** `attempts`/`maxAttempts` are real. On failure: retry same → re-ground coordinates → re-focus window → re-plan (Tier-1) → skip-and-record. Never silently loop.
6. **Foreground is a first-class observation.** `AgentObservation.activeWindow` is always populated; a pre-action focus assertion runs before every native mutation; focus loss mid-task triggers re-focus, not failure.
7. **Safety is code, not prompt.** Approvals are enforced in the executor, not suggested to the model. Page text is data. Command policy tiers are non-bypassable.
8. **No C: writes.** `DATA_ROOT`, `userData`, `temp`, Playwright/Electron caches, extension downloads — all redirected. One migration path for existing installs.
9. **Provider-independent brain.** Live model, planner, verifier, STT and TTS are behind capability-flagged interfaces with a documented fallback policy. Gemini is the default, not the only option.
10. **Measure, never assert by hand.** Every capability has a machine-readable benchmark with pass rate, failure list, and unresolved limitations.

---

## 2. Target architecture (layered)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  L0  Shell & lifecycle  (Electron, tray, HUD, control API, updates)      │
├──────────────────────────────────────────────────────────────────────────┤
│  L1  Voice I/O  (wake word, capture, STT, TTS, barge-in, codecs)        │
├──────────────────────────────────────────────────────────────────────────┤
│  L2  Perception  (screen capture, OCR, UIA, CDP DOM, vision grounding)   │
├──────────────────────────────────────────────────────────────────────────┤
│  L3  Actuation  (native input, window mgmt, shell, clipboard, files)     │
├──────────────────────────────────────────────────────────────────────────┤
│  L4  Application adapters  (Chrome, Explorer, Office, Blender, VSCode…)  │
├──────────────────────────────────────────────────────────────────────────┤
│  L5  Browser engine  (CDP, shadow/iframe, scrolling, uploads, downloads)  │
├──────────────────────────────────────────────────────────────────────────┤
│  L6  Document & media  (PDF/DOCX/XLSX/PPTX, image, video, OCR fallback)  │
├──────────────────────────────────────────────────────────────────────────┤
│  L7  Agent runtime  (planner, verifier, retry, checkpoint, recovery)     │
├──────────────────────────────────────────────────────────────────────────┤
│  L8  Safety & policy  (auth, approvals, command tiers, audit chain)       │
├──────────────────────────────────────────────────────────────────────────┤
│  L9  Storage & resources  (data root, logs, quotas, caches)               │
└──────────────────────────────────────────────────────────────────────────┘
```

Each layer exposes a typed interface; concrete implementations are injectable and mockable. The renderer never touches a native API directly — everything flows through the main process via the context bridge.

---

## 3. Voice intelligence (L1)

### 3.1 Current state

- Server-side STT/TTS via Gemini Live (PCM16 @ 16 kHz in, 24 kHz out), AudioWorklet capture, ring-buffer playback, server-detected barge-in.
- Local wake word "Hey Gematron" via Windows `System.Speech`, confidence ≥ 0.65, 5 s cooldown, idle-only.
- Barge-in drops queued audio but **does not pause or cancel a running task**.

### 3.2 Flagship upgrades

| ID  | Upgrade                       | Contract                                                                                                                                                                                         | Effort | Verify                                                                                          |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------- |
| V1  | **Task-aware barge-in**       | On `interrupted`, abort the running `AgentStep` via its `AbortSignal`, release held inputs, flush playback, and accept the new utterance as a fresh turn. Expose `onBargeIn` callback.           | 1.5    | Unit: barge-in during a `wait` step cancels it within 200 ms; E2E: user says "stop" mid-action. |
| V2  | **Local STT fallback**        | Add an optional on-device STT (Windows `System.Speech` dictation or Whisper.cpp) behind `STTProvider`. Used when offline, when latency > 2 s, or when the user opts out of cloud transcription.  | 2.5    | Benchmark: transcription works with network disabled.                                           |
| V3  | **Local TTS fallback**        | `TTSProvider` interface; Windows SAPI / OneCore voices as offline fallback; voice cloning optional.                                                                                              | 1.5    | Unit: fallback activates on WebSocket close.                                                    |
| V4  | **Wake-word robustness**      | Multi-phrase wake ("Hey Gematron", "Gemini", "Computer"), speaker verification, false-positive rate < 1/hour, adaptive threshold from ambient noise floor, works on multi-monitor audio devices. | 2      | Soak: 8-hour idle run, count false triggers.                                                    |
| V5  | **Audio device management**   | Hot-plug detection, per-device gain/AGC, echo-cancellation tuning, automatic fallback to default device, visual device picker in settings.                                                       | 1.5    | Manual: plug/unplug headset mid-session.                                                        |
| V6  | **Low-latency codec path**    | Opus encode/decode in the worklet (WebCodecs where available), reduce frame size to 20 ms, prefix padding 0–300 ms, adaptive trailing-silence trim 200–1500 ms.                                  | 1      | Probe: first-audio latency < 1.5 s p95.                                                         |
| V7  | **Voice identity & profiles** | Per-user voice profile (pitch/rate preferences, vocabulary, macros), stored under `DATA_ROOT/profiles/`, switchable by voice ("switch to work profile").                                         | 2      | Unit: profile round-trips.                                                                      |
| V8  | **Multilingual**              | Language auto-detect on first utterance, per-turn language tag, TTS voice matching, wake word in N languages.                                                                                    | 2      | E2E: English → Hindi → English turn sequence.                                                   |
| V9  | **Push-to-talk + hotkey**     | Global hotkey (already `Ctrl+Alt+Space`) with hold-to-talk, toggle, and hands-free modes; visible recording indicator on all monitors.                                                           | 0.5    | Manual.                                                                                         |
| V10 | **Prosody-aware playback**    | Sentence-boundary chunking, emphasis on numbers/paths, interruptible mid-sentence, volume ducking of other apps.                                                                                 | 1      | Manual.                                                                                         |

### 3.3 Audio pipeline hardening

- Move capture from renderer-owned `AudioContext` to a dedicated offscreen document so the session survives overlay collapse (currently closing the panel ends the session — acceptable but documented).
- Add a **voice activity detector (VAD)** with energy + zero-crossing + (optional) Silero, so silence is not streamed and token usage drops ~40 %.
- Add **acoustic echo cancellation feedback**: if playback is detected in capture, reduce gain automatically.

---

## 4. Perception (L2)

### 4.1 Screen capture

- **Multi-monitor aware**: capture the monitor containing the target window or the cursor, not just the primary display. `desktopCapturer` with `screen.getDisplayNearestPoint`.
- **DPI-correct**: physical pixels end-to-end; logical↔physical mappers already exist in `native-input.ts` — unify with capture so screenshot pixel coordinates map 1:1.
- **Adaptive resolution**: 1280×720 for planning, 1920×1080 for verification, full-res on demand. Avoid sending 4K screenshots.
- **Window-scoped capture**: capture a single window's client area via `desktopCapturer` with `windowId` for faster, cheaper, less leaky observations.

### 4.2 OCR

- Replace the heuristic 0.75 confidence with per-word confidence from `Windows.Media.Ocr` (already returns `TextLine`/`Word` with `BoundingRect`; confidence must be derived and reported).
- Add **OCR language packs** detection and a graceful "language pack missing" message.
- **OCR as fallback only** when UIA/CDP cannot provide text; cache results keyed by (window handle, generation).

### 4.3 UI Automation (UIA)

- Expose the full UIA tree (not just `find`/`invoke`/`setValue`): `AutomationElement` with role, name, value, state, patterns (Invoke, Value, RangeValue, Toggle, Selection, Scroll, Grid, Table, Text).
- **Pattern-based interaction** preferred over coordinate clicks: `invoke()`, `setValue()`, `toggle()`, `select()` — these are verifiable by re-reading the property.
- **Event subscription**: `StructureChanged`, `PropertyChanged`, `FocusChanged` so the agent reacts instead of polling.
- Cache the UIA tree per window generation; invalidate on focus/structure change.

### 4.4 Vision grounding (screen-grounding.ts)

- Fuse three sources into one ranked candidate list: UIA (highest trust), CDP DOM (medium), OCR (lowest), with per-source confidence and a unified coordinate space.
- Add **visual element detection** via a lightweight on-device model (YOLO-style icon detection) for non-text controls (toolbars, icons) — currently a blind spot.
- Add **wait-for-element** with exponential backoff and a cancellation token (already exists; add abort support).
- Add **element stability**: re-query before acting if > 500 ms since grounding.

### 4.5 Vision model (planner input)

- Send **two images** to the planner: full screen (context) + cropped target window (detail), plus a structured JSON of the UIA tree (truncated to budget).
- Annotate screenshots with numbered bounding boxes for candidate elements (Set-of-Mark prompting) to make clicks unambiguous and reduce hallucination.
- Track **token budget** explicitly; compress history by summarising completed steps instead of dropping evidence.

---

## 5. Actuation (L3)

### 5.1 Native input (Win32Input.cs / native-input.ts)

- **Honest acknowledgements**: `SendInput` return count, `SetForegroundWindow` boolean, `SendMessage` result — propagate all of them. Already partially done; finish for `typeText`, `sendHotkey`, `mouseMove`.
- **Smooth, human-like motion**: cubic-bezier trajectories with micro-jitter, configurable speed, overshoot-and-correct for long moves. Already has `MoveMouseSmooth`; add per-action profiles (precise vs fast).
- **Modifier safety**: never leave a modifier held. `releaseAllInputStates` on every error path and in `finally` blocks (already in autonomous agent).
- **Input desktop attachment**: already handles UAC split; add detection of secure desktop and refuse to act with a clear message instead of silently failing.
- **Touch / pen input** optional for tablets.
- **Key state queries** (`GetAsyncKeyState`) before sending chords to avoid stuck modifiers.

### 5.2 Window management (app-manager.ts)

- **One resolver** (F1): browser gateway → executable if-chain → memory aliases, with async spawn error capture.
- **Foreground propagation** (F2): return the C# boolean; re-read HWND; PowerShell fallback must parse the printed result.
- **Known folders** (F4): `SHGetKnownFolderPath` for Desktop/Documents/Downloads/Pictures/Music/Videos, including OneDrive redirection. Already added `knownFolder()` — wire it into document search and file tools.
- **Shell-association opening** (F4): `ShellExecute` with `open` verb, verify a viewer window appeared by title/process within a deadline.
- **Window lifecycle**: launch → wait for window (with process-id tracking, not just title) → focus → verify. Timeout with a real error, not a generic message.
- **Multi-window tiling**: snap/arrange helpers for side-by-side workflows.
- **Virtual desktops**: enumerate and switch (Windows 10+ COM).

### 5.3 Shell & file system

- **Command policy** (already 4 tiers): extend coverage to PowerShell encoded commands, download-and-execute, persistence, credential access, data destruction. Analyse compound commands as a whole (already).
- **File operations as first-class tools**: read/write/move/copy/delete with path validation, trash (not permanent delete) by default, and audit logging.
- **Path sandbox**: configurable allowed roots; refuse writes outside `DATA_ROOT` and user folders unless explicitly approved.

### 5.4 Clipboard

- Typed clipboard (text, image, files, HTML) with format detection and safe read/write. Extension already lacks clipboard tools — implement them (F14).

---

## 6. Browser engine (L5)

### 6.1 Current state

- CDP over WebSocket (port 9222), deep DOM helpers (shadow roots + same-origin iframes), single-strategy scroll, form value setters, file uploads, coordinate translation.
- BrowserGateway with attach-first strategy, dedup, tab counting verification.
- 4 extension tools unimplemented.

### 6.2 Flagship upgrades

| ID  | Upgrade                                      | Contract                                                                                                                                                                                                                                      | Effort |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| B1  | **Auto-attach to any Chrome**                | Launch Chrome with `--remote-debugging-port=9222` only if not already debuggable; prefer the user's normal profile; never spawn a second profile silently. Detect and reuse an existing debuggable instance.                                  | 1      |
| B2  | **Shadow DOM + cross-origin iframe parity**  | Walk open shadow roots (done) and **closed** shadow roots via CDP `DOM.describeNode` with `pierce`; cross-origin iframes via `Target.attachToTarget` (OOPIF). Coordinate translation through the full frame chain.                            | 2.5    |
| B3  | **Semantic element registry (desktop side)** | Port the extension's semantic registry (role/name/aria/labels) to the desktop CDP path so the agent refers to elements by description, not selectors.                                                                                         | 2      |
| B4  | **Robust form filling**                      | Native value setters + `input`/`change`/`blur` events; support React/Vue/Angular controlled inputs (done partially); add date pickers, comboboxes, rich text (contenteditable), file inputs with drag-and-drop.                               | 1.5    |
| B5  | **Scrolling that actually works**            | Container scroll → element scrollIntoView → wheel event → page scroll, with verification that the target became visible. Handle virtualised lists (scroll until found or end).                                                                | 1      |
| B6  | **Downloads management**                     | `chrome.downloads` / CDP `Browser.setDownloadBehavior` with a configurable download directory (`DATA_ROOT/downloads` or user's Downloads). Progress, completion, cancellation, file-type gating. Extension: implement `setDownloadPath` (C1). | 1      |
| B7  | **PDF in-browser**                           | Detect Chrome's PDF viewer; extract text via CDP `Accessibility.getFullAXTree` or PDF.js; fall back to screenshot+OCR.                                                                                                                        | 1.5    |
| B8  | **Multi-tab orchestration**                  | Tab groups, named sessions, background tabs, parallel (but serialised) operations across tabs, tab lifecycle events.                                                                                                                          | 1.5    |
| B9  | **Network & console observability**          | CDP `Network`/`Console`/`Log` domains exposed as tools: list requests, filter by URL, get response body (size-capped), console errors.                                                                                                        | 1.5    |
| B10 | **Anti-bot / stealth (honest)**              | Use the real user profile and real Chrome; no stealth patches that break sites. Document that some sites will block automation; provide a "manual takeover" mode.                                                                             | 0.5    |
| B11 | **Extension tool parity**                    | Implement `read_clipboard`, `write_clipboard`, `search_tab_content`, `close_duplicate_tabs` or remove from catalogue (F14).                                                                                                                   | 0.5    |
| B12 | **Extension ↔ desktop bridge**               | Let the extension delegate native actions to the desktop (optional token already exists). Unified session ID across both surfaces.                                                                                                            | 1      |

### 6.3 Seamless mouse control over the browser

The flagship feel comes from **one coordinate system**:

- CDP elements return CSS-viewport coordinates → convert to screen coordinates using the Chrome window's client rect (from UIA) + scroll offset + device pixel ratio.
- When the agent "clicks" a browser element, it should optionally drive the **real mouse** (so the user sees it) rather than CDP `Input.dispatchMouseEvent` — configurable "ghost cursor" mode. CDP dispatch is faster and more reliable; real-mouse is more transparent and works on sites that detect synthetic events.
- Provide both, with a per-action flag and a global "show me what you're doing" toggle that forces real-mouse + visible cursor highlight + slow motion.

---

## 7. Document & media (L6)

| ID  | Capability                       | Tech                                                                                                                                         | Effort |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D1  | **PDF text extraction**          | `pdfjs-dist` (pure JS) behind `PdfReader` interface; OCR fallback for scanned pages; page-range selection; table extraction.                 | 1.5    |
| D2  | **DOCX/XLSX/PPTX read**          | `mammoth` (DOCX→text/HTML), `xlsx` (SheetJS), PPTX unzip + XML parse.                                                                        | 1.5    |
| D3  | **Document generation**          | MiniMax skill pipelines (`minimax-pdf/docx/xlsx`, `pptx-generator`) behind `DocumentBuilder`: create → validate → render → reopen → inspect. | 2      |
| D4  | **Image understanding**          | Feed images to the vision model with OCR overlay; support screenshots, photos, diagrams.                                                     | 1      |
| D5  | **Video understanding**          | ffmpeg frame sampling + scene-change detection + audio extraction; frames to vision model, audio to transcription.                           | 1.5    |
| D6  | **Archive handling**             | zip/tar read/write, with path-traversal protection.                                                                                          | 0.5    |
| D7  | **Known-folder document search** | "the PDF on my desktop" → resolve Desktop → fuzzy match by name/content → open with shell association → verify window.                       | 1      |

---

## 8. Application adapters (L4)

Replace the three hard-coded tables (aliases, if-chain, memory aliases) with a registry implementing:

```ts
interface AppAdapter {
  id: string;
  detect(): Promise<boolean>; // is it installed?
  launch(args?): Promise<LaunchResult>; // verified launch
  findWindow(): Promise<WindowHandle | null>;
  focus(): Promise<boolean>; // verified focus
  observe(): Promise<AppObservation>; // app-specific state
  verify(action, before, after): Promise<boolean>;
  capabilities: string[]; // what the agent can do with it
}
```

Ship adapters for: **Chrome/Edge, Explorer, Notepad, VS Code, Word, Excel, PowerPoint, Outlook, Blender, Photoshop/Premiere (detect only), Terminal, Acrobat/Edge PDF**. Each adapter declares its own availability so the agent never offers a skill that isn't installed. Blender GUI skill must re-focus before typing a file path (fix the ignored-result bug).

---

## 9. Agent runtime (L7)

### 9.1 Unified runtime

Merge `AgenticWorkflowEngine` (deterministic) and `AutonomousAgent` (LLM loop) into one `AgentRuntime` with two strategies selectable per goal:

- **Deterministic**: for known, repeatable tasks (skills, batch ops). Aborts on failure but records the reason and offers "continue/skip".
- **Autonomous**: observe → plan → act → verify loop with the vision model. Default for open-ended goals.

Both share: checkpointing, retry, focus observation, audit logging, cancellation.

### 9.2 Checkpointing (F8)

- Persist `AgentSession` to `DATA_ROOT/tasks/<id>.json` after every step (metadata + hashes, not transcripts).
- On startup, list resumable sessions; offer "resume" in the HUD.
- Atomic writes (temp + rename); schema versioning; migration on load.

### 9.3 Retry & recovery (F6)

- `AgentStep.attempts` / `maxAttempts` are real (default 2 for transient, 1 for mutations).
- Strategy ladder per failure:
  1. Retry identical (transient errors only).
  2. Re-ground coordinates (re-run screen grounding).
  3. Re-focus the target window and retry.
  4. Re-plan (autonomous only) with the failure in context.
  5. Skip step with a recorded reason and continue (deterministic) or ask the user (autonomous).
- `ExecutionGuard` must not cache a failure in a way that blocks the recovery attempt — key the cache on `(action, params, attempt)` and invalidate on focus change.

### 9.4 Foreground observation (F5)

- `observe()` always calls `manager.getForegroundWindow()` and stores `activeWindow`.
- Pre-action assertion: if the expected window is not foreground, re-focus (with verification) before acting.
- Focus-loss detection: re-check foreground after every action; on loss, pause and re-focus or abort with a clear reason.

### 9.5 Context management

- Cap renderer conversation at N entries with summarisation of older turns (not silent truncation).
- Planner history: keep last K steps with full evidence, summarise older ones into a "completed milestones" block.
- Dossier exporter: never embed base64 screenshots; write them as sidecar files and reference by path; cap total size.
- `recentContext.metadata` bounded; redact command strings containing tokens (F16).

### 9.6 Concurrency

- Tool calls remain serialised per session (predictable state), but allow **parallel read-only observations** (screenshots, window lists) to reduce latency.
- A global "task lock" prevents two autonomous sessions from driving the mouse simultaneously.

### 9.7 Voice-driven task control

- "pause", "resume", "cancel", "what are you doing?" are first-class commands that operate on the active `AgentSession`, not just the audio stream.
- Progress narration: the agent speaks a one-line status after each verified step ("Opened Chrome, loading the report").

---

## 10. Safety & security (L8)

### 10.1 Control API

- Per-install token (done), origin classifier, loopback Host pin, DNS-rebinding protection (done).
- Add **rate limiting per route** (already has sliding window) and **request signing** for sensitive operations.
- Add **TLS on loopback** (optional, self-signed, pinned) to defeat local sniffers.
- Token rotation on demand; revocation list.

### 10.2 Approvals

- Code-enforced, non-bypassable (done). Extend: risk tier + exact command shown on the card (done); add **diff preview** for file writes; **dry-run** option for destructive commands.
- Approval timeout 120 s (done) with a visible countdown; auto-deny on timeout.
- "Always allow for this session" only for `safe` tier, never for `dangerous`.

### 10.3 Command policy

- Four tiers (done). Add: **network egress** rules, **credential-access** detection (regex for tokens/keys in commands), **persistence** detection (registry run keys, scheduled tasks, startup folder).
- Analyse **decoded** payloads (base64/encoded commands) — currently only the raw string.

### 10.4 Audit chain

- Metadata-only, SHA-256 hash-chained JSONL (done). Add: **log rotation** that seals a chain segment and starts a new one with a "continuation" record (preserves verifiability across rotations), **export** to a signed bundle, **redaction** of command arguments by default with an opt-in "full" mode.
- Store role labels as informational only (already).

### 10.5 Secret hygiene

- Move the OpenCode password out of `logs/` (F16); store in `DATA_ROOT/secrets/` with file ACLs.
- Never return the API key to the renderer (currently `gemini:get-settings` does — fix: return a masked sentinel).
- Redact secrets in `renderer.log` mirroring; never log command strings containing bearer tokens.

### 10.6 Prompt injection

- Untrusted-data framing (done). Add: **output validation** — tool results are schema-validated before being shown to the model; **canary tokens** in the system instruction to detect leakage; **content-security** on any HTML rendered from page content.
- Extension: treat all page text as data (done); add DOM-based injection detection (hidden text, zero-size elements, off-screen content).

### 10.7 UAC & elevation

- Detect elevated windows and refuse to drive them from a non-elevated process with a clear message and an "relaunch as admin" option (with consent).
- Never auto-elevate.

---

## 11. Storage & resources (L9)

### 11.1 Data root (F10)

- Packaged default: `%LOCALAPPDATA%\Gemetron` → change to a user-chosen or `%USERPROFILE%\Gemetron` (non-C preference). Require `GEMATRON_DATA_DIR` override; migrate existing installs on first run (copy old → new, leave original).
- Dev: repo root (done). Unify `setPath('userData'/'temp')` unconditionally.
- Playwright/Electron caches: env vars set by setup script.

### 11.2 Extension downloads (C1)

- Call `chrome.downloads.setDownloadPath()` to `DATA_ROOT/downloads` (or user's Downloads) once the `downloads` permission is granted.

### 11.3 Log rotation & quotas (F16)

- Rotate `hud-startup.log`, `renderer.log`, `audit.jsonl` by size (10 MB) and age (30 days). Cap dossier exports at 50 MB total with LRU eviction.
- Screen stream: scale interval by activity (2.5 s active → 10 s idle → off when no session).

### 11.4 Resource governance

- Tab polling only while a browser task is live (currently always-on every 1.5 s).
- Hardware telemetry every 5 s (currently 2 s) unless a monitoring view is open.
- Content-script SPA watcher 1 s (currently 500 ms).
- Memory cap on screenshot store (10-min TTL done; add byte cap).

---

## 12. Multi-model & provider abstraction (F15)

- `LiveModel` interface: `connect`, `sendAudio`, `sendToolResponse`, `onAudio`, `onToolCall`, `onInterrupted`, `disconnect`. Capability flags: `tools`, `vision`, `audio`, `nativeAudio`.
- `PlannerProvider` and `VerifierProvider` interfaces (Gemini REST today; add OpenAI, Anthropic, local Ollama).
- Model registry with verified capability flags (extension already has this pattern — port to desktop).
- Fallback policy: if the planner fails, retry once with a smaller model; if that fails, ask the user. Never silently abort a session.
- Settings UI: provider picker, model picker, API key per provider, "test connection" button.

---

## 13. HUD / UX (L0)

- **Overlay chrome** (done: drag strip, minimize-to-orb, dock, close, resize to view). Add: **always-on-top toggle**, **click-through mode** when collapsed, **multi-monitor docking**.
- **Approval card** (done: risk badge + command). Add: **diff preview**, **dry-run**, **countdown**, **voice "approve/deny"**.
- **Status derivation** (done single source). Add: **task progress bar** with step count and ETA, **error toasts** with retry action.
- **Accessibility**: keyboard navigation, screen-reader labels, high-contrast theme, reduced motion.
- **Onboarding**: first-run mic test, device check, permission wizard, sample task.
- **Command palette**: `Ctrl+K` to type a command or search tools/history.

---

## 14. Observability & testing (Phase 10)

### 14.1 Benchmarks (machine-readable JSON under `docs/evidence/`)

- **A** Basic Windows control (open Chrome, open Desktop PDF) — blocked by F1, F4.
- **B** Browser research with source capture (mocked network).
- **C** Research → notes → images → PDF → reopen → verify — blocked by F11, F12.
- **D** Blender animation — blocked by F9.
- **E** Error recovery (crash, missing file, timeout, bad URL, model failure, interruption) — blocked by F6, F8.
- **F** Resource & disk validation — blocked by F10, F16.

### 14.2 New benchmarks for flagship

- **G** Voice latency (first-audio p50/p95/p99, barge-in latency).
- **H** Success rate on a 50-task real-world suite (human-labelled).
- **I** Safety red-team (prompt injection, command injection, path traversal, approval bypass).
- **J** Long-running soak (8 h idle + 2 h active, memory leak check, false wake rate).
- **K** Multi-monitor mixed-DPI correctness.
- **L** Accessibility (keyboard-only completion of 10 tasks).

### 14.3 Test infrastructure

- Windows-only CI job (GitHub Actions `windows-latest`) for unit + E2E.
- Soak tests on the packaged build, not just dev.
- Fault injection harness: kill process mid-step, corrupt checkpoint, revoke permission, drop network.
- Property-based tests for coordinate mappers, command policy, URL normalisation.

---

## 15. Phased roadmap (flagship)

| Phase | Scope                                                   | Key IDs    | Effort (days) | Gate                |
| ----- | ------------------------------------------------------- | ---------- | ------------- | ------------------- |
| 0     | Honest results + one resolver + foreground propagation  | F1, F2, F3 | 1.25          | Unit tests green    |
| 1     | Storage + known folders + document opening              | F10, F4    | 2.5           | Benchmark F         |
| 2     | Checkpointing + retry + focus observation               | F8, F6, F5 | 3.5           | Benchmark E         |
| 3     | App adapter registry + adapters                         | F9         | 3             | Benchmark D         |
| 4     | PDF/DOCX/XLSX/PPTX read+write                           | F11, F12   | 3.5           | Benchmark C         |
| 5     | Browser parity (shadow/iframe/scroll/uploads/downloads) | B1–B7, F14 | 10            | Benchmark B         |
| 6     | Voice intelligence (barge-in, fallbacks, wake)          | V1–V10     | 13            | Benchmark G         |
| 7     | Perception (multi-monitor, UIA tree, vision grounding)  | P1–P5      | 8             | Benchmark H         |
| 8     | Safety hardening (auth, audit rotation, injection)      | S1–S7      | 4             | Benchmark I         |
| 9     | Multi-model abstraction                                 | F15        | 2             | Provider tests      |
| 10    | UX polish (overlay, approval, onboarding, palette)      | U1–U6      | 4             | Accessibility audit |
| 11    | Observability & CI (Windows job, soak, fault injection) | T1–T4      | 3             | All benchmarks      |
| 12    | Flagship certification (50-task suite ≥ 95 %)           | —          | 2             | Benchmark H         |

**Total: ~59 engineer-days** to flagship, incremental and shippable at each phase.

---

## 16. The "100×" list — concrete, measurable

1. **Latency**: first-audio acknowledgement < 1.5 s p95 (currently unmeasured). Achieved by streaming STT, smaller frames, and a local VAD that trims silence.
2. **Reliability**: ≥ 95 % first-attempt success on 50 real tasks (currently no benchmark). Achieved by the strategy ladder and verification.
3. **Honesty**: 0 unverified success claims (currently 2 hard-coded). Achieved by honest acknowledgements + observed verification.
4. **Recovery**: resume after crash (currently none). Achieved by checkpointing.
5. **Reach**: open a PDF by name, not just by path (currently impossible). Achieved by known folders + shell association.
6. **Browser depth**: deep shadow + cross-origin iframe parity (currently open shadow + same-origin only). Achieved by CDP pierce + OOPIF attach.
7. **Seamless mouse**: one coordinate system desktop↔browser with a visible ghost cursor (currently two separate code paths). Achieved by unified mapping + real-mouse mode.
8. **Safety**: decoded-payload command analysis + credential-access detection (currently raw string only). Achieved by policy extension.
9. **Observability**: machine-readable benchmarks with pass rates (currently markdown). Achieved by JSON evidence + CI.
10. **Maintainability**: one `AppManagerService`, one resolver, one agent runtime (currently three of each). Achieved by consolidation.

---

## 17. Risks & blockers

| Risk                                                   | Impact                                             | Mitigation                                                                                |
| ------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Heavyweight deps (pdfjs, ffmpeg)                       | Violates "no unnecessary heavyweight dependencies" | pdfjs is pure JS; ffmpeg is an optional external binary detected at runtime, not bundled. |
| Changing `DATA_ROOT` default breaks existing installs  | Users lose notes/memory                            | Migrate on first start; leave original in place.                                          |
| Checkpointing writes user content to disk              | Privacy                                            | Store step metadata + hashes only; transcripts stay in the existing memory store.         |
| Windows-only behaviours can't be CI-validated on Linux | Regressions slip through                           | Add a `windows-latest` CI job; keep platform guards.                                      |
| Physical mic / barge-in / multi-monitor                | Can't be proven by unit tests                      | Supervised hardware validation; stays on the remaining-priorities list.                   |
| Model provider lock-in                                 | Vendor risk                                        | Provider-independent interfaces with documented fallback.                                 |
| Scope creep                                            | Never ships                                        | Phase gates with explicit verification; ship at each phase.                               |

---

## 18. Definition of done (flagship certification)

Gemetron is certified flagship when all of the following are true and machine-verified:

- [ ] `npm run typecheck` (5 projects) clean.
- [ ] `npm run lint` + `npm run format:check` clean.
- [ ] `npm test` ≥ 650 unit tests, 0 failures.
- [ ] `npm run test:e2e` ≥ 30 tests, 0 failures.
- [ ] Benchmarks A–L all pass with documented pass rates ≥ 95 % (A, B, E, F, G, H, I, J, K, L) and ≥ 80 % (C, D).
- [ ] No application write to `C:` during a full session (Benchmark F).
- [ ] Crash-resume demonstrated (Benchmark E).
- [ ] Signed installer + hosted update verified on a clean machine.
- [ ] Physical microphone + barge-in + multi-monitor validated by a human tester.
- [ ] Accessibility audit (keyboard-only) passes.

---

_This blueprint is a living document. Update it as phases land; never mark an item done without its verification gate._
