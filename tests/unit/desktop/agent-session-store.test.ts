import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSessionStore } from '../../../apps/desktop-hud/src/main/agent-session-store.js';
import type { AgentSession } from '../../../apps/desktop-hud/src/main/autonomous-agent.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'temp', 'agent-session-'));
  dirs.push(dir);
  return dir;
}
function session(id: string, status: AgentSession['status'] = 'running'): AgentSession {
  return {
    id,
    goal: 'Make a desktop change',
    status,
    steps: [
      {
        id: 'step-1',
        description: 'Already verified',
        action: 'openApp',
        params: { name: 'notepad' },
        status: 'completed',
        attempts: 1,
        maxAttempts: 1,
      },
      {
        id: 'step-2',
        description: 'Possibly happened before crash',
        action: 'computer_type',
        params: { text: 'hello' },
        status: 'running',
        attempts: 1,
        maxAttempts: 1,
      },
    ],
    currentStepIndex: 1,
    startedAt: 100,
    iterations: 2,
    maxIterations: 50,
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('AgentSessionStore', () => {
  it('round-trips an agent session checkpoint', () => {
    const store = new AgentSessionStore({ dir: tempDir() });
    const value = session('agent-1');
    expect(store.save(value)).toBe(true);
    expect(store.load('agent-1')).toMatchObject({
      id: 'agent-1',
      goal: value.goal,
      currentStepIndex: 1,
    });
  });

  it('marks unfinished sessions interrupted and never leaves a running mutation resumable', () => {
    const store = new AgentSessionStore({ dir: tempDir() });
    store.save(session('agent-1'));
    const recovered = store.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: 'agent-1',
      status: 'failed',
      recoveredFromCrash: true,
      steps: [
        { id: 'step-1', status: 'completed' },
        { id: 'step-2', status: 'failed' },
      ],
    });
    expect(recovered[0]?.steps[1]?.error).toContain('may have occurred');
    expect(store.listIncomplete()).toHaveLength(0);
  });

  it('keeps completed sessions out of crash recovery', () => {
    const store = new AgentSessionStore({ dir: tempDir() });
    store.save(session('done', 'completed'));
    expect(store.recoverInterrupted()).toEqual([]);
    expect(store.load('done')?.status).toBe('completed');
  });

  it('rejects corrupt and missing sessions without throwing', () => {
    const dir = tempDir();
    const store = new AgentSessionStore({ dir });
    expect(store.load('missing')).toBeNull();
    writeFileSync(join(dir, 'broken.json'), '{not-json');
    expect(store.load('broken')).toBeNull();
    expect(store.save(session('../escape'))).toBe(true);
    expect(store.pathFor('../escape')).toContain('.._escape.json');
    expect(existsSync(store.pathFor('../escape'))).toBe(true);
  });
});
