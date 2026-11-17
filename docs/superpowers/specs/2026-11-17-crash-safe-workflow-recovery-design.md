# Crash-Safe Workflow Recovery — Design

## Intent
Make the existing AgenticWorkflowEngine safe to resume after an application or Windows crash. A checkpoint must never make a side-effecting action look unstarted when it may already have happened.

## Goals
- Persist a workflow before execution begins and immediately before each step's side effect.
- On startup, detect a checkpoint whose active step was running and convert it into an explicit approval barrier.
- Explain that the interrupted action may already have taken effect; approval may retry it.
- Resume tasks whose next step was still pending without falsely labeling that step as uncertain.
- Restore the existing approval card after restart, without redesigning the HUD.
- Preserve the rule that auto-approval cannot bypass crash-recovery approval.

## Non-goals
- Unify AgenticWorkflowEngine and AutonomousAgent.
- Change the planner, available tools, or visual design.
- Automatically replay, compensate, or infer the outcome of an interrupted external side effect.
- Add a database, new runtime dependency, or background service.

## Constraints
- Continue using one JSON checkpoint per task in DATA_ROOT/tasks.
- Preserve compatibility with existing checkpoints; new metadata fields are optional.
- Keep all file, command, keyboard, mouse and application side effects behind the existing workflow execution and approval policy.
- A failed checkpoint write must prevent the associated side effect from starting.

## Approaches
1. **Replay the last step automatically:** simplest, but unsafe because file writes, downloads, clicks and commands may already have happened. Rejected.
2. **Write-ahead checkpoint and human-confirmed retry:** persist the running state before the action; on restart mark that step needs_approval with outcomeUncertain; retry only after explicit approval. Pending steps remain resumable. Recommended because it is safe and fits the current approval UI.
3. **Per-action idempotency ledger and reconciliation:** strongest long-term option, but requires every external adapter to expose idempotency/reconciliation semantics. Deferred as a larger architectural project.

## Behavior contract
- startTask writes the running task before scheduling the execution loop.
- Immediately before executeStepAction, save the task with the active step marked running.
- If that save fails, do not call executeStepAction.
- Recovery of a task with an active running step changes that step to needs_approval, sets requiresApproval=true and outcomeUncertain=true, and changes the task to waiting_approval.
- The recovery warning states that the previous action may already have occurred and approval retries it.
- Recovery of a task whose next step is still pending changes the task to paused; the step remains pending and can resume normally.
- resumeCheckpoint must either surface the approval prompt or actually start safe pending work; it must not mark a task running without executing it.
- autoApprove must never override outcomeUncertain.
- The renderer restores a pending approval from a hydrated waiting_approval task using the existing approval card.

## Validation
- Unit tests prove recovery classification for running, pending, waiting-approval, completed, missing and corrupt checkpoints.
- Workflow tests prove the checkpoint exists before the action callback executes and a failed write prevents action execution.
- Workflow tests prove crash-recovered steps cannot be auto-approved and checkpoint resume routes to approval.
- Renderer helper tests prove the correct approval step and warning text are selected.
- Run the full test suite, TypeScript checks, ESLint and desktop build; report the known baseline failures separately.
