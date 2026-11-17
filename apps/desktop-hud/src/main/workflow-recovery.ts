import type { AgenticTask, WorkflowStep } from './types.js';

export interface PendingWorkflowApproval {
  task: AgenticTask;
  step: WorkflowStep;
}

/** Resolve the approval step from a waiting task, including after process recovery. */
export function getPendingApproval(task: AgenticTask | null): PendingWorkflowApproval | null {
  if (!task || task.status !== 'waiting_approval') return null;

  const active = task.steps[task.activeStepIndex];
  const step = active?.status === 'needs_approval'
    ? active
    : task.steps.find((candidate) => candidate.status === 'needs_approval');

  return step ? { task, step } : null;
}

/** Human-readable guidance for the existing approval card. */
export function getApprovalGuidance(step: WorkflowStep): string {
  if (step.outcomeUncertain) {
    return (
      step.error ??
      'The action may already have happened. Check the target application before approving; approval will retry it.'
    );
  }

  return step.actionType === 'run_command'
    ? 'This command runs on your machine. Review it before you allow it.'
    : 'Confirm to execute this high-impact action.';
}
