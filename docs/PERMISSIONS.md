# Chrome Permissions

Gemini Browser Live asks for the minimum set of permissions that makes voice-driven browser control possible, and requests the sensitive ones only when you use the feature that needs them.

---

## Summary

| Permission                                    | Type         | Why                                                            | User-visible prompt |
| --------------------------------------------- | ------------ | -------------------------------------------------------------- | ------------------- |
| `sidePanel`                                   | Required     | Host the agent UI in Chrome's side panel                       | Install-time        |
| `tabs`                                        | Required     | List, create, switch, and close tabs; read tab URLs and titles | Install-time        |
| `scripting`                                   | Required     | Inject the content script into the active tab on demand        | Install-time        |
| `storage`                                     | Required     | Save settings, the gate secret, and optional transcript        | Install-time        |
| `activeTab`                                   | Required     | Operate the tab the user is looking at                         | Install-time        |
| `downloads`                                   | **Optional** | Start, inspect, and cancel agent downloads                     | On first use        |
| `bookmarks`                                   | **Optional** | Search bookmarks on request                                    | On first use        |
| `history`                                     | **Optional** | Search the last 90 days of history on request                  | On first use        |
| `http(s)://*/*`                               | Host         | Read and operate arbitrary pages                               | Install-time        |
| `http://127.0.0.1:*/*`                        | Host         | Reach the local token bridge                                   | Install-time        |
| `https://generativelanguage.googleapis.com/*` | Host         | Connect to the Gemini Live API                                 | Install-time        |

---

## Required permissions

### `sidePanel`

**Used by:** `background.ts`

Chrome's Side Panel API is the product surface. The service worker calls:

- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so clicking the toolbar icon opens the panel,
- `chrome.sidePanel.setOptions({ path, enabled })` to register `sidepanel.html`,
- `chrome.sidePanel.open({ windowId })` for keyboard shortcuts.

**What it does not grant:** access to page content, network, or storage.

**Why it cannot be optional:** without it there is no UI.

---

### `tabs`

**Used by:** `tools/executor.ts`, `background.ts`

Needed to:

- enumerate tabs (`list_tabs`, `get_browser_state`),
- read the active tab's URL and title,
- create (`open_tab`), switch (`switch_tab`), and close (`close_tab`) tabs,
- target the correct tab for injection and navigation.

**What it does not grant:** the ability to read page DOM. That requires `scripting` or a content script.

**Privacy note:** tab URLs and titles can be sensitive. They are sent to Gemini only when a tool result includes them, and the agent is told to read only what the user asked for.

---

### `scripting`

**Used by:** `tools/page.ts`

The content script is injected on demand:

```ts
await chrome.scripting.executeScript({
  target: { tabId },
  files: ['content.js'],
});
```

**What it does not grant:** permission to run on protected pages (`chrome://`, the Web Store, other extensions). Chrome refuses those injections, and the executor reports `PAGE_UNSUPPORTED`.

**Why on demand:** a persistent content script would run on every page at every load, increasing overhead and exposure. Injection happens only when the agent needs to observe or act.

---

### `storage`

**Used by:** `sidepanel/storage.ts`

Stores:

- settings (`gbl.settings.v1`),
- the bridge gate secret (`gbl.bridgeSecret.v1`),
- the onboarding flag,
- the transcript, only when retention is set to "Keep on this device".

`chrome.storage.local` is not synced across devices. The API key is never stored here.

---

### `activeTab`

**Used by:** injection and tab operations

Grants temporary access to the active tab when the user invokes the extension. It complements the broad host permission and keeps the extension usable in contexts where host permissions are restricted by enterprise policy.

---

## Optional permissions

These are declared under `optional_permissions` and are **not** granted at install. The Settings → Access tab shows a toggle for each. Turning one on calls `chrome.permissions.request()`, which must originate from a user gesture — the toggle click satisfies that requirement.

The executor checks `chrome.permissions.contains()` at execution time. If a tool needs a permission that is missing, it returns `PERMISSION_DENIED` with a hint to ask the user, rather than failing with a Chrome error.

### `downloads`

**Tools:** `download_link`, `list_downloads`, `cancel_download`, `download_verified_document`

**Why optional:** downloading files is consequential. Users who never ask the agent to download something should not grant it.

**Additional policy:** executable and script extensions (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.sh`, `.js`, …) are blocked by the executor even with the permission granted. Every download requires approval.

---

### `bookmarks`

**Tool:** `search_bookmarks`

**Why optional:** bookmarks are personal data. Searching them is only useful for a subset of users.

**Scope:** read-only search. The extension has no tool that creates, edits, or deletes bookmarks.

---

### `history`

**Tool:** `search_history`

**Why optional:** browsing history is among the most sensitive local data.

**Scope:** read-only search over the last 90 days, capped at 30 results (default 10). The extension has no tool that deletes history.

---

## Host permissions

### `http://127.0.0.1:*/*` and loopback

Required to call the local bridge (`POST /api/token`, `GET /api/health`, `GET /api/config`).

The bridge URL is validated in Settings to `127.0.0.1` or `localhost` only. IPv6 `[::1]` is rejected because Chrome's extension CSP does not accept it.

### `https://generativelanguage.googleapis.com/*`

Required for the Live WebSocket (`wss://` shares the host permission) and any REST calls.

### `http://*/*` and `https://*/*`

Required to operate arbitrary websites: injecting the content script, reading the DOM, clicking, typing, navigating.

This is the broadest permission in the manifest. It is unavoidable for a general-purpose browser agent. Mitigations:

- injection is on demand, not persistent,
- protected Chrome surfaces are refused,
- page content is framed as untrusted data,
- consequential actions are gated,
- the Settings privacy panel states that page data is sent to Gemini only when a tool asks for it.

If you want to restrict the agent to specific sites, use Chrome's **Site access** controls on `chrome://extensions` → Details → Site access. The agent will report `PERMISSION_DENIED` on sites it cannot reach.

---

## What the extension cannot do

Even with all permissions granted:

- It cannot run on `chrome://` pages, the Chrome Web Store, or other extensions' pages.
- It cannot read your passwords, autofill data, or cookies directly.
- It cannot modify extension settings or policy.
- It cannot access the filesystem beyond Chrome's download mechanism.
- It cannot execute arbitrary code from the network (CSP forbids it).
- It cannot grant itself optional permissions; only a user gesture can.
- It cannot approve its own actions.

---

## Permission checklist for reviewers

| Question                                      | Answer                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Does it read all pages?                       | Only when the agent is asked to, via on-demand injection.                    |
| Does it run in the background on every page?  | No. The service worker is thin and the content script is injected on demand. |
| Does it send data anywhere other than Google? | No.                                                                          |
| Does it store the API key in Chrome?          | No.                                                                          |
| Can optional permissions be enabled silently? | No. They require a user click.                                               |
| Can the agent download executables?           | No. Blocked by policy.                                                       |
| Can the agent make purchases?                 | Only with explicit approval; payment-like actions are always gated.          |
| Can page content approve an action?           | No. Consent is a controller method reachable only from the approval UI.      |
