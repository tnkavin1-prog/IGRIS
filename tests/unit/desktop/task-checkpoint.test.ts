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
        params: {},
        status: 'completed',
        requiresApproval: false,
      },
    ],
    activeStepIndex: 1,
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

  it('listIncomplete filters out finished tasks', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'checkpoint-'));
    try {
      const store = new TaskCheckpointStore({ dir });
      store.save(makeTask('running', 'running'));
      store.save(makeTask('done', 'completed'));
      store.save(makeTask('cancelled', 'cancelled'));
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
      // Write garbage into the file and re-open.
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
});
