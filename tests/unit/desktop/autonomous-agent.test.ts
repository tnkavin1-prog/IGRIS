import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutonomousAgent,
  mapScreenshotPoint,
} from '../../../apps/desktop-hud/src/main/autonomous-agent.js';
import { computerOperator } from '../../../apps/desktop-hud/src/main/computer-operator.js';
import type {
  AgentDecision,
  AgentPlanner,
} from '../../../apps/desktop-hud/src/main/vision-planner.js';
import type { CaptureResult } from '../../../apps/desktop-hud/src/main/types.js';

const shot: CaptureResult = {
  data: 'fixture',
  mimeType: 'image/png',
  width: 1000,
  height: 500,
  timestamp: Date.now(),
  screenBounds: { x: -2000, y: 100, width: 2000, height: 1000 },
};
const action = (params = { x: 120, y: 60 }): AgentDecision => ({
  status: 'action',
  action: 'computer_click',
  params,
  description: 'Click fixture',
  expectedOutcome: 'Fixture changes',
  requiresApproval: false,
});

function fixture() {
  const planner = { next: vi.fn(), verify: vi.fn() };
  const input = {
    mouseClick: vi.fn().mockResolvedValue(true),
    getCursorPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    releaseAllInputStates: vi.fn().mockResolvedValue(true),
  };
  const vision = { captureScreen: vi.fn().mockResolvedValue(shot) };
  const manager = { listRunningWindows: vi.fn().mockResolvedValue([]) };
  const agent = new AutonomousAgent({
    planner: planner as AgentPlanner,
    nativeInput: input as any,
    computerVision: vision as any,
    appManager: manager as any,
  });
  return { agent, planner, input, vision, manager };
}

beforeEach(() => {
  vi.spyOn(computerOperator, 'initialize').mockResolvedValue(undefined);
  vi.spyOn(computerOperator, 'getCapabilities').mockReturnValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('screenshot mapping', () => {
  it('maps scaled images into negative-origin physical desktop pixels', () => {
    expect(mapScreenshotPoint(shot, 120, 60)).toEqual({ x: -1760, y: 220 });
  });
  it.each([
    [1000, 0],
    [-1, 0],
    [NaN, 0],
    [0, Infinity],
  ])('rejects invalid points %s,%s', (x, y) => {
    expect(() => mapScreenshotPoint(shot, x, y)).toThrow('outside');
  });
  it('refuses absent coordinate metadata', () => {
    expect(() => mapScreenshotPoint({ ...shot, screenBounds: undefined }, 1, 1)).toThrow(
      'unavailable',
    );
  });
});

describe('autonomous verification loop', () => {
  it('executes exactly one mapped click and completes only after verification', async () => {
    const { agent, planner, input, vision } = fixture();
    planner.next.mockResolvedValue(action());
    planner.verify.mockResolvedValue({
      succeeded: true,
      goalAchieved: true,
      evidence: 'Fixture changed',
    });
    const completed = vi.fn();
    const session = await agent.startSession('Change fixture', { onGoalComplete: completed });
    expect(session.status).toBe('completed');
    expect(input.mouseClick).toHaveBeenCalledExactlyOnceWith(-1760, 220);
    expect(vision.captureScreen).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledOnce();
  });
  it('reports the foreground window in every observation', async () => {
    const { agent, planner, manager } = fixture();
    manager.listRunningWindows.mockResolvedValue([
      {
        hwnd: 1,
        title: 'Background window',
        processName: 'other',
        pid: 1,
        isVisible: true,
        isIconic: false,
      },
      {
        hwnd: 2,
        title: 'Focused Notepad',
        processName: 'notepad',
        pid: 2,
        isVisible: true,
        isIconic: false,
        isForeground: true,
      },
    ]);
    planner.next.mockResolvedValue(action());
    planner.verify.mockResolvedValue({
      succeeded: true,
      goalAchieved: true,
      evidence: 'Fixture changed',
    });

    const seen: string[] = [];
    await agent.startSession('Change fixture', {
      onObservation: (observation) => seen.push(observation.activeWindow ?? '<none>'),
    });

    // Every observation must carry the foreground title, not just the first.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((title) => title === 'Focused Notepad')).toBe(true);
  });
  it('replans a failed step with a different mutation', async () => {
    const { agent, planner, input } = fixture();
    planner.next.mockResolvedValueOnce(action()).mockResolvedValueOnce(action({ x: 150, y: 70 }));
    planner.verify
      .mockResolvedValueOnce({ succeeded: false, goalAchieved: false, evidence: 'Unchanged' })
      .mockResolvedValueOnce({ succeeded: true, goalAchieved: true, evidence: 'Changed' });
    const session = await agent.startSession('Change fixture');
    expect(session.status).toBe('completed');
    expect(session.steps.map((step) => step.status)).toEqual(['failed', 'completed']);
    expect(input.mouseClick).toHaveBeenCalledTimes(2);
  });
  it('stops repeated unverified mutations even when JSON keys change order', async () => {
    const { agent, planner, input } = fixture();
    planner.next.mockResolvedValueOnce(action()).mockResolvedValueOnce(action({ y: 60, x: 120 }));
    planner.verify.mockResolvedValue({
      succeeded: false,
      goalAchieved: false,
      evidence: 'Unchanged',
    });
    const session = await agent.startSession('Change fixture');
    expect(session.error).toContain('repeated');
    expect(input.mouseClick).toHaveBeenCalledOnce();
  });
  it('does not accept tool failure despite a positive verifier', async () => {
    const { agent, planner, input } = fixture();
    planner.next.mockResolvedValue(action());
    input.mouseClick.mockResolvedValue(false);
    planner.verify.mockResolvedValue({
      succeeded: true,
      goalAchieved: true,
      evidence: 'Claimed success',
    });
    expect((await agent.startSession('Change fixture', { maxIterations: 1 })).status).toBe(
      'failed',
    );
  });
  it('independently rejects unsupported completion claims', async () => {
    const { agent, planner, input } = fixture();
    planner.next.mockResolvedValue({ ...action(), status: 'complete' });
    planner.verify.mockResolvedValue({
      succeeded: true,
      goalAchieved: false,
      evidence: 'Goal absent',
    });
    expect((await agent.startSession('Change fixture')).error).toContain('not verified');
    expect(input.mouseClick).not.toHaveBeenCalled();
  });
  it('never executes decisions requiring approval, even with autoApprove', async () => {
    const { agent, planner, input } = fixture();
    planner.next.mockResolvedValue({ ...action(), requiresApproval: true });
    expect((await agent.startSession('Change fixture', { autoApprove: true })).status).toBe(
      'failed',
    );
    expect(input.mouseClick).not.toHaveBeenCalled();
  });
  it('cancels pending model work and permits a subsequent session after cleanup', async () => {
    const { agent, planner, input } = fixture();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    planner.next.mockImplementationOnce(
      (_session, _obs, _catalog, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          started();
        }),
    );
    const running = agent.startSession('Change fixture');
    await ready;
    await agent.stopSession();
    expect((await running).status).toBe('cancelled');
    expect(input.mouseClick).not.toHaveBeenCalled();
    expect(agent.isSessionRunning()).toBe(false);
    planner.next.mockResolvedValue({ ...action(), status: 'complete' });
    planner.verify.mockResolvedValue({ succeeded: true, goalAchieved: true, evidence: 'Visible' });
    expect((await agent.startSession('Inspect fixture')).status).toBe('completed');
    expect(input.releaseAllInputStates).toHaveBeenCalled();
  });
});
