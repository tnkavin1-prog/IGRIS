import { describe, expect, it } from 'vitest';
import type { AgenticTask, WorkflowStep } from '../../../apps/desktop-hud/src/main/types.js';
import { getApprovalGuidance, getPendingApproval } from '../../../apps/desktop-hud/src/main/workflow-recovery.js';

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step_1',
    order: 1,
    description: 'Launch Notepad',
    actionType: 'launch_app',
    params: { appName: 'notepad' },
    status: 'needs_approval',
    requiresApproval: true,
    ...overrides,
  };
}

function task(stepList: WorkflowStep[], status: AgenticTask['status'] = 'waiting_approval'): AgenticTask {
  return {
    id: 'task_1',
    goal: 'Open Notepad',
    status,
    steps: stepList,
    activeStepIndex: 0,
    startedAt: 1,
  };
}

describe('workflow recovery approval helpers', () => {
  it('returns the active approval step from a waiting task', () => {
    const active = step({ id: 'active' });
    const result = getPendingApproval(task([active]));

    expect(result?.task.id).toBe('task_1');
    expect(result?.step.id).toBe('active');
  });

  it('finds the needs-approval step when the active index has moved', () => {
    const result = getPendingApproval(
      task(
        [
          step({ id: 'done', status: 'completed', requiresApproval: false }),
          step({ id: 'approval' }),
        ],
        'waiting_approval',
      ),
    );

    expect(result?.step.id).toBe('approval');
  });

  it('returns null when no approval is pending', () => {
    expect(getPendingApproval(null)).toBeNull();
    expect(getPendingApproval(task([step({ status: 'pending' })], 'paused'))).toBeNull();
    expect(getPendingApproval(task([step({ status: 'completed' })], 'completed'))).toBeNull();
  });

  it('explains why a normal shell command requires approval', () => {
    expect(getApprovalGuidance(step({ actionType: 'run_command' }))).toContain(
      'Review it before you allow it',
    );
  });

  it('warns that a recovered action may already have happened and approval retries it', () => {
    const guidance = getApprovalGuidance(step({ outcomeUncertain: true }));

    expect(guidance).toContain('may already have happened');
    expect(guidance).toContain('Check the target application');
    expect(guidance).toContain('retry');
  });
});
