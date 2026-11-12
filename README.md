# Gemetron

A Windows voice assistant with two separate surfaces: an Electron desktop HUD with native computer control, and a Chrome extension with its own browser agent and local token bridge.

**The desktop is not hardened for unattended sensitive use.** Its loopback control API lacks authentication, shell execution has limited restrictions, and automatic approval defaults to enabled. Extension safeguards do not automatically apply to the desktop.

## Desktop HUD

- Floating bar, orb, full voice view, advanced console, tray integration, and emergency-stop shortcuts.
- Gemini Live: PCM16 mono input at 16 kHz, output at 24 kHz, AudioWorklet capture, and playback interruption.
- Main-process API key sent through the `x-goog-api-key` WebSocket header, not the URL. Local credential storage is not an encrypted vault.
- Native mouse, keyboard, window management, clipboard, and UI Automation helpers.
- Offline Windows OCR with word/line rectangles. Capture currently targets the primary display; confidence is heuristic.
- Separate-profile Chrome CDP control, visible text targeting, React-compatible form updates, and file uploads. Frame/shadow-DOM parity remains incomplete.
- A real vision planner observes a screenshot, proposes one action, executes once, captures again, and independently verifies. Iteration limits, cancellation, and repeated-failure stopping are enforced.
- Application skills advertised according to availability; office, creative, and coding integrations require external applications/services.
- Opt-in local “Hey Jarvis” detection while idle. Wake detection and OCR run locally; foreground Live audio and vision go to Google.
- Metadata-only, SHA-256 hash-chained audit records continue across restarts. This is tamper evidence, not immutable or authenticated storage against a privileged attacker.

### Desktop quick start

Run from the checkout root; no fixed drive letter is required.

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
npm run build:desktop
npm run desktop
```

The setup script writes `apps/local-bridge/.env`. The desktop reads its `GEMINI_API_KEY` directly and does not need the bridge for Live authentication. The extension does need the bridge.

Test on non-sensitive material, disable automatic approval in settings, and keep a person present for native actions.

| Shortcut                       | Desktop action             |
| ------------------------------ | -------------------------- |
| `Ctrl+Alt+Space`               | Summon/toggle HUD          |
| `Ctrl+Alt+K`                   | Emergency stop             |
| `Escape` three times           | HUD-focused emergency stop |
| `Escape` once in compact modes | Stop active voice session  |

Cancellation aborts pending model work and waits and releases inputs. It cannot undo completed actions or guarantee interruption midway through every native operation.

### Runtime data and models

Development state lives under the checkout. Installed builds use `%LOCALAPPDATA%\Gemetron`; `GEMATRON_DATA_DIR` overrides writable state. Installed credentials come from that directory's `.env` or the process's `GEMINI_API_KEY`; Electron UI state lives in its `electron` subdirectory. Uninstall preserves app data.

Do not commit credentials, runtime notes, logs, downloads, or Chrome profiles. The planner defaults to `gemini-2.5-flash`, overridable with `GEMINI_AGENT_MODEL`. Its screenshot and verification calls incur API usage and can disclose visible content to Google.

### Installer and updates

```powershell
npm run dist:desktop
```

Produces `release/desktop/Gemetron-Setup-1.0.0-x64.exe`, its blockmap, and `latest.yml`. Requires Windows, .NET Framework 4.x, and the installed Electron distribution. Native helpers compile freshly from source; runtime notes and secrets are excluded.

The current installer is **unsigned**. Signing needs a certificate via `CSC_LINK` and, when needed, `CSC_KEY_PASSWORD`. Keep certificates/passwords outside version control. Windows may display an untrusted-publisher warning.

Updates default to off. Installed builds check only with `GEMATRON_CHECK_UPDATES=true`; download and restart/install each require confirmation. The feed targets configured GitHub repository `tnkavin1-prog/IGRIS`, but hosted releases/access are unverified. Packaging uses `publish: never`; nothing is uploaded.

## Chrome extension

The MV3 extension has a separate 52-tool engine, semantic DOM grounding, approval sheets, and an ephemeral-token Live session manager with reconnect/resumption. Its permanent key stays in the local bridge; Chrome receives short-lived tokens.

```powershell
npm run build
npm run bridge
```

Load `release/chrome-extension` using Chrome's **Load unpacked**, pair it with the setup script's gate secret, and allow microphone access when starting. The action icon opens the side panel; overlay commands operate on scriptable pages. Protected Chrome pages cannot be injected.

The bridge is loopback-only, single-user infrastructure, not a public service. See [installation](docs/INSTALLATION.md), [extension architecture](docs/ARCHITECTURE.md), [extension security](docs/SECURITY.md), and [tool reference](docs/TOOL_REFERENCE.md). Prompt framing reduces injection risk; it does not prove immunity.

## Commands

| Command                 | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `npm run typecheck`     | Check all four workspaces                                 |
| `npm run lint`          | ESLint                                                    |
| `npm test`              | Unit tests                                                |
| `npm run test:e2e`      | Chrome extension browser tests                            |
| `npm run build`         | Extension, bridge, and desktop bundles                    |
| `npm run build:desktop` | Desktop bundle only                                       |
| `npm run dist:desktop`  | Local NSIS x64 installer; no publishing                   |
| `npm run release`       | Extension ZIP and checksum                                |
| `npm run smoke:live`    | Real extension/bridge Live round trip; consumes API quota |

## Verification and remaining work

See [current implementation status](docs/IMPLEMENTATION_STATUS.md) and [desktop walkthrough](docs/JARVIS_SYSTEM_WALKTHROUGH.md). Older [extension test evidence](docs/TEST_REPORT.md) is historical, not a desktop certification.

Executed desktop probes cover header-authenticated Live setup, oscillator-fed worklet throughput, local OCR, a read-only real vision-planner/verifier call, isolated Chrome forms/uploads, synthesized-speech wake recognition, settings toggles, and packaged-archive startup with native cursor reads and all HUD modes.

Still unverified: physical-microphone wake/Live handoff, acoustic playback, complete real-model desktop action workflows, direct installed-executable launch, install/uninstall, signing, and hosted updates. Desktop reconnect/resumption/compression, approval/auth hardening, direct Live coordinate scaling, and full CDP frame/shadow/scroll handling remain backlog items.
