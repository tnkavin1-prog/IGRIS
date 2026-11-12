# Phase 1 — Architecture Audit & Technical Gap Analysis

**Project:** Gemetron desktop assistant (`E:\Gemetron`)
**Baseline:** git tag `phase1-baseline` @ `88fca4c` (working tree clean at audit start)
**Date:** 2026-11-12
**Method:** static source reading with `path:line` evidence for every claim, plus runtime spot-checks of the packaged build. No source file was modified for this audit.

> This report distinguishes _implemented and verified_ from _implemented but unverified_ and _not implemented_. A capability is only called "implemented" if the code that performs it was read end to end.

---

## 1. Executive summary

The project is **not** a prototype: it has a real Electron shell, a 54-tool Gemini Live surface, a CDP browser client, a native Win32 input/UIA bridge, a tiered command policy, a hash-chained audit trail, a loopback control API with token auth, and a 597-test unit suite plus 23 end-to-end tests that are green.

The gap is **not** in the number of features. It is in three places:

| #   | Gap                                                                                                                                                                                                                                                 | Consequence                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Action outcome semantics.** A `true` from the native layer means "`SendInput` was accepted", not "the app did what you wanted". Four real verifications exist in the whole codebase; two tools hard-code `success: true`.                         | The agent confidently reports success for actions that did nothing. This is the single biggest source of "it says it worked but nothing happened". |
| 2   | **Execution foundation.** Three engines coexist (deterministic workflow, LLM planner/verifier, skill registry), all with in-memory state. No task checkpoint, no per-step retry, no application-adapter contract, no foreground-window observation. | A task cannot survive a restart, a crash, or a focus change. The deterministic path aborts the whole task on the first failed step.                |
| 3   | **Document handling.** There is no PDF parser, no document generator library, and no shell-association opener. A PDF can only be "read" as pixels.                                                                                                  | Test 2 and Test 3 of the acceptance criteria cannot pass. "Open the PDF on my desktop" cannot even find the Desktop folder.                        |

Two hard-policy violations also exist and are cheap to fix: **packaged builds default their data root to `%LOCALAPPDATA%` (C:)** and **the extension downloads to `C:\Users\<user>\Downloads`** because no download path is ever configured.

---

## 2. System inventory

### 2.1 Stack

| Layer            | Technology                                                                                              | Entry point                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop shell    | Electron 34, React 19 + TypeScript, Vite                                                                | `apps/desktop-hud/src/main/index.ts` → `src/renderer/main.tsx` → `App.tsx`                  |
| Native bridge    | C# / .NET Framework 4.x (`scripts/Win32Input.cs` → `.exe`/`.dll`), invoked as a JSON-line child process | `apps/desktop-hud/src/main/native-bridge.ts`                                                |
| Live brain       | Gemini Live bidirectional WebSocket (`wss://generativelanguage.googleapis.com/...`)                     | `apps/desktop-hud/src/main/gemini-live.ts`                                                  |
| Planner/verifier | Gemini REST `generateContent` (independent verifier pass)                                               | `apps/desktop-hud/src/main/vision-planner.ts`                                               |
| Browser          | Chrome DevTools Protocol over WebSocket (port 9222) + native UI-Automation fallback                     | `apps/desktop-hud/src/main/cdp-client.ts`, `browser-gateway.ts`                             |
| Extension        | MV3 service worker + side panel + content script                                                        | `apps/chrome-extension/src/background.ts`, `sidepanel/App.tsx`, `content/content-script.ts` |
| Local bridge     | Node `node:http` server on 127.0.0.1:47821, mints single-use Live tokens                                | `apps/local-bridge/src/app.ts`, `token-service.ts`                                          |
| Shared contracts | 58-entry tool catalogue, protocol types, risk policy                                                    | `packages/shared/src/tools.ts`, `protocol.ts`, `safety.ts`                                  |

**Size:** desktop-hud 19,893 lines / 55 files · chrome-extension 14,524 / 55 · local-bridge 878 / 7 · shared 1,992 / 9 (plus ~1,345 lines of C# and ~400 lines of PowerShell helpers).

**Dependencies (desktop):** `@gbl/shared`, `electron-updater`, `ws`. **No PDF, DOCX, XLSX, image or OCR library** — OCR is the Windows built-in engine driven through `scripts/ocr-screen.ps1`.

### 2.2 The three execution engines

```
                    ┌──────────────────────────────────────────┐
 voice / text ─────▶│ GeminiLiveService  (54 tool declarations)│
                    └───────────────┬──────────────────────────┘
                                    │ tool call
        ┌───────────────────────────┼────────────────────────────┐
        ▼                           ▼                            ▼
 plan_autonomous_task        direct tool                autonomous_goal
        │                           │                            │
        ▼                           ▼                            ▼
 AgenticWorkflowEngine      tools call into              AutonomousAgent
 (deterministic steps,      AppManager / CDP /          + GeminiVisionPlanner
  no model in the loop)      native input               (observe→think→act→verify)
        │                                                        │
        └──────────────────┬─────────────────────────────────────┘
                           ▼
                   SkillRegistry (6 domain skills)
```

Key structural facts:

- `AgenticWorkflowEngine` and `AutonomousAgent` are **alternatives, not layers** (`gemini-live.ts:2309-2320` picks one).
- The Live surface declares **54 tools** (`gemini-live.ts:547-1594`); every declaration has a handler (54 `case` labels match 54 `name:` entries).
- The extension shares a **58-tool** catalogue (`packages/shared/src/tools.ts:79`), of which **4 have no extension-side handler** (`read_clipboard`, `write_clipboard`, `search_tab_content`, `close_duplicate_tabs`) and resolve to "Unknown tool" in `executor.ts:2233`.

### 2.3 Voice pipeline (verified end to end)

| Stage        | Implementation                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture      | `renderer/audio-controller.ts:78-116` → `getUserMedia`, `AudioContext({sampleRate:16000})`, `AudioWorkletNode('hud-capture')`, 64 ms chunks                                                                                             |
| Wire format  | mono PCM16 LE @ 16 kHz (`gemini-live.ts:449-461`)                                                                                                                                                                                       |
| STT          | **Server-side** Gemini transcription (`gemini-live.ts:503-504`, consumed at `:1616-1640`) — there is no local STT on the conversation path                                                                                              |
| TTS          | **Server-side** Gemini audio (`gemini-live.ts:1642-1652`), played by the renderer with gapless scheduling (`audio-controller.ts:159-205`)                                                                                               |
| Barge-in     | **Server-detected** (`sc.interrupted` → `gemini-live.ts:1609-1614`). The renderer drops queued playback (`App.tsx:296-300`) — **it does not pause or cancel a running task.** Only the killswitch (`Ctrl+Alt+K`, `Escape`×3) stops one. |
| Local speech | Windows `System.Speech` **only** for the wake word (`scripts/wake-word.ps1`, "hey gematron", confidence ≥ 0.65, 5 s cooldown) — emits only `ready`/`wake`, no transcript, paused while a Live session owns the mic                      |

---

## 3. The eight failure modes — verdicts and root causes

| #   | Failure mode                          | Verdict                                | Root cause (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Open Chrome."                        | **PARTIAL — broken on the voice path** | The default memory alias `chrome → chrome.exe` (`jarvis-memory.ts:92-93`) is always found, so `app-manager.ts:241` takes the `memAlias` branch (`:261`) and uses the bare string `chrome.exe` — bypassing `findExecutableForApp()` (which resolves the full path) _and_ the browser-gateway branch (guarded by `!memAlias`). `spawn()` reports `ENOENT` **asynchronously** via the `'error'` event, but the code reads `spawnError` synchronously (`app-manager.ts:289-331`), so the failure is invisible; the Start-Menu recovery is additionally gated on `!memAlias`. The user gets `Started "chrome.exe" but no matching window appeared within 10 seconds.` — 10 seconds of burn for a process that never started. |
| 2   | Window switching / focus              | **PARTIAL**                            | A real foreground check exists in C# (`Win32Input.cs:762-763`, `GetForegroundWindow()==hwnd`) but the TS layer **discards the boolean** (`app-manager.ts:348`, `browser-gateway.ts:331`). The PowerShell fallback returns `true` on exit code 0 regardless of the printed result (`app-manager.ts:1174-1181`) — a false-positive generator. Two different focus engines coexist (`FindWindowByQuery` vs `WScript.Shell.AppActivate`, `windows.skill.ts:161-178`). Nothing detects that focus was stolen mid-task: `AgentObservation.activeWindow` exists (`autonomous-agent.ts:23`) but is **never populated** (`:298-307`).                                                                                            |
| 3   | Open the PDF on my Desktop            | **MISSING**                            | No known-folder resolution anywhere (`SHGetKnownFolderPath` / `USERPROFILE\Desktop` / OneDrive redirect: zero hits). `shell.openPath` is used **only** for the notes folder (`index.ts:200`). `spawn('…\file.pdf')` fails with `ERROR_BAD_EXE_FORMAT`. `browser-gateway.ts:52-59` silently converts `file:///…` into a **Google search for the literal URL**. The only working route is `run_system_command('start "" "…"')`, which the policy classifies as `caution` (not `dangerous`) and which has **no launch verification**.                                                                                                                                                                                      |
| 4   | Read that PDF                         | **MISSING**                            | No PDF parser, no PDF library, no `pdf.js`. The only PDF-aware code is a window-title guess (`app-manager.ts:656-665`). Content reaches the model exclusively as **pixels** → OCR (`windows-ocr.ts:20-44`, confidence hard-coded at 0.75) or the vision model. `cdp-client.readPage` returns the Chrome _viewer chrome_, not the document.                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | Sequential operations                 | **IMPLEMENTED (two engines)**          | `agentic-workflow.ts:642-751` (deterministic, aborts on first failure) and `autonomous-agent.ts:155-251` (LLM loop with an independent before/after screenshot verifier). Plans live **in memory only** (`agentic-workflow.ts:49`, `autonomous-agent.ts:92`); there is no checkpoint or resume across a restart.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | Knowing whether an action succeeded   | **PARTIAL — mostly missing for input** | `SendInput` returning 1 proves only that the event was _queued_ (`Win32Input.cs:362-386`). Four genuine verifications exist in the codebase: UIA value read-back (`Win32Input.cs:1044`), the focus check above, Chrome tab counting (`browser-gateway.ts:245-258`), and skill payload shape checks. Two tools **discard the acknowledgement and hard-code success**: `gemini-live.ts:2054` (`charactersTyped`) and `:2063` (`keysSent`). Skill `verify()` is a payload shape check (`windows.skill.ts:276-292`), not a state check.                                                                                                                                                                                     |
| 7   | Recovery after focus loss / app crash | **MISSING (generic)**                  | No liveness watcher compares a known HWND against the current window list. The only re-focus logic is in the Blender skill — and it **ignores its own result** (`blender-gui.skill.ts:318-324` → `:491-503`), so a file path can be typed into an unrelated window. The Tier-1 agent can _notice_ a vanished app (screenshot diff) but has no automatic re-focus/relaunch policy.                                                                                                                                                                                                                                                                                                                                       |
| 8   | Continuing after a tool failure       | **IMPLEMENTED at the Live boundary**   | The tool loop catches the exception, audits it, returns `{error:{message}}` to the model and continues with the next call (`gemini-live.ts:2703-2731`). But: the deterministic workflow engine **aborts the whole task** on the first failed step (`agentic-workflow.ts:710-724`); `ExecutionGuard` caches failures too, so an identical retry inside the window returns **the same failure** (`execution-guard.ts:127-141`); and `attempts`/`maxAttempts` are hard-coded to `1` (`autonomous-agent.ts:192-193`) — **there is no retry anywhere in the system**.                                                                                                                                                        |

### 3.1 Additional confirmed defects

| Defect                                                       | Evidence                                                                                                                                                                  | Impact                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ai_dispatch` ignores the requested model                    | passes `modelKey` (`agentic-workflow.ts:919`) but the skill reads `params.model` (`skills/opencode.skill.ts:150`)                                                         | every model-routed step silently runs DeepSeek                    |
| `verify_condition` is a stub                                 | `agentic-workflow.ts:879-880` returns `{verified:true}` unconditionally                                                                                                   | a "verification step" can never fail                              |
| `reliability.ts` is ~85 % dead code                          | only `retry` is imported (`autonomous-agent.ts:9`)                                                                                                                        | the advertised verification primitives are unused                 |
| Three `AppManagerService` instances with different behaviour | `computer-operator.ts:67`, `skills/windows.skill.ts:27`, `skills/blender-gui.skill.ts:27` (the latter two have **no display metrics**, so DPI mapping silently no-ops)    | the same request behaves differently depending on the entry point |
| Model-switchboard advertises capabilities that do not exist  | `ModelSwitchboard.tsx:67,90-95` "Auto-route" is a local `useState` flag; "Local (Ollama)" has no integration anywhere in `src/main`                                       | the UI promises routing the engine cannot perform                 |
| Doc drift                                                    | `docs/ARCHITECTURE.md:72` says 52 tools (actual 58); `docs/GEMATRON_SYSTEM_WALKTHROUGH.md:69` still says the control API is unauthenticated and auto-approval defaults on | both are now false                                                |

---

## 4. Gap analysis by class

### 4.1 Missing capability

- PDF/DOCX/XLSX/PPTX **text extraction** (nothing but pixels).
- **Document generation** libraries (PDF/DOCX/XLSX/PPTX) — the dossier exporter only writes Markdown/HTML.
- **Known-folder resolution** (Desktop, Documents, Downloads) and **shell-association opening**.
- **Task checkpointing / resume** across restarts.
- **Foreground-window observation** in the agent loop.
- **Per-step retry** with bounded attempts and an alternative strategy.
- **Provider-independent model interface** for the Live session (it is hard-wired to Google at `gemini-live.ts:34-35`).
- **Application-adapter contract** (launch / find window / focus / observe / verify) — `ApplicationSkill` (`skill-framework.ts:43-52`) has no such contract; per-app knowledge is spread over three hard-coded tables (`app-manager.ts:25-40` aliases, `app-manager.ts:42-135` if-chain, `jarvis-memory.ts:79-96` memory aliases).
- **Client-side context summarisation / token budget** — only server-side sliding window exists.
- **Log rotation / storage quotas.**

### 4.2 Incorrect implementation

- Alias shadows the executable resolver (F1 below).
- Async `spawn` error read synchronously → false "no window" error.
- Foreground boolean discarded; PowerShell fallback false-positives.
- `computer_use_type` / `computer_use_hotkey` hard-code `success: true`.
- `file://` URLs mangled into a web search.
- `ai_dispatch` model key mismatch; `verify_condition` stub; `attempts` never incremented.
- `getCurrentTask()` returns a shallow copy whose `steps` are shared by reference (`agentic-workflow.ts:96-98`) — a renderer can mutate engine state.

### 4.3 Permission limitation

- The native helper attaches to the **input desktop** (`Win32Input.cs:271-298`), so it works across the UAC secure-desktop split — but it cannot drive a genuinely elevated (administrator) window from a non-elevated process.
- `C:\Windows\Temp` and the Windows WebCache need elevation to clean.
- The Windows OCR engine requires an installed language pack (`ocr-screen.ps1:24-28` throws otherwise).
- Chrome's PDF viewer is a plugin, not DOM — CDP text extraction cannot reach it.

### 4.4 Model / tool integration limitation

- The extension advertises 4 desktop-only tools it cannot execute.
- The planner is Gemini-specific inside a provider-shaped interface (`vision-planner.ts:60-64` hard-codes the URL and header).
- No fallback model: a planner HTTP error is fatal to the session (`vision-planner.ts:114` → `autonomous-agent.ts:256-268`).
- The Live model must be able to call tools; there is no degraded text-only mode.

### 4.5 Execution reliability limitation

- Three divergent Chrome launch paths; the voice path is the broken one.
- No focus-loss detection, no application-liveness check.
- The deterministic engine aborts the task instead of degrading.
- `ExecutionGuard` caches failures and suppresses identical retries — including the _recovery_ attempt.
- The Blender skill can type into an unrelated window.

### 4.6 Context-management limitation

- Renderer conversation array is unbounded (`App.tsx:26`).
- Planner history is truncated to the last 12 steps with 2,000-char field caps — **evidence is dropped silently** (`vision-planner.ts:131`).
- The dossier exporter embeds **base64 screenshots** into Markdown/HTML (`audit-exporter.ts:96,426`) — multi-megabyte files with no cap.
- `recentContext.metadata` is unbounded and stores **full command strings** (`agentic-workflow.ts:859-868`).

### 4.7 Resource limitation

- Screen stream every **2.5 s** while a Live session is open (`gemini-live.ts:356-372`) — in memory only (never written to disk ✓) but ~2.3 GB/hour upstream.
- CDP tab poll every **1.5 s** with a `Runtime.evaluate` per tab (`cdp-client.ts:88-94,1028-1060`).
- Hardware telemetry every **2 s** (`hardware-monitor.ts:33`).
- Content-script SPA watcher every **500 ms** in the extension (`content/content-script.ts:404-408`).
- **No log rotation** on `hud-startup.log`, `renderer.log` or the hash-chained `audit.jsonl` — and the audit chain cannot be rotated without breaking integrity (`security-auditor.ts:32-39`).

---

## 5. Storage & disk-policy audit (the "no C:" requirement)

### 5.1 Current state

In **development** every application write is on `E:` — `runtime-paths.ts:33-37` resolves `DATA_ROOT` to the repository root, and logs, notes, downloads, temp files, the Chrome debug profile, the control token, the bridge `.env` and the npm cache all derive from it.

### 5.2 Confirmed C: writes

| #         | What                                        | Source                                                                                                          | Default                                            | Fix                                                                                                                   |
| --------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **C1**    | Extension browser downloads                 | `executor.ts:882` `chrome.downloads.download({saveAs:false})` — **no `setDownloadPath` anywhere** (0 repo hits) | `C:\Users\<user>\Downloads`                        | call `chrome.downloads.setDownloadPath()` once the optional `downloads` permission is granted; target `DOWNLOADS_DIR` |
| **C2**    | Electron `userData` (packaged)              | `index.ts:52-56` → `DATA_ROOT` → `%LOCALAPPDATA%\Gemetron`                                                      | C:                                                 | change the packaged default of `DATA_ROOT` to a non-C path, or require `GEMATRON_DATA_DIR`                            |
| **C3**    | Electron `userData` (dev)                   | `index.ts:52` — `setPath('userData')` only runs when packaged                                                   | `C:\Users\<user>\AppData\Roaming\@gbl\desktop-hud` | set it unconditionally                                                                                                |
| **C4**    | Playwright browsers                         | no `PLAYWRIGHT_BROWSERS_PATH`                                                                                   | `%LOCALAPPDATA%\ms-playwright`                     | set the env var to `E:\Gemetron\temp\playwright`                                                                      |
| **C5/C6** | Electron / electron-builder download caches | no `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE`                                                                  | `%LOCALAPPDATA%\electron[-builder]\Cache`          | set both to `E:\Gemetron\temp\…`                                                                                      |
| **C7**    | `electron-updater` staging                  | `auto-update.ts:18` uses `app.getPath('temp')`                                                                  | `%TEMP%`                                           | `app.setPath('temp', TEMP_DIR)`                                                                                       |
| **C8**    | Soak + debug-ui Chromium profiles           | `tests/soak/soak.spec.mjs:100`, `scripts/debug-ui.mjs:16`                                                       | `%TEMP%`                                           | reuse `tests/e2e/profile-dir.mjs` (already moved off `%TEMP%`)                                                        |
| **C9**    | Unit-test sandboxes (13 sites)              | e.g. `tests/unit/bridge/config.test.ts:13`                                                                      | `%TEMP%`                                           | point `tmpdir()` at a repo-relative helper                                                                            |
| **C10**   | Node/Electron implicit temp                 | no `app.setPath('temp')`                                                                                        | `%TEMP%`                                           | `app.setPath('temp', TEMP_DIR)`                                                                                       |

**No OCR, wake-word or AI model files are written to disk by this project** — OCR and wake word use Windows built-in engines, and all AI models are remote. The only model-like payload is the Playwright Chromium download (C4).

### 5.3 Secret hygiene

- `logs/opencode-server-password.txt` — a **plaintext secret in the logs directory** (`skills/opencode.skill.ts:27`).
- The Gemini API key is returned to the renderer by `gemini:get-settings` (`index.ts:487`) and every renderer console line is mirrored to `logs/renderer.log` (`window.ts:67-73`) — the key is currently never logged, but the pathway exists.
- Shell commands are audited **verbatim** to `logs/audit.jsonl` (`app-manager.ts:985-1028`) and mirrored into `notes/jarvis_memory.json` (`agentic-workflow.ts:859-868`) — a command containing a bearer token is persisted in clear text.

---

## 6. Prioritised implementation plan

Effort is in engineer-days. "Verify" names the evidence that closes the item.

### P0 — Unblock the acceptance criteria (Phase 2 + 3)

| ID     | Change                                                                                                                                                                                                                                                                                                                     | Files                                                      | Effort | Verify                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **F1** | **One application resolver.** A single `resolveTarget(appName)` that consults (1) the browser gateway for browsers, (2) the executable if-chain, (3) memory aliases — and never lets a bare alias shadow a real path. Capture the **async** `spawn` error before the verification window opens, and report the real cause. | `app-manager.ts`, `jarvis-memory.ts`                       | 0.5    | New unit test: `launchApplication('chrome')` resolves a full path; a failing spawn reports `ENOENT`, not "no window appeared". |
| **F2** | **Foreground verification propagated.** Return the C# foreground boolean, re-read the foreground HWND after the switch, and stop the PowerShell fallback from reporting `true` on exit code 0.                                                                                                                             | `app-manager.ts`, `native-input.ts`, `browser-gateway.ts`  | 0.5    | Unit test with the fake native bridge: `focusWindow` returns `false` when the helper prints `False`.                           |
| **F3** | **Honest action results.** `computer_use_type` / `_hotkey` / `_move` / `_scroll` report the real acknowledgement; add a `verified` field distinguishing "queued" from "observed".                                                                                                                                          | `gemini-live.ts`                                           | 0.25   | Unit test: a native layer returning `false` yields `success: false`.                                                           |
| **F4** | **Known folders + document opening.** Resolve Desktop/Documents/Downloads via `SHGetKnownFolderPath` (small C# helper or PowerShell), open documents through the shell association (`ShellExecute`), and verify a viewer window appeared.                                                                                  | new `known-folders.ts` + `Win32Input.cs`, `app-manager.ts` | 1.5    | Benchmark A: "Open the PDF on my desktop" finds the file, opens it, and verifies the window title.                             |
| **F5** | **Foreground observation in the loop.** Populate `AgentObservation.activeWindow`; add a pre-action focus assertion and a re-focus policy.                                                                                                                                                                                  | `autonomous-agent.ts`, `app-manager.ts`                    | 1      | Unit test: the observation carries the foreground title.                                                                       |
| **F6** | **Bounded retry + alternative strategy.** Implement `attempts`/`maxAttempts` for real; on repeated failure, re-plan (Tier-1) or skip-and-continue with a recorded reason (deterministic path).                                                                                                                             | `autonomous-agent.ts`, `agentic-workflow.ts`               | 1      | Benchmark E: an injected failure is retried at most N times and then reported, never looped forever.                           |

### P1 — Foundation for everything else (Phase 2)

| ID      | Change                                                                                                                                                                                                  | Effort                                                                                   | Verify                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **F7**  | **Typed error hierarchy + structured logging** (`AppError` subclasses, JSON lines with a request/task id, no silent `catch {}`). Apply the `fullstack-dev` error-handling pattern to the main process.  | 1.5                                                                                      | Lint rule: no empty catch blocks in `src/main`.                                          |
| **F8**  | **Task checkpointing.** Persist `AgenticTask`/`AgentSession` to `DATA_ROOT/tasks/*.json` on every step; resume on start.                                                                                | 1.5                                                                                      | Benchmark: kill the process mid-task, restart, resume from the last verified checkpoint. |
| **F9**  | **Application-adapter registry** with a real contract: `identify / launch / findWindow / focus / observe / verify`. Migrate Chrome, Explorer, Notepad, Word, Excel, PowerPoint, VS Code, Edge, Acrobat. | 3                                                                                        | Benchmark D: Blender/Office adapters report their own availability and verification.     |
| **F10** | **Storage configuration.** `DATA_ROOT` default → non-C in packaged mode; `app.setPath('userData'                                                                                                        | 'temp')`unconditionally; env for Playwright/Electron caches; extension`setDownloadPath`. | 1                                                                                        | Benchmark F: no application write to C: during a full session. |

### P2 — Capability depth (Phases 4–7)

| ID      | Change                                                                                                                                                                                             | Effort |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **F11** | **PDF text extraction** — `pdfjs-dist` (pure JS, no native build) behind a `PdfReader` interface; OCR remains the fallback for scanned pages.                                                      | 1.5    |
| **F12** | **Document generation** — `minimax-pdf` / `minimax-docx` / `minimax-xlsx` / `pptx-generator` skill pipelines behind a `DocumentBuilder` interface (create → validate → render → reopen → inspect). | 2      |
| **F13** | **Video understanding** — ffmpeg frame sampling + scene-change detection + audio extraction; feed frames to the vision model and audio to transcription.                                           | 1.5    |
| **F14** | **Extension tool parity** — implement the 4 missing tools or remove them from the shared catalogue.                                                                                                | 0.5    |
| **F15** | **Model abstraction** — provider-independent `LiveModel` interface with capability flags (tools/vision/audio) and a documented fallback policy.                                                    | 2      |

### P3 — Resource, security, polish (Phases 8–9)

| ID      | Change                                                                                                                         | Effort |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **F16** | Log rotation + quotas; cap dossier size; redact command arguments in the audit chain; move the OpenCode secret out of `logs/`. | 1      |
| **F17** | Voice barge-in that pauses the running task and accepts a new instruction (Phase 8 / acceptance Test 5).                       | 1.5    |
| **F18** | Adaptive monitoring: screen-stream interval scaled by activity; tab polling only while a browser task is live.                 | 0.5    |

---

## 7. Benchmark plan (Phase 10)

Each benchmark becomes an executable suite; the report is machine-readable JSON under `docs/evidence/`.

| ID  | Benchmark                                                                           | Automatable now?          | Blocked by |
| --- | ----------------------------------------------------------------------------------- | ------------------------- | ---------- |
| A   | Basic Windows control (open Chrome, open Desktop PDF)                               | **Yes**                   | F1, F4     |
| B   | Browser research with source capture                                                | **Yes** (mocked network)  | —          |
| C   | Research → notes → images → PDF → reopen → verify                                   | Partly                    | F11, F12   |
| D   | Blender animation                                                                   | Partly (bpy available)    | F9         |
| E   | Error recovery (crash, missing file, timeout, bad URL, model failure, interruption) | **Yes** (fault injection) | F6, F8     |
| F   | Resource + disk validation                                                          | **Yes**                   | F10, F16   |

Targets are measured, never asserted by hand. The report states pass rate, failures and unresolved limitations, including anything that required physical hardware.

---

## 8. Risks and blockers

| Risk                                                              | Impact                                             | Mitigation                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Adding a PDF/DOCX library adds a heavyweight dependency           | Violates "no unnecessary heavyweight dependencies" | `pdfjs-dist` is pure JS; use the MiniMax document skills for generation rather than new runtimes                          |
| Changing `DATA_ROOT` for packaged builds breaks existing installs | Users lose access to their notes/memory            | Migrate: on first start, if the old C: directory exists and the new one does not, copy it and leave the original in place |
| Task checkpointing writes user content to disk                    | Privacy                                            | Store only step metadata and hashes; keep the transcript in the existing memory store, not in checkpoints                 |
| Windows-only behaviours cannot be validated on CI (Linux)         | Regressions slip through                           | Keep platform guards; add a Windows-only CI job, or accept manual verification on the dev machine                         |
| Physical microphone / barge-in / multi-monitor                    | Cannot be proven by unit tests                     | Requires supervised hardware validation; must stay on the remaining-priorities list                                       |

---

## 9. What was verified during this audit

- `npm run typecheck` (5 projects, including the test suite) — clean.
- `npm run lint` — clean.
- `npm test` — **597 unit tests pass**.
- `npm run test:e2e` — **23 end-to-end tests pass**.
- `npm run build` and `npm run dist:desktop` — succeed; the packaged executable was launched and its control API was exercised (401 without the token, 200 with it, 403 for a web origin, 200 for the extension origin).
- The claim set in this document was spot-checked against the source by the auditor; the specific lines quoted in §3 were re-verified independently before publication.
