# Installation

This guide takes you from a clean checkout to a working voice session.

---

## 1. Prerequisites

| Requirement       | Minimum | Notes                           |
| ----------------- | ------- | ------------------------------- |
| Node.js           | 20.19   | 24.x tested                     |
| npm               | 10      | Ships with Node 24              |
| Chrome / Chromium | 116     | Side Panel API                  |
| Gemini API key    | —       | Must have Live API access       |
| Microphone        | —       | Headphones strongly recommended |

Check versions:

```powershell
node --version
npm --version
```

---

## 2. Install dependencies

From the repository root (`E:\Gemetron`):

```powershell
npm install
```

This installs three workspaces: `packages/shared`, `apps/chrome-extension`, `apps/local-bridge`.

---

## 3. Create the bridge configuration

### Windows (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
```

The script:

1. reads `apps/chrome-extension/manifest.json`,
2. derives the stable extension ID from the manifest `key` (SHA-256 → first 16 bytes → `a`–`p`),
3. prompts for the Gemini API key without echoing it,
4. generates a 43-character gate secret from 32 random bytes,
5. writes `apps/local-bridge/.env` as UTF-8 **without a BOM**,
6. best-effort restricts the file ACL to your user,
7. prints the gate secret to paste into the extension.

Options:

```powershell
# Non-interactive
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -ApiKey "AQ...."

# Different port (must also change Settings → Connection)
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -Port 47822

# Replace an existing .env (invalidates the old gate secret)
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -Force
```

> **Why ASCII-only?** Windows PowerShell 5.1 parses files without a BOM as ANSI. Non-ASCII characters in the script would corrupt. The script is intentionally ASCII-only, and writes `.env` with an explicit UTF-8 no-BOM encoder.

### macOS / Linux (manual)

```bash
cp apps/local-bridge/.env.example apps/local-bridge/.env
```

Edit `apps/local-bridge/.env`:

```dotenv
GEMINI_API_KEY=your-real-key
LOCAL_GATE_SECRET=<at-least-32-random-characters>
PORT=47821
ALLOWED_EXTENSION_IDS=hhbdkheccnmpbdadhhppbemcjkaimlob
TOKEN_TTL_MINUTES=30
NEW_SESSION_TTL_SECONDS=60
RATE_LIMIT_PER_MINUTE=30
LOG_LEVEL=info
ALLOWED_ORIGINS=
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The manifest ships a fixed `key`, so an unpacked build gets the ID `hhbdkheccnmpbdadhhppbemcjkaimlob`. Confirm on `chrome://extensions` after loading; if it differs, update `ALLOWED_EXTENSION_IDS`.

---

## 4. Build

```powershell
npm run build
```

Outputs:

```
release/chrome-extension/
  manifest.json
  sidepanel.html
  assets/sidepanel-<hash>.js
  assets/sidepanel-<hash>.css
  background.js
  content.js
  capture-worklet.js
  playback-worklet.js
  icons/icon16.png … icon128.png
apps/local-bridge/dist/server.mjs
```

The build asserts that every expected artifact exists and is non-empty. It fails loudly rather than producing a broken extension.

Extension-only rebuild (faster, leaves the bridge untouched):

```powershell
npm run build:extension
```

---

## 5. Start the bridge

```powershell
npm run bridge
```

Expected output:

```
  Gemini Browser Live — local bridge v1.0.0
  Listening on http://127.0.0.1:47821 (loopback only)
  Health:     http://127.0.0.1:47821/api/health
  API key:    AQ.…(53 chars)  (never leaves this process)
  Allowlist:  hhbdkheccnmpbdadhhppbemcjkaimlob

  Keep this window open while you use the extension. Ctrl+C stops the bridge.
```

Leave this window open. The extension needs the bridge to mint tokens.

Verify:

```powershell
Invoke-RestMethod http://127.0.0.1:47821/api/health | ConvertTo-Json
```

Expected: `{"ok":true,"service":"Gemini Browser Live local bridge","version":"1.0.0",...}`.

---

## 6. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select `E:\Gemetron\release\chrome-extension`.
5. Confirm the extension card shows ID `hhbdkheccnmpbdadhhppbemcjkaimlob`.
6. Pin the extension if you want one-click access.

Do not load the repository root — Chrome needs `manifest.json` at the folder root.

---

## 7. Pair the extension

1. Click the extension icon (or press `Alt+Shift+O`). The floating overlay appears on the current tab; on `chrome://` and other protected pages the side panel opens instead.
2. Open **Settings → Connection**.
3. Confirm **Bridge URL** is `http://127.0.0.1:47821` (or your custom port).
4. Paste the gate secret printed by the setup script.
5. Press **Test connection**. You should see the bridge version and model count.
6. Press **Save settings**.

The secret is stored in `chrome.storage.local` and sent as a bearer token on every bridge request. It is never sent to Google.

---

## 8. First session

1. Press **Start live** (or `Alt+Shift+S`).
2. Allow microphone access when Chrome asks.
3. Wait for the status to become **Listening**.
4. Say: _“What page am I on?”_
5. The agent should call `get_browser_state` or `get_page_snapshot` and answer.

The overlay is pinned 20 px from the bottom-right. Drag the grip to move it, the minus button to collapse it to an orb, and the cross to close it. Closing the overlay ends the session. If you open a second surface while a session is live, it reports “The assistant is already running in another window.” instead of opening a second microphone.

If you see **Bridge offline**, the bridge is not running or the URL/secret is wrong. See troubleshooting below.

---

## 9. Verify the installation

Run the automated checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Run a real Live API round trip (uses your key, makes a short request):

```powershell
npm run smoke:live
```

Expected:

```
▸ Bridge already running at http://127.0.0.1:47821
▸ Token minted
▸ Setup complete in 1556 ms
▸ First audio in 2026 ms (69123 bytes)
▸ Transcript: Smoke test passed.
✔ PASS — Live API round-trip completed in 2231 ms
```

Timings vary with network conditions. The pass condition is that setup completes and audio or a transcript arrives.

Build a distributable archive:

```powershell
npm run release
```

Outputs `release/Gemini-Browser-Live-Chrome.zip` and `release/SHA256SUMS.txt`.

---

## 10. Updating

```powershell
git pull            # or replace the source
npm install
npm run build
```

Then:

1. Go to `chrome://extensions`.
2. Press the reload icon on the Gemini Browser Live card.
3. Reopen the side panel.

Settings and the gate secret survive reloads. If you regenerate `.env`, re-paste the new secret.

---

## 11. Uninstalling and cleanup

1. Remove the extension from `chrome://extensions`.
2. Stop the bridge with `Ctrl+C`.
3. Delete `apps/local-bridge/.env` (contains the API key).
4. Optionally delete `release/` and `node_modules/`.

Removing the extension clears its `chrome.storage.local`, including the gate secret and any retained transcript.

---

## Troubleshooting

### “Bridge offline”

| Cause                         | Fix                                                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| Bridge not running            | `npm run bridge`                                                     |
| Wrong port                    | Check `PORT` in `.env` and the Bridge URL in Settings                |
| Wrong secret                  | Re-paste from `.env` or re-run setup                                 |
| Extension ID mismatch         | Compare the ID on `chrome://extensions` with `ALLOWED_EXTENSION_IDS` |
| `ALLOWED_EXTENSION_IDS` empty | Re-run the setup script                                              |

The bridge logs origin, host, and gate-secret rejections. Rate-limited requests return a `rate_limited` error with a retry window.

### “The local bridge did not respond in time”

A request exceeded 8 seconds. Check that the bridge process is healthy and that a proxy/VPN is not intercepting loopback traffic.

### “Gemini rejected the API key”

- Confirm the key is active and has Live API access.
- Confirm there is no whitespace or BOM in `.env`.
- The bridge never echoes the key; check `GEMINI_API_KEY` directly.

### “Gemini rate limit or quota reached”

The key hit a quota. Wait for the `retryAfter` window shown in the error, or use a different key.

### Port already in use

```
Port 47821 is already in use.
```

Stop the other process:

```powershell
Get-NetTCPConnection -LocalPort 47821 | Select-Object OwningProcess
Stop-Process -Id <pid>
```

Or change `PORT` and the Bridge URL together.

### Microphone permission denied

Chrome remembers the denial per extension. Reset it:

1. `chrome://settings/content/microphone`
2. Remove the extension's blocked entry.
3. Reload the extension and start again.

### No audio playback

- Check the output device in **Settings → Voice**.
- Confirm the output volume is above zero.
- Some Bluetooth devices take a moment to switch profiles; wait a second and retry.
- Check `chrome://settings/content/sound`.

### The agent cannot act on a page

- Protected pages (`chrome://`, Web Store, other extensions) cannot be scripted. Navigate to a normal page.
- If Chrome site access is restricted, set **Site access → On all sites** for the extension, or grant the specific site.
- Reload the tab after installing or updating the extension so the content script can inject cleanly.

### Tools that need optional permissions fail

Open **Settings → Access** and enable the relevant capability. The executor returns `PERMISSION_DENIED` with a hint instead of silently failing.

### Build fails on Node 20.18 or older

Vite 8 requires Node ≥ 20.19. Upgrade Node.

### `.env` first key is not parsed

Windows PowerShell 5.1's `-Encoding UTF8` writes a BOM. The setup script avoids this. If you created the file manually with PowerShell, rewrite it as UTF-8 without BOM or run the setup script.

### Extension ID changed

The ID is derived from the manifest `key`. If you edit or remove `key`, the ID changes and the bridge rejects the new origin. Either restore the original key or update `ALLOWED_EXTENSION_IDS`.

---

## Manual verification checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (156 tests)
- [ ] `npm run test:e2e` passes (5 tests)
- [ ] `npm run build` produces all artifacts
- [ ] Bridge starts and `/api/health` returns `ok: true`
- [ ] Extension loads with the expected ID
- [ ] **Test connection** succeeds
- [ ] **Start live** reaches Listening
- [ ] A page-reading request returns real content
- [ ] A consequential action shows the approval sheet
- [ ] Denying the approval returns a denial to the model
- [ ] Stopping the session releases the microphone
