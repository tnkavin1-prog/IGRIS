# Gemetron Desktop Engineering Walkthrough

Updated 2026-11-12. Windows 10/11, Electron 34, version 1.0.0. Implemented features are not equivalent to production hardening; consult [current status](IMPLEMENTATION_STATUS.md).

## Components

```text
HUD renderer / preload IPC
  -> Gemini Live service -> Google Live audio/tool calls
  -> autonomous agent -> Gemini vision planner + independent verifier
  -> native input / app manager / Windows UI Automation
  -> computer vision -> screenshot + local Windows OCR
  -> CDP client -> separate Chrome debugging profile
  -> application skill registry -> external applications/services
  -> metadata audit chain + local preferences/notes
```

The Chrome extension and token bridge are separate systems. The desktop uses its permanent key in the main process; the extension uses short-lived bridge-minted tokens.

## Voice and wake lifecycle

Wake detection is disabled by default. When enabled while idle, a PowerShell helper uses Windows System.Speech with an English "hey gematron" grammar, recognition confidence threshold, and cooldown. It emits only a wake event; it does not forward microphone audio to Google.

Before a foreground session connects, main waits for the wake helper to release the microphone. The renderer starts AudioWorklet capture after connection succeeds. Capture is resampled to mono PCM16 at 16 kHz; output is played at 24 kHz. A separate worklet file keeps capture compatible with the renderer's self-only script CSP.

Stopping/disconnecting clears capture and queued playback. Wake recognition resumes when the service returns to idle/closed/error. Physical microphone ownership and acoustic performance still need testing; the executed wake test used synthesized speech.

## Autonomous observe/act/verify loop

1. Capture an observation with screenshot, windows, cursor, and physical screen bounds.
2. Ask the configured Gemini vision model for one action, completion, or a blocked/approval decision. Screen text is untrusted evidence.
3. Validate the action allowlist and parameters. Convert screenshot-image coordinates to physical desktop coordinates, including negative monitor origins.
4. Execute exactly once. Mutations are not automatically retried.
5. Capture again and ask an independent verifier whether the intended change and goal are visibly supported.
6. Continue only within iteration/time limits. Repeated identical failed actions and consecutive unverified mutations stop the session.

An approval-required decision stops rather than authorizing itself; dangerous autonomous skill actions are blocked irrespective of auto-approval. This does not fix the broader direct voice-tool approval backlog.

Model requests have timeouts and cancellation signals. Cancelling aborts model/wait work and releases inputs after cleanup; it cannot undo completed changes or forcibly interrupt every native call. Completion claims require fresh evidence, not just successful tool return values.

The default planner model is `gemini-2.5-flash`, overridable with `GEMINI_AGENT_MODEL`. Screenshot planning and verification disclose visible content to Google and incur API costs.

## Browser and OCR grounding

The desktop CDP client ranks visible interactive text matches, checks occlusion, dispatches pointer events through CDP, uses native value setters for framework-controlled inputs, and uploads files on the same target connection. Finders are read-only; grounding dispatches one click through the matching backend.

Windows OCR runs locally and maps image rectangles to physical screen coordinates. Current capture is primary-display only; OCR confidence is a heuristic. Full frames/shadow DOM, horizontal scrolling, and scroll-fallback cleanup remain incomplete.

## State and audit

Development resources resolve from the checkout. Installed scripts/icons resolve from Electron resources, while writable state defaults to `%LOCALAPPDATA%\Gemetron`. `GEMATRON_DATA_DIR` overrides state storage; installed `.env` belongs there, never inside the archive.

Preferences/recipes live in ignored runtime notes. Audit JSONL records store tool/action identifiers, timestamps, sequence numbers, and verification metadata, not typed text, screenshot payloads, or raw tool arguments/results. Existing hashes are verified and the chain continues across restarts. Corruption is rejected; disk append failures retain in-memory records but stop disk logging.

Hashes are local tamper evidence, not an authenticated/immutable log against an attacker who can rewrite the whole file. Audit role labels are informational. No simulated health recovery, default-secret cloud relay, or drive-letter enforcement ships as a claimed capability.

## Packaging and operation

`npm run dist:desktop` compiles native C# helpers from source, bundles the HUD, and builds a per-user NSIS x64 installer. Unique OS-temp staging avoids sharing locked packaging outputs; final installer/blockmap/update metadata are copied to `release/desktop`.

No certificate was supplied, so current output is unsigned. Use `CSC_LINK`/`CSC_KEY_PASSWORD` for an authorized signing certificate. Packaging explicitly disables publishing. Installer uninstall preserves runtime state.

Updates run only in installed builds with `GEMATRON_CHECK_UPDATES=true`. Download and restart/install require distinct confirmations. Hosted release access and actual update installation remain untested.

Use `Ctrl+Alt+Space` to summon, `Ctrl+Alt+K` for emergency stop, or three Escapes while the HUD is focused. A single Escape stops active voice in compact modes. Closing the HUD ends foreground voice; opting into wake recognition permits idle listening afterward.

## Safety boundary and evidence

The desktop control API is currently unauthenticated with permissive CORS, shell restrictions are limited, and automatic approval defaults to enabled. Keep it local, use non-sensitive fixtures, disable automatic approval, and supervise native actions. Emergency stop is not a substitute for authorization or rollback.

Executed evidence includes native cursor reads, local OCR, synthesized wake recognition, header-authenticated Live setup, oscillator-fed AudioWorklet throughput, isolated Chrome forms/uploads, read-only real vision planning/verification, and packaged-archive rendering/mode switching. The package smoke used the actual archive through an Electron 34 bootstrap, not direct installed-executable or NSIS execution. Real microphone/Live workflows, full autonomous action workflows, install/uninstall, signing, and hosted update delivery are still unverified.
