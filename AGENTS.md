# Workspace Execution Guardrails

## 1. UI Mockup Fidelity
- When the user provides an HTML/CSS reference file or mockup screenshot, implement the design 1:1.
- Do NOT add extraneous headers, titles, settings icons, or helper banners not present in the reference design.

## 2. Windows GUI Process Spawning
- In Windows batch/PowerShell launchers, never launch GUI applications (Electron, Chrome, native apps) via WMI (`Win32_Process Create`) or Session 0 isolation mechanisms.
- Always use `Start-Process` with `-WorkingDirectory` to ensure the process attaches to the user's interactive desktop.

## 3. Delegation Preference
- When the user requests direct execution ("do it yourself", "no subagents"), perform all analysis, edits, and verification directly in the main agent turn.
