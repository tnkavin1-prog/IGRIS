# IGRIS Flagship Desktop Autonomy and Hardening Plan

> **For agentic workers:** Execute this plan in the isolated `codex/igris-flagship-autonomy` worktree. Do not edit renderer/design files. Use test-first changes for behavior and run verification before claiming completion.

## Goal

Raise the existing Electron desktop agent's technical reliability and autonomous task execution quality without changing visual design. Preserve existing public APIs where feasible and retain human approval for destructive or externally consequential operations.

## Scope and file boundaries

- `apps/desktop-hud/src/main/ipc-security.ts` (new): validate privileged renderer IPC sender, main frame, and trusted local URL.
- `apps/desktop-hud/src/main/index.ts`: route all privileged `ipcMain.handle` registrations through one trusted-sender gate; restrict media permissions to the HUD renderer; remove unsafe GPU overrides.
- `apps/desktop-hud/src/main/window.ts`: use Electron DIP coordinates without primary-display scaling, add bounded renderer crash recovery and cleanup, keep all window visual configuration unchanged.
- `apps/desktop-hud/src/main/autonomous-agent.ts` and `vision-planner.ts`: improve autonomous session lifecycle, bounds and execution safety without weakening approvals.
- `apps/desktop-hud/src/main/gemini-live.ts`: align voice-tool execution with the autonomous agent, ensure realtime calls respect protocol setup, and expose accurate task status.
- `apps/desktop-hud/src/main/task-checkpoint.ts` or a focused new store: durable agent task checkpoints with crash-safe writes and no replay of uncertain mutations.
- `apps/desktop-hud/scripts/build.mjs` and `electron-builder.config.cjs`: production bundle hardening, opt-in auto-start/signing support, and deterministic packaging.
- `tests/unit/desktop/*`: regression tests for IPC trust, display handling, agent limits, checkpoint recovery, and voice tool setup. Tests may be changed to correct stale expectations and incomplete mocks; no renderer design snapshots or visual source are to be changed.
- `docs/superpowers/plans/*`: this plan and implementation notes only.

## Execution order

### 1. Establish accurate regression tests
- Add unit tests for trusted IPC sender validation (correct sender/main frame/local file URL accepted; foreign sender, iframe, non-file URL and absent window rejected).
- Correct stale HUD display mocks to expose Electron `workArea` and scale factor; update tests that contradict the current intentional startup rule (always launch in full mode).
- Correct Gemini Live protocol tests to mark setup complete before testing outgoing realtime audio/video frames. Keep integration tests covering normal setup handshake.
- Run focused tests and confirm new security tests fail before implementation.

### 2. Harden Electron IPC and permissions
- Add a single fail-closed validator bound to the active HUD `webContents` and its main frame.
- Wrap every privileged invoke handler through the validator; keep handler bodies and channel contracts unchanged.
- Restrict media/notification permission requests and checks to the trusted HUD renderer.
- Add tests proving privileged calls from non-main frames and non-HUD renderers are rejected.

### 3. Correct window coordinate and recovery behavior
- Remove global primary-display scaling from BrowserWindow DIP positioning; use display work area in DIP coordinates.
- Keep display matching per window when resizing/repairing off-screen windows.
- Add bounded restart attempts with backoff, cleanup timers on close, and a terminal failure diagnostic rather than an infinite reload loop.
- Preserve current display modes, size presets, colors, layout and renderer design.

### 4. Improve autonomous execution reliability
- Raise configurable iteration ceilings while keeping conservative defaults and hard bounds.
- Persist safe task checkpoints after verified state transitions; mark an in-flight mutation interrupted after crash so it is reviewed rather than blindly replayed.
- Preserve existing trust boundary: web/page/file/OCR output is evidence, not instructions.
- Ensure completion claims always require independent verification and tool errors remain visible.
- Keep high-risk actions approval-gated; never use `autoApprove` to bypass blocked command rules.

### 5. Improve production runtime and packaging
- Remove GPU switches that bypass the GPU blocklist and driver workarounds; retain a supported opt-in software-rendering diagnostic override.
- Enable production minification and external source maps for main/preload/renderer bundles without changing CSS or markup.
- Add opt-in Windows login startup (off by default) and documented certificate environment support for signing; do not add or fabricate signing credentials.

### 6. Verification and review
- Run focused regression tests after each task.
- Run the full unit test suite, TypeScript checks, ESLint and production desktop build.
- Run package/static security checks and inspect `git diff --check` and the final changed-file list.
- Explicitly report any checks that depend on untracked local renderer files or unavailable credentials/hardware. Do not claim live voice, physical Windows UI automation or signed installer verification without executing those checks.

## Acceptance criteria

- All new security/regression tests pass.
- Privileged IPC rejects a foreign sender, child frame, or non-local renderer URL.
- BrowserWindow coordinates remain in Electron DIPs across mixed-DPI displays.
- Renderer crash recovery is bounded and does not create a reload loop.
- Autonomous tasks preserve checkpoints and never silently replay an unverified in-flight side effect.
- Destructive and externally consequential tasks remain approval-gated.
- Existing visual files remain unchanged.
- Unit tests, typecheck, lint and desktop build pass in a complete checkout, or remaining environmental blockers are precisely documented.
