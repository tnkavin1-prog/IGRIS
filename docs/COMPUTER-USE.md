# Computer Use — Gemetron

OS-level computer control for Windows, driven by AutoHotkey v2.
This is what lets the agent *see* and *operate* the real desktop, not just the
browser.

---

## Install locations

| Component | Path |
| --- | --- |
| AutoHotkey v2 (portable) | `E:\AutoHotkey\` (`AutoHotkey64.exe`) |
| Control library + jobs | `E:\AutoHotkey\gem\` |
| CLI wrapper | `scripts/cu.ps1` |
| Screen capture | `scripts/screen-capture.ps1` |
| Convenience launcher | `cu.bat` (repo root) |

AutoHotkey v2.0.18 portable was extracted from the official GitHub release —
no installer, no registry writes, no admin rights, nothing on `PATH`.

---

## Quick reference

```powershell
# See the screen (returns a PNG path you can open / analyse)
.\cu.bat shot
.\cu.bat shot "Calculator"          # capture just one window
.\cu.bat shot -Gray                 # greyscale (smaller, faster)

# Inventory every visible top-level window with position and size
.\cu.bat wins

# Mouse
.\cu.bat click 640 400
.\cu.bat click 640 400 Right 1
.\cu.bat dblclick 640 400
.\cu.bat drag 100 100 500 500
.\cu.bat scroll 640 400 -5          # negative = scroll down

# Windows
.\cu.bat focus "Calculator" 6 sub   # substring match, 6s timeout
.\cu.bat focus "Document1 - Word"   # exact match (default)

# Apps
.\cu.bat launch "notepad.exe C:\path\file.txt"
```

### Keyboard actions require a target

Typing is **refused** unless the foreground window matches an expectation.
This exists because an early run typed into the wrong Notepad window.

> **Gotcha: never pass AHK send-syntax through `cu.bat`.**
> `cu.bat` is a batch file, and `cmd.exe` treats `^` as its escape character,
> so `"^t"` arrives as `"t"`. Call `scripts\cu.ps1` directly from PowerShell:
>
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cu.ps1 `
>     do --into "Notepad" --sub --keys "^t"
> ```
>
> `cu.bat` is still fine for caret-free commands (`shot`, `wins`, `click`, `type`).

```powershell
.\cu.bat focus "Calculator" 6 sub
.\cu.bat type "hello" "Calculator"    # refused unless Calculator is focused
.\cu.bat keys "^s" "Calculator"
```

### Atomic action sequences (preferred)

A single job that re-asserts focus before *every* step. Use this whenever the
desktop is contended, because separate CLI calls can lose focus in between.

```powershell
.\cu.bat do --into "Calculator" --sub --click 568 668 --sleep 120 --click 190 668
.\cu.bat do --into "Notepad" --sub --keys "^{End}" --type "appended text" --grab
```

Supported actions: `--type`, `--keys`, `--click`, `--rclick`, `--dclick`,
`--scroll`, `--drag`, `--sleep`, `--grab`, `--wait`.

### Reading text back

```powershell
.\cu.bat grab "Notepad"     # Ctrl+A, Ctrl+C, dump clipboard to stdout
```

`--grab` inside `do.ahk` writes to `E:\AutoHotkey\gem\grabbed.txt`.

---

## How it works

`lib.ahk` is the shared prelude. Every job includes it and ends with `GemDone()`:

- installs an `OnError` handler, so a failing script **logs and exits instead of
  opening a modal dialog** (a stuck AHK dialog blocks the whole desktop)
- forces `CoordMode` to screen coordinates so pixels from screenshots map 1:1
- provides window, mouse, keyboard, clipboard and guard helpers

`result.txt` is the machine-readable channel: one `key=value` per line, ending
with `DONE=<code>`.

### Coordinate space

Screenshots are captured DPI-aware at physical pixels (this machine is 125 %
scaling, 1920x1080). AHK is also DPI-aware, so a coordinate read off a
screenshot can be passed straight to `click`.

### Window matching

`SetTitleMatchMode` defaults to **3 (exact)** for `focus` and `do`. Use `--sub`
or `sub` for substring matching. Never rely on loose matching for destructive
actions — Windows 11 Notepad reuses one window for all tabs and renames it.

---

## Verified capabilities

All of the following were exercised on this machine (2026-11-15):

| Capability | Evidence |
| --- | --- |
| Screenshot + visual understanding | desktop and per-window captures |
| Window enumeration | hwnd, pid, class, rect, title for all top-level windows |
| App launch | Notepad, Calculator |
| Mouse clicks | Calculator: 8 7 + 9 = produced `96`, confirmed in history |
| Keyboard | `^{End}`, `{Enter}`, `%{F4}` delivered to the focused window |
| Guard / refusal | keystroke refused when foreground did not match |
| Clipboard read-back | `grabbed.txt` round-trip |

## Known limitations

- **Focus stealing.** A busy desktop (an app still loading) can take focus
  between steps. Prefer `do.ahk` sequences, and give slow apps `--wait 1500`.
- **Modern Notepad.** Win11 Notepad is a tabbed app; `ControlGetText`/`ControlSend`
  cannot reach its editor. Use `--keys` / `--type` plus `--grab`.
- **Elevated windows.** UIPI blocks input from this process into windows running
  as administrator. Run the agent elevated if that is required.
- **Secure desktop.** UAC prompts and the lock screen are not capturable or
  clickable by design.
- **Electron integration** is not wired yet — this is agent-side control today.
  See the roadmap below.

---

## Roadmap

1. Expose the same action set to the HUD as IPC so voice commands can drive it
   (`apps/desktop-hud/src/main/native-input.ts` already has mouse/keyboard primitives).
2. Add UI Automation fallback for element-level targeting instead of pixels.
3. Add an OCR pass over screenshots so text targets can be located by name.
4. Record/replay: capture an action sequence and replay it deterministically.
