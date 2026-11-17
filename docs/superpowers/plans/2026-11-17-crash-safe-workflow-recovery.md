# Crash-Safe Workflow Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [x]\`) syntax for tracking.

**Goal:** Ensure interrupted workflow actions are never silently replayed after an application restart.

**Architecture:** Extend the existing JSON checkpoint store with conservative crash classification and make workflow execution write a checkpoint before any external side effect. Reuse the current needs_approval state and approval card, restoring it from task hydration without changing the HUD layout.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Electron main process, Vitest, existing React HUD.

**Spec:** \`docs/superpowers/specs/2026-11-17-crash-safe-workflow-recovery-design.md\`

## Global Constraints
- No new runtime dependencies.
- No renderer style, layout, or window-design changes.
- No automatic replay of an interrupted side effect.
- autoApprove never overrides outcomeUncertain.
- A failed write-ahead checkpoint must block the side effect.
- Preserve compatibility with old checkpoints that lack recovery metadata.

## Review Focus
- The crash occurs after action side effect but before completion checkpoint: require explicit retry approval.
- The crash occurs after marking a step running but before calling the adapter: still require approval; this is conservative by design.
- A task is paused between steps: resume without falsely requiring approval for a step that never started.
- A checkpoint is malformed or contains a mismatched task ID: ignore it safely.
- Global auto-approve is enabled: a crash-recovered step must still require explicit human approval.

---

### Task 1: Checkpoint recovery classification

**Files:**
- Modify: \`apps/desktop-hud/src/main/types.ts\`
- Modify: \`apps/desktop-hud/src/main/task-checkpoint.ts\`
- Test: \`tests/unit/desktop/task-checkpoint.test.ts\`

**Interfaces:**
- Add optional \`WorkflowStep.outcomeUncertain?: boolean\`.
- Add \`TaskCheckpointStore.recoverInterrupted(): AgenticTask[]\`; it persists and returns the incomplete tasks after conservative recovery classification.

- [x] **Step 1: Write failing tests** for a running active step becoming \`needs_approval\` with \`outcomeUncertain=true\`, for a pending step becoming \`paused\` without the recovery flag on that step, and for waiting-approval/completed/corrupt checkpoints remaining safe.
- [x] **Step 2: Run** \`npm test -- --reporter=dot tests/unit/desktop/task-checkpoint.test.ts\`; confirm failure is the missing recovery API/behavior.
- [x] **Step 3: Implement** validated recovery classification and persist each changed checkpoint.
- [x] **Step 4: Re-run** the checkpoint tests and confirm all pass.

### Task 2: Workflow write-ahead execution and safe resume

**Files:**
- Modify: \`apps/desktop-hud/src/main/agentic-workflow.ts\`
- Test: \`tests/unit/desktop/agentic-workflow.test.ts\`

**Interfaces:**
- Add a private checkpoint persistence helper that returns success when checkpointing is disabled and failure when a configured store cannot persist.
- startTask must persist the running task before starting its asynchronous execution loop.
- executeLoop must persist the active step as running immediately before calling executeStepAction.
- resumeCheckpoint(taskId) preserves a recovered waiting_approval step and emits task:needs-approval; otherwise it resumes safe pending work by starting the loop.
- approveStep clears the recovery flag only after explicit approval; the next write-ahead checkpoint still guards the side effect.

- [x] **Step 1: Write failing tests** proving the checkpoint exists inside the action callback, a failed checkpoint write prevents the callback, autoApprove cannot bypass a recovered step, and resuming a safe checkpoint actually executes it.
- [x] **Step 2: Run** \`npm test -- --reporter=dot tests/unit/desktop/agentic-workflow.test.ts\`; confirm the expected behaviors fail.
- [x] **Step 3: Implement** write-ahead persistence, recovery-aware approval enforcement, checkpoint persistence on state transitions, and correct resume behavior.
- [x] **Step 4: Re-run** the workflow tests and confirm all pass.

### Task 3: Restore recovery approval in the existing HUD

**Files:**
- Create: \`apps/desktop-hud/src/main/workflow-recovery.ts\`
- Modify: \`apps/desktop-hud/src/renderer/App.tsx\`
- Modify: \`apps/desktop-hud/src/renderer/CompactHUD.tsx\`
- Test: \`tests/unit/desktop/workflow-recovery.test.ts\`

**Interfaces:**
- Export \`getPendingApproval(task: AgenticTask | null): { task: AgenticTask; step: WorkflowStep } | null\`.
- Export \`getApprovalGuidance(step: WorkflowStep): string\`; recovered steps must warn that the action may already have happened and approving retries it.
- App hydration uses getPendingApproval for both the current task on startup and a checkpoint selected from the resume banner.
- CompactHUD uses getApprovalGuidance inside the existing approval card; do not change layout or CSS.

- [x] **Step 1: Write failing helper tests** for normal approvals, recovered approvals, non-approval tasks and the recovery warning.
- [x] **Step 2: Run** \`npm test -- --reporter=dot tests/unit/desktop/workflow-recovery.test.ts\`; confirm failure.
- [x] **Step 3: Implement** the pure helper and wire it into current task hydration and the existing approval card.
- [x] **Step 4: Run** helper tests, TypeScript and ESLint.

### Task 4: Full verification and review

**Files:**
- Review all files changed by Tasks 1–3.

- [x] Run \`npm test -- --reporter=dot\`; report all failures and distinguish the captured baseline of 13 failures from any new regressions.
- [x] Run \`npm run typecheck\`.
- [x] Run \`npm run lint\`.
- [x] Run \`npm run build:desktop\`.
- [x] Run \`git diff --check\` and review the final diff for accidental UI/design or unrelated changes.
- [x] Request a read-only code review of the final diff and fix all Critical/Important findings.

## Completion Evidence

- Focused recovery tests: 38 passed.
- Full suite: 221/221 test suites passed; 769 passed, 0 failed, 4 pending (773 total), using npm test with --maxWorkers=1 and --no-file-parallelism.
- The suite is run with one worker because the ControlServer integration tests allocate from a shared ephemeral loopback port range; a parallel run once produced a non-reproducible fetch failed, while the isolated test and serialized full suite passed.
- npm run typecheck: all five projects passed (shared, local-bridge, chrome-extension, desktop-hud, tests).
- npm run lint: passed.
- npm run build:desktop: passed.
- git diff --check: passed.
- Additional hardening from final review: rejected approval decisions are persisted before the HUD reports success, and a failed rejection write keeps the approval pending.
- UI layout and CSS were not changed.
