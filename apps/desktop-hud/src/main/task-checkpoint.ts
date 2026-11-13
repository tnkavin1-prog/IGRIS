/**
 * Task checkpoint store.
 *
 * A task is only resumable if its state survives a process restart. The
 * workflow engine keeps its current task in memory, so a crash loses it.
 * This store writes the task to disk after every step transition and reads
 * it back when the engine starts.
 *
 * The store is deliberately simple: one JSON file per task, written
 * atomically, plus a directory listing. It is not a database and it does
 * not try to be one.
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
import { join } from 'node:path';
import type { AgenticTask } from './types.js';

export interface CheckpointStoreOptions {
  /** Directory that holds the checkpoint files. */
  dir: string;
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
    const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  /** Persist the task. Returns true on success. */
  public save(task: AgenticTask): boolean {
    try {
      const serialized = JSON.stringify(task, null, 2);
      const tmp = `${this.pathFor(task.id)}.tmp.${Date.now()}`;
      writeFileSync(tmp, serialized, 'utf8');
      try {
        // Atomic-ish rename on the same filesystem.
        renameSync(tmp, this.pathFor(task.id));
      } catch {
        writeFileSync(this.pathFor(task.id), serialized, 'utf8');
        try {
          unlinkSync(tmp);
        } catch {
          /* temp already cleaned up */
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Load one task, or null if it is missing or corrupt. */
  public load(taskId: string): AgenticTask | null {
    const path = this.pathFor(taskId);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as AgenticTask;
    } catch {
      return null;
    }
  }

  /** List every checkpoint, newest first. */
  public list(): AgenticTask[] {
    if (!existsSync(this.dir)) return [];
    const out: AgenticTask[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue;
      const task = this.load(entry.replace(/\.json$/, ''));
      if (task) out.push(task);
    }
    return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  /** List only the tasks that are not finished. */
  public listIncomplete(): AgenticTask[] {
    return this.list().filter(
      (task) =>
        task.status !== 'completed' && task.status !== 'partial' && task.status !== 'cancelled',
    );
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
