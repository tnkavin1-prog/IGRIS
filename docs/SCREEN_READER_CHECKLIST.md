# Manual screen-reader pass (Windows / NVDA)

The automated axe audit proves the DOM is _shaped_ correctly. It cannot prove a
screen reader actually announces it well. This checklist is the manual pass.
It takes about 20 minutes and is the last accessibility item that automation
cannot cover.

## What you need

- Windows 10 or 11 (this project targets Windows only).
- [NVDA](https://www.nvaccess.org/download/) — free, no account required.
- Google Chrome with the unpacked extension loaded (`release/chrome-extension`).
- Optional: [Accessibility Insights for Windows](https://accessibilityinsights.io/)
  for a second opinion on contrast and control names.

## Setup (5 minutes)

1. Install NVDA and accept the default synthesizer.
2. Build and load the extension:
   ```powershell
   npm run build
   ```
   Then `chrome://extensions` → Developer mode → **Load unpacked** →
   `release/chrome-extension`.
3. Start the bridge in another window: `npm run bridge`.
4. Open the side panel and pair it with the gate secret from
   `apps/local-bridge/.env`.
5. Press **NVDA+Q** to quit NVDA, then launch it again with **Ctrl+Alt+N** so it
   attaches to the already-running Chrome. (Attaching after Chrome is running is
   more reliable than starting NVDA first.)

## Pass 1 — Onboarding dialog

Reset the extension first (Chrome `chrome://extensions` → Remove and re-add, or
clear storage from DevTools → Application → Storage).

| #   | Action                                                | Expected announcement                                            | Result |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| 1   | Focus the side panel                                  | "Welcome… dialog" plus the dialog title                          | ☐      |
| 2   | Press **Tab**                                         | Each step dot announces its kicker ("Connect", "Permissions", …) | ☐      |
| 3   | Press **Tab** to the last control, then **Tab** again | Focus wraps inside the dialog, never escapes to the page behind  | ☐      |
| 4   | Press **Esc**                                         | Dialog closes and focus returns to the button that opened it     | ☐      |
| 5   | Reopen onboarding                                     | Focus lands on the first control, not the browser chrome         | ☐      |

## Pass 2 — Main panel

| #   | Action                             | Expected announcement                                                     | Result |
| --- | ---------------------------------- | ------------------------------------------------------------------------- | ------ |
| 6   | **Tab** from the top               | Header, session status, then transcript region announced as a live region | ☐      |
| 7   | Type in the composer               | "Message Gemini, edit text"                                               | ☐      |
| 8   | Tab to send                        | "Send message, button"                                                    | ☐      |
| 9   | Tab to the live button             | "Start live session, button"                                              | ☐      |
| 10  | Start a session                    | Status change is announced without stealing focus                         | ☐      |
| 11  | Trigger a tool result              | Transcript update announced politely, not interrupting typing             | ☐      |
| 12  | Trigger an error (stop the bridge) | Error toast announced assertively                                         | ☐      |

## Pass 3 — Settings dialog

| #   | Action                               | Expected announcement                                    | Result |
| --- | ------------------------------------ | -------------------------------------------------------- | ------ |
| 13  | Open settings                        | "Settings, dialog" with the active tab announced         | ☐      |
| 14  | Arrow through the tab list           | "Connection, tab 1 of 4", etc.                           | ☐      |
| 15  | Tab into the first field             | Label, current value, and whether it is required         | ☐      |
| 16  | Toggle a switch                      | State announced as "on"/"off" (not just the label)       | ☐      |
| 17  | Press **Esc**                        | Closes settings; focus returns to the gear button        | ☐      |
| 18  | Open approval while settings is open | Approval dialog is the only reachable layer (see pass 4) | ☐      |

## Pass 4 — Approval dialog

Trigger an approval by asking the agent to submit a form, or by using the E2E
fixture page. The dialog must be announced even when settings is open.

| #   | Action                             | Expected announcement                                              | Result |
| --- | ---------------------------------- | ------------------------------------------------------------------ | ------ |
| 19  | Approval opens                     | "Approval required, dialog" and the action summary                 | ☐      |
| 20  | **Tab**                            | Focus stays inside the approval dialog only                        | ☐      |
| 21  | Press **Esc**                      | Denies the action, closes, and returns focus to the previous layer | ☐      |
| 22  | Press **Tab** past the last button | Wraps to the first control                                         | ☐      |

## Pass 5 — Live audio and barge-in

| #   | Action                         | Expected announcement                                        | Result |
| --- | ------------------------------ | ------------------------------------------------------------ | ------ |
| 23  | Start a live session and speak | Partial transcripts announced politely                       | ☐      |
| 24  | Interrupt the model            | Transcript stops updating; status announces the interruption | ☐      |
| 25  | End the session                | Status announces "ended", focus stays in the composer        | ☐      |

## Recording the result

Copy this file to `docs/evidence/screen-reader-YYYY-MM-DD.md`, fill in the
Result column with ✅ / ❌ and a one-line note for every ❌, then update the
accessibility row in `docs/IMPLEMENTATION_STATUS.md` from
`**PASS** (automated) / **PARTIAL** (manual)` to `**PASS**` once all 25 items
pass.

If an item fails, file it as a bug with:

- the NVDA version (Help → About),
- the Chrome version (`chrome://version`),
- the exact announcement you heard instead.

## Known false positives

- NVDA sometimes announces the panel as "document" before the dialog role
  settles. Press **Insert+Space** (focus mode) and re-read.
- Windows may start NVDA in "browse mode" for the side panel. Press
  **Insert+Space** to switch to focus mode before tabbing through controls.
