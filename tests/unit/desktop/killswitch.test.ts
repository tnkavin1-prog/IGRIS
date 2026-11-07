import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgenticWorkflowEngine } from '../../../apps/desktop-hud/src/main/agentic-workflow.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('Emergency Autonomous Killswitch & Pause/Resume', () => {
  let cdpClient: CDPClient;
  let nativeInput: NativeInputService;
  let computerVision: ComputerVisionService;
  let appManager: AppManagerService;
  let engine: AgenticWorkflowEngine;

  beforeEach(() => {
    cdpClient = new CDPClient(9222, '127.0.0.1');
    vi.spyOn(cdpClient, 'createTab').mockResolvedValue({
      id: 'tab_test_1',
      title: 'Google',
      url: 'https://www.google.com',
      type: 'page',
      webSocketDebuggerUrl: '',
    });
    vi.spyOn(cdpClient, 'navigate').mockResolvedValue({ ok: true, url: 'https://www.google.com' });
    vi.spyOn(cdpClient, 'readPage').mockResolvedValue({
      title: 'Google Search',
      headings: ['Search Results'],
      textExcerpt: 'Sample text excerpt',
    });

    nativeInput = new NativeInputService({ mockMode: true });
    computerVision = new ComputerVisionService({ mockMode: true });
    appManager = new AppManagerService({ mockMode: true });

    engine = new AgenticWorkflowEngine({
      cdpClient,
      nativeInput,
      computerVision,
      appManager,
      autoApprove: false, // manual control for predictable step inspection
    });
  });

  it('emergencyStop halts running task, fails active steps, and safely releases input states', async () => {
    const releaseSpy = vi.spyOn(nativeInput, 'releaseAllInputStates');
    const emergencyListener = vi.fn();
    const cancelListener = vi.fn();

    engine.on('task:emergency-stop', emergencyListener);
    engine.on('task:cancelled', cancelListener);

    // Create task with multiple steps
    const task = engine.createTask('Open Notepad and type executive notes');
    expect(task.steps.length).toBeGreaterThanOrEqual(3);

    // Start task
    await engine.startTask(task.id);
    expect(engine.getCurrentTask()?.status).toBe('running');

    // Trigger emergency killswitch
    const result = await engine.emergencyStop('Operator initiated emergency killswitch');

    expect(result.stopped).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task?.status).toBe('cancelled');
    expect(result.task?.error).toBe('Operator initiated emergency killswitch');

    // Verify incomplete steps failed/cancelled
    const incomplete = result.task!.steps.filter((s) => s.status !== 'completed');
    expect(incomplete.length).toBeGreaterThan(0);
    for (const step of incomplete) {
      expect(step.status).toBe('failed');
    }

    // Verify input states were safely released
    expect(releaseSpy).toHaveBeenCalled();
    expect(emergencyListener).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Operator initiated emergency killswitch',
      }),
    );
    expect(cancelListener).toHaveBeenCalled();
  });

  it('emergencyStop handles idle state gracefully when no task is running', async () => {
    const releaseSpy = vi.spyOn(nativeInput, 'releaseAllInputStates');
    const result = await engine.emergencyStop('Idle trigger');

    expect(result.stopped).toBe(false);
    expect(result.task).toBeNull();
    // Safety guarantee: hardware inputs are still released even in idle state
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes active autonomous task', async () => {
    const task = engine.createTask('Open Notepad and type notes');
    await engine.startTask(task.id);

    // Task is running
    expect(engine.getCurrentTask()?.status).toBe('running');

    // Pause task
    const paused = engine.pauseCurrentTask();
    expect(paused).toBe(true);
    expect(engine.getCurrentTask()?.status).toBe('paused');

    // Trying to pause an already paused task returns false
    const pauseAgain = engine.pauseCurrentTask();
    expect(pauseAgain).toBe(false);

    // Resume task
    const resumed = await engine.resumeCurrentTask();
    expect(resumed).toBe(true);
    expect(engine.getCurrentTask()?.status).toBe('running');

    // Clean up
    await engine.emergencyStop('Test cleanup');
  });

  it('nativeInput releaseAllInputStates records event and calls CLI or Win32', async () => {
    const actionListener = vi.fn();
    nativeInput.on('action', actionListener);

    const released = await nativeInput.releaseAllInputStates();
    expect(released).toBe(true);

    const last = nativeInput.getLastAction();
    expect(last?.type).toBe('release-all');
    expect(actionListener).toHaveBeenCalledTimes(1);
  });

  it('emergencyStop invokes abortActiveCommands on AppManagerService', async () => {
    const abortSpy = vi.spyOn(appManager, 'abortActiveCommands');
    await engine.emergencyStop('Testing command abort');
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('prevents in-flight asynchronous action from overwriting failed status after emergencyStop', async () => {
    let finishAsyncAction: (val: any) => void = () => {};
    const slowPromise = new Promise((resolve) => {
      finishAsyncAction = resolve;
    });

    // Mock an in-flight slow app manager launch
    vi.spyOn(appManager, 'launchApplication').mockImplementation(async () => {
      return (await slowPromise) as any;
    });

    const stepCompletedSpy = vi.fn();
    engine.on('task:step-completed', stepCompletedSpy);

    const task = engine.createTask('Launch slow app', [
      {
        description: 'Launch delayed app',
        actionType: 'launch_app',
        params: { appName: 'notepad' },
      },
    ]);

    await engine.startTask(task.id);
    expect(task.steps[0]?.status).toBe('running');

    // Trigger emergency killswitch while action is still running
    await engine.emergencyStop('Emergency abort while action running');
    expect(task.status).toBe('cancelled');
    expect(task.steps[0]?.status).toBe('failed');

    // Now resolve the in-flight action
    finishAsyncAction({ ok: true, appName: 'notepad', pid: 1234 });
    await new Promise((r) => setTimeout(r, 20));

    // Ensure step status remained failed and was NOT overwritten to completed
    expect(task.steps[0]?.status).toBe('failed');
    expect(stepCompletedSpy).not.toHaveBeenCalled();
    expect(task.activeStepIndex).toBe(0);
  });
});
