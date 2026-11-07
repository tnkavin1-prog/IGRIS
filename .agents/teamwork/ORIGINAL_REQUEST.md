# Original User Request

## Initial Request — 2026-11-07T02:50:48Z

This is a single self-contained fix; keep it small and focused. Implement a 1-click 'Ask Gemini' tool inside Google Chrome in `apps/chrome-extension` to summon the Gemini Desktop HUD via its local ControlServer at `http://127.0.0.1:9228/summon`.

Working directory: E:\Gemetron
Integrity mode: development

## Requirements

### R1. Chrome Extension 'Ask Gemini' Tool Entry Points
Implement an 'Ask Gemini' tool in the Google Chrome extension (`apps/chrome-extension`) accessible through both the Chrome toolbar action button and a context menu entry (displayed on right-clicking on a webpage or selected text).

### R2. Context Extraction & Summon Integration
When invoked from either the toolbar action or the context menu, capture active page context (selected text if present; otherwise page title and URL) and send an HTTP POST request to `http://127.0.0.1:9228/summon` with `{ prompt: <context string> }` to un-minimize, raise, and focus the Gemini Desktop HUD.

### R3. Platform & Workspace Constraints
Work EXCLUSIVELY on the E: drive within `E:\Gemetron`. Never create, modify, or touch any files on C:. All dependencies, source code, build scripts, and tests must reside strictly on E:.

## Verification Resources
Use existing test suites and build scripts in `E:\Gemetron`.

## Acceptance Criteria

### Tool Availability & Activation
- [ ] Clicking the Chrome extension action / toolbar button triggers an HTTP POST request to `http://127.0.0.1:9228/summon`.
- [ ] Right-clicking anywhere on a webpage or on selected text displays an 'Ask Gemini' context menu option.
- [ ] Activating the 'Ask Gemini' context menu option triggers an HTTP POST request to `http://127.0.0.1:9228/summon`.

### Payload & HUD Control
- [ ] If text is selected when the tool is clicked, the selected text is included in the `{ prompt }` payload.
- [ ] If no text is selected, the page title and page URL are included in the `{ prompt }` payload.
- [ ] ControlServer receives the summon request and focuses the Gemini HUD window without errors.

### Workspace & Build Integrity
- [ ] The Chrome extension builds cleanly using repository tooling in `E:\Gemetron`.
- [ ] All code, tests, and configuration changes reside strictly on E: within `E:\Gemetron`. No files on C: are created, modified, or touched.
