import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskCheckpointStore } from '../../../apps/desktop-hud/src/main/task-checkpoint.js';
import type { AgenticTask } from '../../../apps/desktop-hud/src/main/types.js';

function makeTask(id: string, status: AgenticTask['status'] = 'running'): AgenticTask {
  return {
    id,
    goal: `goal for ${id}`,
    status,
    steps: [
      {
        id: 's1',
        order: 1,
        description: 'step',
        actionType: 'launch_app',
        params: { appName: 'notepad' },
        status: 'completed',
        requiresApproval: false,
      },
    ],
    activeStepIndex: 0,
    startedAt: Date.now(),
  };
}

describe('TaskCheckpointStore', () => {
  it('saves, lists and loads a checkpoint', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('task_1');
      expect(store.save(task)).toBe(true);
      expect(store.load('task_1')?.id).toBe('task_1');
      expect(store.list().map((t) => t.id)).toEqual(['task_1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps unusual task IDs inside the checkpoint directory and lists them correctly', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-path-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('folder/task:one');
      const path = store.pathFor(task.id);
      expect(path).toBe(join(dir, 'folder_task_one.json'));
      expect(store.save(task)).toBe(true);
      expect(store.load(task.id)?.id).toBe('folder/task:one');
      expect(store.list().map((item) => item.id)).toEqual(['folder/task:one']);
      expect(store.pathFor('../escape')).toBe(join(dir, '.._escape.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('listIncomplete filters out finished tasks', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      store.save(makeTask('running', 'running'));
      store.save(makeTask('done', 'completed'));
      store.save(makeTask('cancelled', 'cancelled'));
      store.save(makeTask('failed', 'failed'));
      const ids = store.listIncomplete().map((t) => t.id);
      expect(ids).toEqual(['running']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('remove deletes the checkpoint file', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      store.save(makeTask('task_1'));
      store.remove('task_1');
      expect(store.load('task_1')).toBeNull();
      expect(store.list()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing or corrupt checkpoint', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      expect(store.load('does-not-exist')).toBeNull();
      writeFileSync(store.pathFor('broken'), 'not json', 'utf8');
      expect(store.load('broken')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives a round trip through disk', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('task_1');
      store.save(task);
      const reloaded = new TaskCheckpointStore({ dir }).load('task_1');
      expect(reloaded?.goal).toBe(task.goal);
      expect(reloaded?.steps).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires explicit approval when a checkpoint shows an action was running at crash time', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-recovery-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('interrupted_action', 'running');
      task.steps[0]!.status = 'running';
      task.steps[0]!.startedAt = Date.now();
      store.save(task);

      const restartedStore = new TaskCheckpointStore({ dir });
      const recovered = restartedStore.recoverInterrupted();
      const restored = restartedStore.load('interrupted_action');

      expect(recovered).toHaveLength(1);
      expect(restored?.status).toBe('waiting_approval');
      expect(restored?.steps[0]?.status).toBe('needs_approval');
      expect(restored?.steps[0]?.requiresApproval).toBe(true);
      expect(restored?.steps[0]?.outcomeUncertain).toBe(true);
      expect(restored?.steps[0]?.error).toContain('may already have happened');
      expect(restored?.activeStepIndex).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pauses a task whose next step was still pending without requiring a retry approval', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-recovery-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('pending_action', 'running');
      task.steps[0]!.status = 'pending';
      store.save(task);

      const restartedStore = new TaskCheckpointStore({ dir });
      const recovered = restartedStore.recoverInterrupted();
      const restored = restartedStore.load('pending_action');

      expect(recovered).toHaveLength(1);
      expect(restored?.status).toBe('paused');
      expect(restored?.steps[0]?.status).toBe('pending');
      expect(restored?.steps[0]?.outcomeUncertain).toBeUndefined();
      expect(restored?.activeStepIndex).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not turn an already-approved wait state into an interrupted action', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-recovery-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      const task = makeTask('waiting_approval', 'waiting_approval');
      task.steps[0]!.status = 'needs_approval';
      task.steps[0]!.requiresApproval = true;
      store.save(task);

      const restored = new TaskCheckpointStore({ dir }).recoverInterrupted()[0];

      expect(restored?.status).toBe('waiting_approval');
      expect(restored?.steps[0]?.status).toBe('needs_approval');
      expect(restored?.steps[0]?.outcomeUncertain).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
