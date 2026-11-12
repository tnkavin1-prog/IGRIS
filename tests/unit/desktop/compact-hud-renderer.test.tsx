// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CompactHUD,
  type CompactHUDProps,
} from '../../../apps/desktop-hud/src/renderer/CompactHUD.js';
import type {
  AgenticTask,
  HUDSettings,
  WorkflowStep,
} from '../../../apps/desktop-hud/src/main/types.js';

/**
 * Renderer behaviour of the desktop HUD shell.
 *
 * The approval card is the last gate before a command runs on the user's
 * machine, so the renderer has to show what is about to happen: the risk
 * tier of the step and the command itself.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const settings: HUDSettings = {
  apiKey: '',
  modelId: 'gemini-3.8-live',
  voice: 'Kore',
  autoApprove: false,
  alwaysOnTop: true,
  soundEffectsEnabled: true,
  soundVolume: 0.5,
};

const commandStep: WorkflowStep = {
  id: 'step_1',
  order: 1,
  description: 'Remove the stale export',
  actionType: 'run_command',
  params: { command: 'Remove-Item C:\\temp\\stale.csv' },
  status: 'needs_approval',
  requiresApproval: true,
  riskLevel: 'dangerous',
};

const task: AgenticTask = {
  id: 'task_1',
  goal: 'Clean the exports',
  status: 'waiting_approval',
  steps: [commandStep],
  activeStepIndex: 0,
  startedAt: Date.now(),
};

function makeProps(overrides: Partial<CompactHUDProps> = {}): CompactHUDProps {
  return {
    status: 'idle',
    conversation: [],
    blackboardLesson: null,
    activeTab: null,
    chromeConnected: false,
    settings,
    isPinned: true,
    isMaximized: false,
    currentTask: null,
    pendingApproval: null,
    crosshair: null,
    boundingBox: null,
    telemetry: null,
    onTogglePin: vi.fn(),
    onToggleMaximize: vi.fn(),
    onMinimize: vi.fn(),
    onClose: vi.fn(),
    onStartSession: vi.fn(),
    onStopSession: vi.fn(),
    onSendText: vi.fn(),
    onSelectSampleLesson: vi.fn(),
    onExportSession: vi.fn(),
    onSwitchTab: vi.fn(),
    onLaunchChrome: vi.fn(),
    onApproveStep: vi.fn(),
    onRejectStep: vi.fn(),
    onScanDesktop: vi.fn(),
    onShowWindows: vi.fn(),
    onStartAutonomousTask: vi.fn(),
    onEmergencyStop: vi.fn(),
    onPauseWorkflow: vi.fn(),
    onResumeWorkflow: vi.fn(),
    exportNotice: null,
    appearance: { accentId: 'violet', opacity: 0.78 },
    onAppearanceChange: vi.fn(),
    ...overrides,
  };
}

describe('CompactHUD approval card', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const render = (props: CompactHUDProps) => {
    act(() => {
      root.render(<CompactHUD {...props} />);
    });
  };

  it('shows the risk tier and the command of a step awaiting approval', () => {
    const props = makeProps({
      currentTask: task,
      pendingApproval: { task, step: commandStep },
    });
    render(props);

    const card = container.querySelector('.apv');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Approval needed');
    expect(card?.textContent).toContain('Remove the stale export');
    expect(card?.querySelector('.apr')?.textContent).toBe('dangerous');
    expect(card?.querySelector('.apc')?.textContent).toContain('Remove-Item C:\\temp\\stale.csv');
  });

  it('approves and denies the pending step through the callbacks', () => {
    const props = makeProps({
      currentTask: task,
      pendingApproval: { task, step: commandStep },
    });
    render(props);

    const buttons = Array.from(container.querySelectorAll('.apv button')) as HTMLButtonElement[];
    const approve = buttons.find((button) => button.textContent?.trim() === 'Approve');
    const deny = buttons.find((button) => button.textContent?.trim() === 'Deny');
    expect(approve).toBeDefined();
    expect(deny).toBeDefined();

    act(() => {
      approve?.click();
    });
    expect(props.onApproveStep).toHaveBeenCalledWith('task_1', 'step_1');

    act(() => {
      deny?.click();
    });
    expect(props.onRejectStep).toHaveBeenCalledWith('task_1', 'step_1');
  });

  it('does not show a command block for a step that is not a command', () => {
    const clickStep: WorkflowStep = {
      ...commandStep,
      id: 'step_2',
      actionType: 'launch_app',
      params: { appName: 'notepad' },
      riskLevel: 'safe',
    };
    render(
      makeProps({
        currentTask: { ...task, steps: [clickStep] },
        pendingApproval: { task, step: clickStep },
      }),
    );

    const card = container.querySelector('.apv');
    expect(card?.querySelector('.apc')).toBeNull();
    expect(card?.querySelector('.apr')).toBeNull();
  });

  it('marks risky steps in the workflow list and shows the failure reason', () => {
    const failedStep: WorkflowStep = {
      ...commandStep,
      id: 'step_3',
      status: 'failed',
      error: 'Blocked by command policy: this action can destroy data.',
    };
    render(
      makeProps({
        currentTask: { ...task, steps: [commandStep, failedStep] },
        pendingApproval: { task, step: commandStep },
      }),
    );

    const items = Array.from(container.querySelectorAll('.view.on .wfl li'));
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector('.apr')?.textContent).toBe('dangerous');
    expect(items[1]?.querySelector('.wfe')?.textContent).toContain('Blocked by command policy');
  });
});
