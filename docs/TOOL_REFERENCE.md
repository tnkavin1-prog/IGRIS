# Tool Reference

The model can call 52 tools. Every tool has:

- a strict JSON schema validated at runtime,
- an approval policy,
- a declared category,
- optional Chrome permission requirements,
- structured evidence in its response.

The catalog lives in `packages/shared/src/tools.ts` and is the single source of truth for declarations, validation, and tests.

**Approval policy key**

| Policy        | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `never`       | Executes without confirmation                                                                                  |
| `conditional` | Confirmation depends on the concrete target (submit/pay/delete wording, form submission, download, navigation) |
| `always`      | Always requires a user click in the approval sheet                                                             |

Even `never` tools can be refused by the risk assessor if the concrete target looks dangerous.

---

## Navigation (14)

| Tool                  | Approval   | Purpose                                                     |
| --------------------- | ---------- | ----------------------------------------------------------- |
| `get_browser_state`   | never      | Compact overview: active tab, focused window, other tabs    |
| `get_active_tab`      | never      | Active tab id, title, URL, loading state                    |
| `list_tabs`           | never      | All tabs with ids, titles, URLs, active flag                |
| `open_tab`            | never      | Open an absolute http(s) URL in a new tab and wait for load |
| `switch_tab`          | never      | Focus a tab by id or title/URL substring                    |
| `close_tab`           | **always** | Close a tab; unsaved work may be lost                       |
| `navigate_to_url`     | never      | Navigate a tab to an absolute http(s) URL and wait          |
| `go_back`             | never      | History back and wait                                       |
| `go_forward`          | never      | History forward and wait                                    |
| `reload_tab`          | never      | Reload and wait                                             |
| `wait_for_navigation` | never      | Wait for load completion or URL change                      |
| `get_current_url`     | never      | URL of the active tab                                       |
| `get_page_title`      | never      | Document title                                              |
| `set_zoom`            | never      | Zoom 50–200%                                                |

**Notes**

- `navigate_to_url` rejects `javascript:`, `data:`, `file:`, `blob:`, `chrome:`, and other internal schemes.
- `open_tab` and `navigate_to_url` strip URL credentials and sensitive query parameters before returning the URL to the model.
- `close_tab` is always gated, even with "confirm risky actions" off.

---

## Reading (15)

| Tool                     | Approval | Purpose                                                                                |
| ------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `get_page_snapshot`      | never    | Primary observation: title, URL, headings, cleaned text, numbered interactive elements |
| `read_visible_content`   | never    | Human-visible text, excluding chrome and hidden nodes                                  |
| `read_full_page_text`    | never    | Full document text including off-screen content                                        |
| `extract_headings`       | never    | h1–h4 outline                                                                          |
| `extract_links`          | never    | Links with text and absolute URL; optional query filter                                |
| `extract_images`         | never    | Images with alt text, dimensions, URL host                                             |
| `find_text_on_page`      | never    | Locate literal text, scroll to first match, return context and refs                    |
| `find_element`           | never    | Find by text, role, label, or name; return refs                                        |
| `get_element_state`      | never    | Visibility, enabled, checked, value (secrets redacted), role, name, bbox               |
| `get_page_structure`     | never    | Landmarks, forms, tables, lists, counts                                                |
| `extract_table_data`     | never    | Rows from a table, selected by `tableIndex`                                            |
| `compare_page_states`    | never    | Diff since a state token: URL, title, text length, element count, scroll               |
| `summarize_webpage`      | never    | Structured dossier tuned for summarisation                                             |
| `find_official_document` | never    | Rank document-like links (PDF/DOC, notices, circulars) without downloading             |
| `describe_visible_page`  | never    | Attach a screenshot and ask the model to describe what is rendered                     |

**Evidence**

- `get_page_snapshot` returns `fingerprint` (URL, title, generation, scroll, element count, text length, digest) plus bounded text and elements.
- `get_element_state` never returns password or one-time-code values.
- `compare_page_states` is the canonical way to verify that an action changed something.

**Limits**

| Limit             | Value             |
| ----------------- | ----------------- |
| Snapshot text     | 9,000 characters  |
| Snapshot elements | 120               |
| Full text         | 30,000 characters |
| Links             | 100               |

---

## Interaction (11)

| Tool                                 | Approval    | Purpose                                                                 |
| ------------------------------------ | ----------- | ----------------------------------------------------------------------- |
| `click_element`                      | conditional | Click by ref, selector, text, role, or coordinates; verify the receiver |
| `hover_element`                      | never       | Reveal hover menus/tooltips; report new items                           |
| `scroll_page`                        | never       | Scroll and report position plus whether more content exists             |
| `scroll_to_element`                  | never       | Scroll an element into view                                             |
| `type_text`                          | never       | Type into a field with real input/change events (React-safe)            |
| `clear_input`                        | never       | Clear a field                                                           |
| `select_dropdown`                    | never       | Choose a native `<select>` option by text or value                      |
| `set_checkbox`                       | never       | Set checkbox/radio to a desired state (no-op if already correct)        |
| `press_key`                          | conditional | Press Enter, Escape, Tab, arrows; Enter in a form may submit            |
| `focus_element`                      | never       | Focus and report `document.activeElement`                               |
| `wait_for_element` / `wait_for_text` | never       | Bounded waits for dynamic content                                       |

**Safety**

- `type_text` refuses password and one-time-code fields.
- `click_element` is `conditional`: the risk assessor escalates when the target text or surrounding form suggests submit/pay/delete.
- `press_key` is `conditional`: Enter inside a form is treated as a potential submission.
- Every click reports whether navigation or a DOM mutation followed.

---

## Forms and submission (2)

| Tool          | Approval    | Purpose                                         |
| ------------- | ----------- | ----------------------------------------------- |
| `submit_form` | **always**  | Submit the form containing a referenced element |
| `press_key`   | conditional | See above; Enter may submit                     |

`submit_form` is never auto-approved. The system instruction asks the model to let the user review the filled form first.

---

## Visual (3)

| Tool                    | Approval   | Purpose                                             |
| ----------------------- | ---------- | --------------------------------------------------- |
| `capture_viewport`      | never      | Screenshot the visible tab; returns `screenshotId`  |
| `describe_visible_page` | never      | Attach a fresh screenshot and request a description |
| `click_visual_target`   | **always** | Click pixel coordinates from the latest screenshot  |

**Visual click rules**

- Requires a `screenshotId` from `capture_viewport`.
- Rejected if the page changed since capture (fingerprint mismatch).
- Coordinates are scaled by device pixel ratio.
- Always gated, because a pixel target has no semantic guarantee.

---

## Images (2)

| Tool                   | Approval    | Purpose                                                 |
| ---------------------- | ----------- | ------------------------------------------------------- |
| `search_google_images` | never       | Open Google Images for a query in a new tab             |
| `open_image_result`    | conditional | Open the Nth image result and return the resulting page |

`open_image_result` is conditional because the destination is unknown until clicked.

---

## Browser data (4)

| Tool               | Approval   | Permission  | Purpose                                              |
| ------------------ | ---------- | ----------- | ---------------------------------------------------- |
| `search_bookmarks` | never      | `bookmarks` | Search bookmarks by title or URL                     |
| `search_history`   | never      | `history`   | Search the last 90 days, max 30 results (default 10) |
| `list_downloads`   | never      | `downloads` | Recent downloads with state and size                 |
| `cancel_download`  | **always** | `downloads` | Cancel an in-progress download                       |

All four check the optional permission at execution time and return `PERMISSION_DENIED` with a hint if it is missing.

---

## Downloads (2)

| Tool                         | Approval   | Permission  | Purpose                                                      |
| ---------------------------- | ---------- | ----------- | ------------------------------------------------------------ |
| `download_link`              | **always** | `downloads` | Download from a URL or link ref; report final state          |
| `download_verified_document` | **always** | `downloads` | Find a document by keywords, verify relevance, then download |

**Policy**

- Executable and script extensions are blocked (`.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.scr`, `.jar`, `.apk`, `.dmg`, `.pkg`, `.vbs`, `.wsf`, `.hta`).
- Downloads poll `chrome.downloads.search` until complete, interrupted, or timed out.
- The response reports filename, state, bytes, and whether the file is dangerous per Chrome.

---

## Complete list

<details>
<summary>All 52 tool names</summary>

```
get_browser_state      get_active_tab          list_tabs
open_tab               switch_tab              close_tab
navigate_to_url        go_back                 go_forward
reload_tab             wait_for_navigation     get_current_url
get_page_title         get_page_snapshot       read_visible_content
read_full_page_text    extract_headings        extract_links
extract_images         find_text_on_page       find_element
get_element_state      get_page_structure      extract_table_data
click_element          hover_element           scroll_page
scroll_to_element      type_text               clear_input
select_dropdown        set_checkbox            press_key
focus_element          wait_for_element        wait_for_text
submit_form            capture_viewport        describe_visible_page
click_visual_target    compare_page_states     search_google_images
open_image_result      search_bookmarks        search_history
list_downloads         download_link           cancel_download
set_zoom               find_official_document  download_verified_document
summarize_webpage
```

</details>

---

## Common response shape

Success:

```json
{
  "result": {
    "ok": true,
    "summary": "Clicked “Sign in”.",
    "data": { "...": "..." },
    "evidence": {
      "target": "element_014",
      "changed": true,
      "url": "https://example.com/account"
    }
  }
}
```

Failure:

```json
{
  "error": {
    "message": "The element is not visible.",
    "code": "NOT_VISIBLE",
    "hint": "Scroll it into view or choose another target.",
    "retryable": true
  }
}
```

The orchestrator truncates oversized results to 14,000 characters before sending them to Gemini.

---

## Adding a tool

1. Add a `ToolDefinition` to `TOOLS` in `packages/shared/src/tools.ts`.
2. Add a handler case in `apps/chrome-extension/src/tools/executor.ts`.
3. Add a display title in `apps/chrome-extension/src/agent/orchestrator.ts`.
4. If it needs a new page operation, extend `PageOp` and implement it in the content script.
5. Add tests for schema validation, risk policy, and execution.

The Gemini declaration, runtime validator, and risk assessment derive from the same definition.
