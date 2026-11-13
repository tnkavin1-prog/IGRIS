# Gemetron — Hardware & Installer Testing Checklist

This document tracks the manual verification steps for items 3 and 7 of the
Phase 2 audit. These require physical hardware or a supervised installation
and cannot be automated by the test suite.

## Item 3: Physical hardware validation

### 3.1 Microphone and wake word

- [ ] Launch the packaged build (`release/desktop/win-unpacked/Gemetron.exe`)
- [ ] Verify Windows prompts for microphone permission on first launch
- [ ] Say "Hey Gematron" — the wake word service should emit a `wake` event
- [ ] Verify the HUD status changes to `listening` after the wake word
- [ ] Verify the microphone icon in the system tray shows active capture
- [ ] Test with a different microphone (USB, Bluetooth, headset)
- [ ] Test with background noise (fan, music) — wake word should not false-trigger
- [ ] Test wake word with different accents/pronunciations
- [ ] Verify `wake-word.ps1` exits cleanly when the app closes (no orphaned PowerShell)

### 3.2 Live session and barge-in

- [ ] Start a Live session and speak a command
- [ ] While the assistant is speaking, interrupt with a new command
- [ ] Verify audio playback stops immediately (barge-in)
- [ ] Verify the running workflow task pauses
- [ ] Verify the resume control appears in the ambient bar
- [ ] Click resume — verify the task continues from the paused step
- [ ] Test with rapid back-and-forth interruptions
- [ ] Verify no audio glitches or overlapping playback

### 3.3 Mixed-monitor real actions

- [ ] Connect two monitors with different resolutions/DPI
- [ ] Launch the HUD on the primary monitor
- [ ] Move the HUD to the secondary monitor
- [ ] Issue a "maximize window" command — verify the correct monitor is targeted
- [ ] Issue a "click at (x, y)" command — verify coordinates map correctly
- [ ] Switch display mode (orb/bar/full/console) on each monitor
- [ ] Verify the window never leaves the visible area on either monitor
- [ ] Disconnect the secondary monitor — verify the window moves to the primary

### 3.4 Complete model-driven workflows

- [ ] "Open Chrome and search for the weather" — verify full workflow
- [ ] "Find the PDF on my desktop and read it" — verify document pipeline
- [ ] "Create a PDF report about X" — verify document generation
- [ ] "Analyze this video" — verify video understanding
- [ ] "Take a screenshot and describe what you see" — verify screen capture
- [ ] "Scroll down and read the next page" — verify scrolling
- [ ] Test error recovery: disconnect network mid-workflow
- [ ] Test error recovery: close the target app mid-workflow
- [ ] Verify checkpoint resume after killing the process mid-task

## Item 7: Installer validation

### 7.1 Installation

- [ ] Run `Gemetron-Setup-1.0.0-x64.exe` on a clean Windows 10 machine
- [ ] Verify the installer shows the license agreement
- [ ] Verify the installation directory can be changed
- [ ] Verify desktop shortcut is created
- [ ] Verify Start Menu shortcut is created
- [ ] Verify the app launches after installation completes
- [ ] Verify `gemetron://` and `gematron://` protocol handlers are registered
- [ ] Test protocol: `start gemetron://summon` from cmd — verify the app opens

### 7.2 Uninstallation

- [ ] Uninstall via Settings > Apps
- [ ] Verify the app is removed from Program Files
- [ ] Verify desktop and Start Menu shortcuts are removed
- [ ] Verify protocol handlers are unregistered
- [ ] Verify user data (`%LOCALAPPDATA%\Gemetron` or install drive) is preserved
- [ ] Verify no orphaned processes after uninstall

### 7.3 Signed build (future)

- [ ] Obtain a code signing certificate
- [ ] Set `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables
- [ ] Run `npm run dist:desktop`
- [ ] Verify the installer is signed (right-click > Properties > Digital Signatures)
- [ ] Verify Windows SmartScreen does not warn

### 7.4 Hosted update

- [ ] Create a GitHub release with the installer and blockmap
- [ ] Set `GEMATRON_CHECK_UPDATES=true`
- [ ] Launch an older version — verify update notification appears
- [ ] Download and install the update — verify app restarts with new version
- [ ] Verify `latest.yml` is published to the release

### 7.5 Re-installation

- [ ] Install over an existing installation — verify clean upgrade
- [ ] Verify no duplicate Start Menu entries
- [ ] Verify protocol handlers are not duplicated
- [ ] Verify user settings are preserved across upgrades

## Notes

- Items marked with [ ] require manual execution on physical hardware.
- Results should be recorded in `docs/evidence/` with screenshots.
- Any failures should be filed as issues with the scenario and error details.
