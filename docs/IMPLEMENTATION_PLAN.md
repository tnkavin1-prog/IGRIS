# Implementation Plan & Phase Progress

**Project:** Gemetron desktop assistant (`E:\Gemetron`)
**Plan source:** [PHASE1_ARCHITECTURE_AUDIT.md](PHASE1_ARCHITECTURE_AUDIT.md)
**Baseline tag:** `phase1-baseline` (`88fca4c`)
**Updated:** 2026-11-12

> Status is recorded against real, executed evidence. "Done" means the change is in the tree and the
> named verification passes. Nothing here is marked done on the basis of an intention.

---

## Phase status

| Phase | Scope                               | Status                  | Evidence                                                     |
| ----- | ----------------------------------- | ----------------------- | ------------------------------------------------------------ |
| 1     | Architecture audit + gap analysis   | **Done**                | `docs/PHASE1_ARCHITECTURE_AUDIT.md` (published at `dba6a5a`) |
| 2     | Core execution foundation           | **In progress**         | F1–F3 landed; F6–F8 pending                                  |
| 3     | Windows computer-use engine         | Pending (F4, F5, F9)    | —                                                            |
| 4     | Browser-use engine                  | Pending (F14)           | deep-DOM + single-scroll work already in the tree            |
| 5     | File & document engine              | Pending (F11, F12)      | —                                                            |
| 6     | Multimodal capabilities             | Pending (F13)           | —                                                            |
| 7     | Creative application adapters       | Pending (F9)            | Blender skill exists; adapter contract pending               |
| 8     | Voice intelligence                  | Pending (F17)           | —                                                            |
| 9     | Resource & security engineering     | Pending (F10, F16, F18) | —                                                            |
| 10    | Integration & flagship benchmarking | Pending                 | benchmark plan in the audit, §7                              |

---

## P0 — items that unblock the acceptance criteria

| ID     | Item                                                                                                                                                               | Status   | Verification                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | One application resolver; a memory alias must not shadow the executable table or the browser gateway; the asynchronous spawn failure must be captured and reported | **Done** | `app-manager.test.ts`: "routes a browser through the gateway even when a memory alias exists", "honours a memory alias that carries intent", "reports the real cause when the executable cannot be started" (asserts `not found`, and _not_ the old "no matching window appeared")                                                                                                                                            |
| **F2** | Foreground verification propagated instead of discarded; the PowerShell fallback must not report success on a zero exit code                                       | **Done** | `LaunchResult.verified` is now set from the real focus result; `invokeWin32` parses the helper's printed result                                                                                                                                                                                                                                                                                                               |
| **F3** | Honest action results — no tool may hard-code `success: true`                                                                                                      | **Done** | `gemini-live.test.ts`: "reports an unacknowledged keystroke instead of claiming success" (type + hotkey both assert `success:false`, `acknowledged:false` and an explanatory error)                                                                                                                                                                                                                                           |
| **F4** | Known folders + shell-association document opening                                                                                                                 | **Done** | `Win32Input.cs`: `KnownFolder` (SHGetKnownFolderPath) and `OpenDocument` (ShellExecute) with CLI verbs; `app-manager.ts`: `knownFolder`, `findDocuments`, `openDocument` with viewer-window verification; Live tools `find_document` and `open_document`. Verified on this machine: the Desktop resolves to the OneDrive-redirected path, a document is found by name, the shell opens it, and the viewer window is reported. |
| **F5** | Foreground-window observation in the agent loop                                                                                                                    | **Done** | The native helper reports which window owns the foreground; `WindowItem.isForeground` carries it and every agent observation now names the active window. Covered by the autonomous-agent test "reports the foreground window in every observation".                                                                                                                                                                          |
| **F6** | Bounded retry + alternative strategy                                                                                                                               | **Done** | A failed step no longer abandons the plan: the deterministic engine records the failure, runs the remaining steps and ends the task as `partial` with the error listed; the Tier-1 loop already re-plans and stops after three consecutive unverified actions.                                                                                                                                                                |

## P1 — foundation

| ID  | Item                                                                                   | Status   |
| --- | -------------------------------------------------------------------------------------- | -------- |
| F7  | Typed error hierarchy + structured logging, no silent `catch {}`                       | **Done** | `errors.ts` provides typed errors and a structured, redacting logger. Every silent `catch {}` in `app-manager.ts`, `native-input.ts` and `control-server.ts` now logs through it. Covered by `errors.test.ts`.                                                                                                                                                                                                                                                                  |
| F8  | Task checkpointing and resume                                                          | **Done** | `TaskCheckpointStore` persists a task after every step; the engine loads the most recent incomplete task on construction and exposes list/resume/discard. IPC handlers and preload entries are wired. The renderer shows a banner listing saved checkpoints with Resume and Dismiss controls. Covered by `task-checkpoint.test.ts`.                                                                                                                                             |
| F9  | Application-adapter registry (identify/launch/find/focus/observe/verify)               | **Done** | `ApplicationAdapter` contract + registry for 8 apps (Chrome, Notepad, Explorer, Word, Excel, PowerPoint, VS Code, Edge). Adapters now also implement `observe` and `recover`. Covered by `application-adapters.test.ts` (8 tests).                                                                                                                                                                                                                                              |
| F10 | Storage configuration (non-C data root, `userData`/`temp`, download path, tool caches) | **Done** | `pickDataRoot` puts an installed build's data on the drive the application lives on (C: only when the application itself is installed there), `GEMATRON_DATA_DIR` still wins; Electron's `userData` and `temp` always follow the data root; the updater staging and the electron-builder cache moved to the project drive; the soak and debug browser profiles moved off `%TEMP%`; the extension gained a configurable download directory. Covered by `storage-policy.test.ts`. |

## P2/P3 — capability depth and hardening

| ID  | Item                                                                                 | Status      |
| --- | ------------------------------------------------------------------------------------ | ----------- |
| F11 | PDF text extraction (`pdfjs-dist`, OCR as fallback)                                  | **Done**    | `pdf-reader.ts` extracts the text layer with a pure-JavaScript engine (no native build). A new Live tool `read_document` reads PDFs and plain text and reports scanned documents so OCR takes over. The packaged archive stays at 9.65 MB because the engine is bundled into `main.cjs` rather than shipped twice.                                                                                                                                                                                         |
| F12 | Document generation pipelines (`minimax-pdf` / `-docx` / `-xlsx` / `pptx-generator`) | **Partial** | The office skill gained a `createPdf` action driven by Word's own PDF export (WdSaveFormat 17), with file-existence verification and a plain-text fallback. Word COM scripts now run from a file instead of `-Command`, which preserves quoting. Verified on this machine: produces a valid %PDF- file in ~35s. The Live system prompt now tells the model how to build a document through `execute_application_skill`. Full DOCX/XLSX/PPTX generation and the MiniMax design pipelines are still pending. |
| F13 | Video understanding (frame sampling, scene detection, audio extraction)              | **Done**    | `video-reader.ts` probes metadata with ffprobe and extracts key frames two ways (scene changes + uniform sample). Audio is demuxed to a 16 kHz mono WAV. A new Live tool `analyze_video` sends the first frames to the model. A companion `transcribe_audio` tool turns the soundtrack into text via the Gemini REST API. Covered by 3 unit tests including a real 9.2-second clip.                                                                                                                        |
| F14 | Extension tool parity (4 declared tools have no handler)                             | **Done**    | The shared catalog gained a `platform` field. The four desktop-only tools (`read_clipboard`, `write_clipboard`, `search_tab_content`, `close_duplicate_tabs`) are tagged `desktop`; the extension now declares only the `browser` platform, so the model is never offered a tool the extension cannot execute. The desktop HUD keeps declaring all of them. Covered by the shared catalog and extension setup tests.                                                                                       |
| F15 | Provider-independent model interface + documented fallback                           | Pending     |
| F16 | Log rotation, quotas, dossier caps, secret hygiene                                   | **Done**    | `redactCommand` strips secrets from the audit chain and memory store. Logs rotate at 5 MB. Audit chain archives past 10 MB. OpenCode password moved out of `logs/`. Covered by `redactCommand` tests.                                                                                                                                                                                                                                                                                                      |
| F17 | Voice barge-in that pauses the running task                                          | **Done**    | The renderer pauses the current workflow task when Gemini Live reports an interruption and shows a resume control in the ambient bar.                                                                                                                                                                                                                                                                                                                                                                      |
| F18 | Adaptive monitoring (screen stream + tab polling)                                    | **Done**    | The screen stream samples every 10 seconds while idle, closed or in error and every 2.5 seconds while active; the interval is re-evaluated on every status change.                                                                                                                                                                                                                                                                                                                                         |

---

## Engineering notes

### Skills in use

The MiniMax skill collection was installed to `E:\Gemetron\.opencode\skills` (vendored clone in
`.opencode/vendor/minimax-skills`, both git-ignored so third-party code never lands in the repository):

| Skill                                                           | Used for                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `fullstack-dev`                                                 | Phase 2 architecture: layered services, typed errors, centralised config, structured logging, test-and-verify gates |
| `minimax-pdf`, `minimax-docx`, `minimax-xlsx`, `pptx-generator` | Phase 5 document generation (F12)                                                                                   |
| `vision-analysis`, `minimax-multimodal-toolkit`                 | Phase 6 multimodal understanding (F13)                                                                              |
| `frontend-dev`                                                  | reference only — the HUD design is frozen by the project constraints                                                |
| `pr-review`                                                     | self-review rubric for each change                                                                                  |

### Verification gates applied to every change

1. `npm run typecheck` — five projects including the test suite.
2. `npm run lint` — clean.
3. `npm run format:check` — clean (Prettier, LF via `.gitattributes`).
4. `npm test` — unit suite (597 → **601** tests).
5. `npm run test:e2e` — end-to-end suite (**23** tests).

### Defects found by the audit and fixed immediately

| Defect                                                                                                     | Fix                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A default memory alias (`chrome → chrome.exe`) made "Open Chrome" fail with a misleading 10-second timeout | F1                                                                 |
| `spawn()`'s asynchronous `ENOENT` was read synchronously, so the real cause was lost                       | F1                                                                 |
| The native foreground check was computed and then discarded                                                | F2                                                                 |
| The PowerShell fallback reported success for windows that were never found                                 | F2                                                                 |
| `computer_use_type` / `computer_use_hotkey` reported success even when the native layer refused            | F3                                                                 |
| A unit assertion was wrong in 1 of 16 runs (it mutated a random token into itself)                         | `control-auth.test.ts` now picks a replacement that always differs |

### Known flake history

The unit suite occasionally failed in `control-auth.test.ts` (probability-based assertion) and,
before the worker cap, in `control-server.test.ts` (file-descriptor exhaustion with 53 workers).
Both are fixed: the assertion is now deterministic and the pool is capped at eight workers.
