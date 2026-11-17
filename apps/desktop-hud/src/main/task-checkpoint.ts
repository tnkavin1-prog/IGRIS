/**
 * Task checkpoint store.
 *
 * A task is only resumable if its state survives a process restart. The
 * workflow engine keeps its current task in memory, so a crash loses it. This
 * store writes one JSON file per task and conservatively marks an in-flight
 * step as requiring human approval when the process restarts.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgenticTask, StepStatus, TaskStatus } from './types.js';

export interface CheckpointStoreOptions {
  /** Directory that holds the checkpoint files. */
  dir: string;
}

const TASK_STATUSES = new Set<TaskStatus>([
  'planning',
  'running',
  'paused',
  'waiting_approval',
  'completed',
  'partial',
  'failed',
  'cancelled',
]);
const STEP_STATUSES = new Set<StepStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'needs_approval',
]);

const INTERRUPTED_ACTION_WARNING =
  'IGRIS restarted while this action was in progress. It may already have happened. ' +
  'Check the target application before approving; approval will retry this action.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCheckpointStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.description === 'string' &&
    typeof value.actionType === 'string' &&
    isRecord(value.params) &&
    STEP_STATUSES.has(value.status as StepStatus) &&
    typeof value.requiresApproval === 'boolean'
  );
}

function isAgenticTaskCheckpoint(value: unknown, expectedId: string): value is AgenticTask {
  if (!isRecord(value)) return false;
  return (
    value.id === expectedId &&
    typeof value.goal === 'string' &&
    TASK_STATUSES.has(value.status as TaskStatus) &&
    Array.isArray(value.steps) &&
    value.steps.every(isCheckpointStep) &&
    Number.isInteger(value.activeStepIndex) &&
    (value.activeStepIndex as number) >= 0 &&
    (value.activeStepIndex as number) <= value.steps.length &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt)
  );
}

export class TaskCheckpointStore {
  private readonly dir: string;

  constructor(options: CheckpointStoreOptions) {
    this.dir = options.dir;
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* read-only media: the store degrades to in-memory only */
    }
  }

  /** Where the checkpoint for a task lives. */
  public pathFor(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'task';
    return join(this.dir, `${safe}.json`);
  }

  /** Persist the task. Returns true on success. */
  public save(task: AgenticTask): boolean {
    const destination = this.pathFor(task.id);
    const temporary = destination + ".tmp." + process.pid + "." + randomUUID();
    try {
      const serialized = JSON.stringify(task, null, 2);
      writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
      try {
        // Same-filesystem rename is the preferred atomic replacement path.
        renameSync(temporary, destination);
      } catch {
        // On Windows, replace an existing file through a unique backup.
        const backup = destination + ".bak." + process.pid + "." + randomUUID();
        try {
          if (existsSync(destination)) renameSync(destination, backup);
          renameSync(temporary, destination);
          if (existsSync(backup)) {
            try { unlinkSync(backup); } catch { /* stale backup is harmless */ }
          }
        } catch (error) {
          if (!existsSync(destination) && existsSync(backup)) {
            try { renameSync(backup, destination); } catch { /* keep backup for recovery */ }
          }
          throw error;
        }
      }
      return true;
    } catch {
      try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best effort */ }
      return false;
    }
  }
  /** Load one validated task, or null if it is missing, corrupt or mismatched. */
  public load(taskId: string): AgenticTask | null {
    const path = this.pathFor(taskId);
    if (!existsSync(path)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return isAgenticTaskCheckpoint(parsed, taskId) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** List every valid checkpoint, newest first. */
  public list(): AgenticTask[] {
    if (!existsSync(this.dir)) return [];
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      // Keep the store attached so required writes fail closed for an unreadable path.
      return [];
    }
    const out: AgenticTask[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(this.dir, entry), 'utf8'));
        if (!isRecord(parsed) || typeof parsed.id !== 'string') continue;
        if (this.pathFor(parsed.id) !== join(this.dir, entry)) continue;
        if (isAgenticTaskCheckpoint(parsed, parsed.id)) out.push(parsed);
      } catch {
        // Ignore corrupt or partially written checkpoints.
      }
    }
    return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }
  /** List only the tasks that are not finished. */
  public listIncomplete(): AgenticTask[] {
    return this.list().filter((task) =>
      task.status === 'planning' ||
      task.status === 'running' ||
      task.status === 'paused' ||
      task.status === 'waiting_approval',
    );
  }

  /**
   * Reconcile checkpoints left by a previous process.
   *
   * A step saved as "running" may have performed an external side effect
   * before the process died. Never replay it implicitly: place it behind the
   * existing explicit-approval barrier. A pending step has not started and
   * can be resumed safely after the user chooses Resume.
   */
  public recoverInterrupted(): AgenticTask[] {
    const incomplete = this.listIncomplete();
    for (const task of incomplete) {
      const runningIndexes = task.steps.reduce<number[]>((indexes, step, index) => {
        if (step.status === 'running') indexes.push(index);
        return indexes;
      }, []);
      if (runningIndexes.length > 0) {
        // The active index is normally the in-flight step. Recover from the
        // persisted step status as the source of truth if an older checkpoint
        // or a partial write left the index behind.
        task.activeStepIndex = runningIndexes[0]!;
        for (const index of runningIndexes) {
          const step = task.steps[index]!;
          step.status = 'needs_approval';
          step.requiresApproval = true;
          step.outcomeUncertain = true;
          step.error = INTERRUPTED_ACTION_WARNING;
        }
        task.status = 'waiting_approval';
        task.error = 'The workflow stopped while an action was in progress; its outcome is uncertain.';
        this.save(task);
      } else if (task.status === 'running' || task.status === 'planning') {
        task.status = 'paused';
        task.error = task.error ?? 'IGRIS restarted before the next action began. Resume to continue safely.';
        this.save(task);
      }
    }
    return incomplete;
  }

  /** Remove the checkpoint for a finished task. */
  public remove(taskId: string): void {
    const path = this.pathFor(taskId);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best effort */
    }
  }
}
