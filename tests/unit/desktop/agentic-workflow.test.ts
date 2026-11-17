import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { TaskCheckpointStore } from '../../../apps/desktop-hud/src/main/task-checkpoint.js';
import { AgenticWorkflowEngine } from '../../../apps/desktop-hud/src/main/agentic-workflow.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import { ClipboardService } from '../../../apps/desktop-hud/src/main/clipboard-manager.js';
import { computerOperator } from '../../../apps/desktop-hud/src/main/computer-operator.js';
import { join } from 'node:path';
import { TEMP_DIR } from '../../../apps/desktop-hud/src/main/runtime-paths.js';

describe('AgenticWorkflowEngine', () => {
  let cdpClient: CDPClient;
  let nativeInput: NativeInputService;
  let computerVision: ComputerVisionService;
  let appManager: AppManagerService;
  let clipboardService: ClipboardService;
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
      url: 'https://www.google.com',
      text: 'Sample text excerpt',
      headings: ['Search Results'],
      untrusted: true,
    });

    nativeInput = new NativeInputService({ mockMode: true });
    computerVision = new ComputerVisionService({ mockMode: true });
    appManager = new AppManagerService({ mockMode: true });
    clipboardService = new ClipboardService({ mockMode: true });

    engine = new AgenticWorkflowEngine({
      cdpClient,
      nativeInput,
      computerVision,
      appManager,
      clipboardService,
    });
  });

  it('decomposes goal into structured multi-step actions', () => {
    const notepadSteps = engine.decomposeGoal('Open Notepad and write project summary');
    expect(notepadSteps.length).toBeGreaterThanOrEqual(3);
    expect(notepadSteps[0]?.actionType).toBe('launch_app');
    expect(notepadSteps[1]?.actionType).toBe('switch_window');
    expect(notepadSteps[2]?.actionType).toBe('computer_type');

    const youtubeSteps = engine.decomposeGoal('Search for quantum physics on YouTube');
    expect(youtubeSteps.length).toBeGreaterThanOrEqual(2);
    expect(youtubeSteps[0]?.actionType).toBe('browser_open_tab');
  });

  it('creates an agentic task with order and status', () => {
    const task = engine.createTask('Write notes in Notepad');
    expect(task.id).toBeDefined();
    expect(task.status).toBe('planning');
    expect(task.steps.length).toBeGreaterThan(0);
    expect(task.steps[0]?.status).toBe('pending');
    expect(task.steps[0]?.order).toBe(1);
  });

  it('executes task sequentially to completion when auto-approve is enabled', async () => {
    engine.setAutoApprove(true);
    const stepCompletedListener = vi.fn();
    const taskCompletedListener = vi.fn();

    engine.on('task:step-completed', stepCompletedListener);
    engine.on('task:completed', taskCompletedListener);

    const task = engine.createTask('Write notes in Notepad', [
      {
        description: 'Launch Notepad',
        actionType: 'launch_app',
        params: { appName: 'notepad' },
      },
      {
        description: 'Type notes',
        actionType: 'computer_type',
        params: { text: 'Jarvis test notes' },
      },
    ]);

    await engine.startTask(task.id);

    // Wait for async execution
    await new Promise((r) => setTimeout(r, 100));

    const cur = engine.getCurrentTask();
    expect(cur?.status).toBe('completed');
    expect(cur?.activeStepIndex).toBe(2);
    expect(stepCompletedListener).toHaveBeenCalledTimes(2);
    expect(taskCompletedListener).toHaveBeenCalledTimes(1);
  });

  it('pauses and waits for approval on sensitive operations when autoApprove is false', async () => {
    engine.setAutoApprove(false);
    let approvalPayload: any = null;

    engine.on('task:needs-approval', (data) => {
      approvalPayload = data;
    });

    const task = engine.createTask('Execute shell script', [
      {
        description: 'Run sensitive command',
        actionType: 'run_command',
        params: { command: 'Get-Process' },
        requiresApproval: true,
      },
    ]);

    await engine.startTask(task.id);
    await new Promise((r) => setTimeout(r, 50));

    expect(approvalPayload).toBeDefined();
    expect(approvalPayload.step.description).toBe('Run sensitive command');
    expect(engine.getCurrentTask()?.status).toBe('waiting_approval');

    // Approve step
    const approved = await engine.approveStep(task.id, task.steps[0]?.id || '');
    expect(approved).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    expect(engine.getCurrentTask()?.status).toBe('completed');
  });

  it('requires human approval for dangerous commands even when auto-approve is on', async () => {
    engine.setAutoApprove(true);
    let approvalPayload: any = null;
    engine.on('task:needs-approval', (data) => {
      approvalPayload = data;
    });

    const task = engine.createTask('Destructive cleanup', [
      {
        description: 'Delete a temp file',
        actionType: 'run_command',
        params: { command: 'Remove-Item C:\\temp\\stale.txt' },
      },
    ]);

    expect(task.steps[0]?.riskLevel).toBe('dangerous');
    await engine.startTask(task.id);
    await new Promise((r) => setTimeout(r, 50));

    expect(approvalPayload).toBeDefined();
    expect(engine.getCurrentTask()?.status).toBe('waiting_approval');

    // Re-running the loop without approval must not execute the command.
    const runSpy = vi.spyOn(appManager, 'runSystemCommand');
    await engine.approveStep(task.id, task.steps[0]?.id || '');
    await new Promise((r) => setTimeout(r, 100));
    expect(runSpy).toHaveBeenCalledWith(
      'Remove-Item C:\\temp\\stale.txt',
      expect.objectContaining({ approved: true }),
    );
  });

  it('fails a task without executing a policy-blocked command', async () => {
    engine.setAutoApprove(true);
    const runSpy = vi.spyOn(appManager, 'runSystemCommand');

    const task = engine.createTask('Wipe the disk', [
      {
        description: 'Format drive C',
        actionType: 'run_command',
        params: { command: 'format C: /q' },
      },
    ]);

    expect(task.steps[0]?.riskLevel).toBe('blocked');
    await engine.startTask(task.id);
    await new Promise((r) => setTimeout(r, 50));

    expect(runSpy).not.toHaveBeenCalled();
    const current = engine.getCurrentTask();
    expect(current?.status).toBe('failed');
    expect(current?.error).toContain('Blocked by command policy');
  });

  it('cancels task and marks status', () => {
    const task = engine.createTask('Long running task');
    const cancelled = engine.cancelTask(task.id);
    expect(cancelled).toBe(true);
    expect(engine.getCurrentTask()?.status).toBe('cancelled');
  });

  it('halts task and marks failed when an action step fails', async () => {
    engine.setAutoApprove(true);
    vi.spyOn(appManager, 'launchApplication').mockResolvedValue({
      ok: false,
      appName: 'bad_app',
      error: 'Executable not found in system path',
    });

    const stepFailedListener = vi.fn();
    engine.on('task:step-failed', stepFailedListener);

    const task = engine.createTask('Failing workflow', [
      {
        description: 'Launch non-existent app',
        actionType: 'launch_app',
        params: { appName: 'bad_app' },
      },
      {
        description: 'Subsequent step that still runs',
        actionType: 'computer_type',
        params: { text: 'should still run' },
      },
    ]);

    await engine.startTask(task.id);
    await new Promise((r) => setTimeout(r, 60));

    const cur = engine.getCurrentTask();
    // A failed action no longer abandons the rest of the plan.
    expect(cur?.status).toBe('partial');
    expect(cur?.activeStepIndex).toBe(2);
    expect(cur?.steps[0]?.status).toBe('failed');
    expect(cur?.steps[0]?.error).toContain('Executable not found');
    expect(cur?.steps[1]?.status).toBe('completed');
    expect(cur?.error).toContain('Executable not found');
    expect(stepFailedListener).toHaveBeenCalledTimes(1);
  });

  it('rejects a step and fails the task with user reason', async () => {
    engine.setAutoApprove(false);
    const task = engine.createTask('Approval workflow', [
      {
        description: 'Sensitive action',
        actionType: 'run_command',
        params: { command: 'Stop-Process' },
        requiresApproval: true,
      },
    ]);

    await engine.startTask(task.id);
    await new Promise((r) => setTimeout(r, 50));

    expect(engine.getCurrentTask()?.status).toBe('waiting_approval');

    const rejected = await engine.rejectStep(
      task.id,
      task.steps[0]?.id || '',
      'User denied execution',
    );
    expect(rejected).toBe(true);

    const cur = engine.getCurrentTask();
    expect(cur?.status).toBe('failed');
    expect(cur?.error).toBe('User denied execution');
    expect(cur?.steps[0]?.status).toBe('failed');
  });

  describe('crash-safe workflow checkpoints', () => {
    it('persists a rejected approval so it cannot reappear after restart', async () => {
      const dir = mkdtempSync(join(TEMP_DIR, 'workflow-reject-persist-'));
      try {
        const checkpointedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
        });
        const task = checkpointedEngine.createTask('Reject pending launch', [
          {
            description: 'Launch Notepad',
            actionType: 'launch_app',
            params: { appName: 'notepad' },
            requiresApproval: true,
          },
        ]);

        await checkpointedEngine.startTask(task.id);
        await vi.waitFor(() =>
          expect(checkpointedEngine.getCurrentTask()?.status).toBe('waiting_approval'),
        );

        expect(await checkpointedEngine.rejectStep(task.id, task.steps[0]!.id)).toBe(true);
        expect(new TaskCheckpointStore({ dir }).load(task.id)?.status).toBe('failed');

        const restartedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
        });
        expect(restartedEngine.listCheckpoints()).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('writes the running-step checkpoint before calling the external action', async () => {
      const dir = mkdtempSync(join(TEMP_DIR, 'workflow-write-ahead-'));
      try {
        const store = new TaskCheckpointStore({ dir });
        const checkpointedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
        });
        let savedBeforeAction = false;
        const launch = vi.spyOn(appManager, 'launchApplication').mockImplementation(async () => {
          const saved = store.load(task.id);
          savedBeforeAction = saved?.status === 'running' && saved.steps[0]?.status === 'running';
          return { ok: true, appName: 'notepad' };
        });
        const task = checkpointedEngine.createTask('Launch Notepad safely', [
          { description: 'Launch Notepad', actionType: 'launch_app', params: { appName: 'notepad' } },
        ]);

        await checkpointedEngine.startTask(task.id);
        await vi.waitFor(() => expect(checkpointedEngine.getCurrentTask()?.status).toBe('completed'));

        expect(savedBeforeAction).toBe(true);
        expect(launch).toHaveBeenCalledOnce();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('does not retry an in-flight action when Pause is pressed; waits for explicit approval', async () => {
      const dir = mkdtempSync(join(TEMP_DIR, 'workflow-pause-in-flight-'));
      let beginAction!: () => void;
      let finishAction!: () => void;
      const actionStarted = new Promise<void>((resolve) => { beginAction = resolve; });
      const actionGate = new Promise<void>((resolve) => { finishAction = resolve; });
      try {
        const pausedEngine = new AgenticWorkflowEngine({
          cdpClient, nativeInput, computerVision, appManager, clipboardService, checkpointDir: dir,
        });
        const launch = vi.spyOn(appManager, "launchApplication").mockImplementation(async () => {
          beginAction();
          await actionGate;
          return { ok: true, appName: "notepad" };
        });
        const approval = vi.fn();
        pausedEngine.on("task:needs-approval", approval);
        const task = pausedEngine.createTask("Pause safely during launch", [
          { description: "Launch Notepad", actionType: "launch_app", params: { appName: "notepad" } },
        ]);

        await pausedEngine.startTask(task.id);
        await actionStarted;
        expect(pausedEngine.pauseTask(task.id)).toBe(true);
        expect(pausedEngine.getCurrentTask()?.status).toBe("waiting_approval");
        expect(pausedEngine.getCurrentTask()?.steps[0]?.outcomeUncertain).toBe(true);
        expect(approval).not.toHaveBeenCalled();
        expect(await pausedEngine.approveStep(task.id, task.steps[0]!.id)).toBe(false);

        finishAction();
        await vi.waitFor(() => expect(approval).toHaveBeenCalledOnce());
        expect(launch).toHaveBeenCalledOnce();
        expect(await pausedEngine.approveStep(task.id, task.steps[0]!.id)).toBe(true);
        await vi.waitFor(() => expect(pausedEngine.getCurrentTask()?.status).toBe("completed"));
        expect(launch).toHaveBeenCalledTimes(2);
      } finally {
        finishAction?.();
        rmSync(dir, { recursive: true, force: true });
      }
    });
    it('blocks an external side effect when the configured checkpoint location is not writable', async () => {
      const root = mkdtempSync(join(TEMP_DIR, 'workflow-write-failure-'));
      const checkpointPath = join(root, 'not-a-directory');
      try {
        writeFileSync(checkpointPath, 'occupied', 'utf8');
        const checkpointedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: checkpointPath,
        });
        const launch = vi.spyOn(appManager, 'launchApplication');
        const task = checkpointedEngine.createTask('Launch Notepad safely', [
          { description: 'Launch Notepad', actionType: 'launch_app', params: { appName: 'notepad' } },
        ]);

        await checkpointedEngine.startTask(task.id);

        expect(checkpointedEngine.getCurrentTask()?.status).toBe('failed');
        expect(checkpointedEngine.getCurrentTask()?.error?.toLowerCase()).toContain('checkpoint');
        expect(launch).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('requires explicit approval before retrying a crash-interrupted action even with auto-approve enabled', async () => {
      const dir = mkdtempSync(join(TEMP_DIR, 'workflow-recovery-approval-'));
      try {
        const store = new TaskCheckpointStore({ dir });
        const checkpointedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
          autoApprove: true,
        });
        const task = checkpointedEngine.createTask('Launch Notepad after confirmation', [
          { description: 'Launch Notepad', actionType: 'launch_app', params: { appName: 'notepad' } },
        ]);
        task.status = 'running';
        task.steps[0]!.status = 'running';
        task.activeStepIndex = 0;
        expect(store.save(task)).toBe(true);

        const restoredEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
          autoApprove: true,
        });
        const launch = vi.spyOn(appManager, 'launchApplication').mockResolvedValue({
          ok: true,
          appName: 'notepad',
        });
        const approval = vi.fn();
        restoredEngine.on('task:needs-approval', approval);

        expect(await restoredEngine.resumeCheckpoint(task.id)).toBe(true);
        expect(restoredEngine.getCurrentTask()?.status).toBe('waiting_approval');
        expect(approval).toHaveBeenCalledOnce();
        expect(launch).not.toHaveBeenCalled();

        const stepId = task.steps[0]!.id;
        expect(await restoredEngine.approveStep(task.id, stepId)).toBe(true);
        await vi.waitFor(() => expect(restoredEngine.getCurrentTask()?.status).toBe('completed'));
        expect(launch).toHaveBeenCalledOnce();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('actually resumes an interrupted task when its next step was still pending', async () => {
      const dir = mkdtempSync(join(TEMP_DIR, 'workflow-recovery-pending-'));
      try {
        const store = new TaskCheckpointStore({ dir });
        const checkpointedEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
        });
        const task = checkpointedEngine.createTask('Launch Notepad after restart', [
          { description: 'Launch Notepad', actionType: 'launch_app', params: { appName: 'notepad' } },
        ]);
        task.status = 'running';
        task.steps[0]!.status = 'pending';
        expect(store.save(task)).toBe(true);

        const restoredEngine = new AgenticWorkflowEngine({
          cdpClient,
          nativeInput,
          computerVision,
          appManager,
          clipboardService,
          checkpointDir: dir,
        });
        const launch = vi.spyOn(appManager, 'launchApplication').mockResolvedValue({
          ok: true,
          appName: 'notepad',
        });

        expect(await restoredEngine.resumeCheckpoint(task.id)).toBe(true);
        await vi.waitFor(() => expect(restoredEngine.getCurrentTask()?.status).toBe('completed'));
        expect(launch).toHaveBeenCalledOnce();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
  describe('OS Clipboard Autonomous Workflows', () => {
    it('decomposes copy/paste goal into cross-app clipboard recipe', () => {
      const steps = engine.decomposeGoal('Copy summary data to clipboard and paste into notepad');
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps[0]?.actionType).toBe('clipboard_write');
      expect(steps[1]?.actionType).toBe('launch_app');
      expect(steps[2]?.actionType).toBe('switch_window');
      expect(steps[3]?.actionType).toBe('computer_hotkey');
      expect(steps[3]?.params.keys).toBe('Control+v');
    });

    it('executes clipboard_write and clipboard_read actions during autonomous execution', async () => {
      const writeSpy = vi.spyOn(clipboardService, 'writeText');
      const readSpy = vi.spyOn(clipboardService, 'readText');

      const task = engine.createTask('Clipboard roundtrip task', [
        {
          description: 'Copy research data to clipboard',
          actionType: 'clipboard_write',
          params: { text: 'Verified AI benchmark data 2026' },
        },
        {
          description: 'Inspect clipboard data',
          actionType: 'clipboard_read',
          params: {},
        },
      ]);

      await engine.startTask(task.id);
      await new Promise((r) => setTimeout(r, 60));

      const cur = engine.getCurrentTask();
      expect(cur?.status).toBe('completed');
      expect(writeSpy).toHaveBeenCalledWith('Verified AI benchmark data 2026');
      expect(readSpy).toHaveBeenCalled();
      expect(clipboardService.readText()).toBe('Verified AI benchmark data 2026');
    });
  });

  describe('Phase Four: Skills & Dual-Model Orchestration', () => {
    it('decomposes an Office Word goal into an office:createWordDoc skill step', () => {
      const goal = 'Create a Word document summarising the sprint';
      const steps = engine.decomposeGoal(goal);

      expect(steps).toHaveLength(2);
      expect(steps[0]?.actionType).toBe('execute_skill');
      expect(steps[0]?.params).toMatchObject({
        skillId: 'office',
        action: 'createWordDoc',
      });
      expect(steps[0]?.params.params).toMatchObject({
        filePath: join(TEMP_DIR, 'doc.docx'),
        title: 'Gematron Autonomous Doc',
        content: goal,
      });
      expect(steps[1]?.actionType).toBe('computer_screenshot');
    });

    it('decomposes an Excel spreadsheet goal into an office:createExcelSheet skill step', () => {
      const goal = 'Build an Excel spreadsheet of project tasks';
      const steps = engine.decomposeGoal(goal);

      expect(steps).toHaveLength(1);
      expect(steps[0]?.actionType).toBe('execute_skill');
      expect(steps[0]?.params).toMatchObject({
        skillId: 'office',
        action: 'createExcelSheet',
      });
      expect(steps[0]?.params.params).toMatchObject({
        filePath: join(TEMP_DIR, 'sheet.xlsx'),
        headers: ['ID', 'Task', 'Date'],
      });
      const rows = steps[0]?.params.params?.rows as unknown[][];
      expect(rows[0]?.[0]).toBe(1);
      expect(rows[0]?.[1]).toBe(goal);
    });

    it('decomposes a 3D Blender goal into a blender:renderScene skill step', () => {
      const steps = engine.decomposeGoal('Render the 3D scene in Blender');

      expect(steps).toHaveLength(1);
      expect(steps[0]?.actionType).toBe('execute_skill');
      expect(steps[0]?.params).toMatchObject({
        skillId: 'blender',
        action: 'renderScene',
        params: {
          blendFile: join(TEMP_DIR, 'scene.blend'),
          outputImg: join(TEMP_DIR, 'scene.png'),
        },
      });
    });

    it('decomposes a DeepSeek backend goal into an ai_dispatch step', () => {
      const goal = 'Implement backend API logic with DeepSeek';
      const steps = engine.decomposeGoal(goal);

      expect(steps).toHaveLength(1);
      expect(steps[0]?.actionType).toBe('ai_dispatch');
      expect(steps[0]?.params).toMatchObject({
        modelKey: 'deepseek',
        prompt: goal,
        title: 'DeepSeek Backend Logic Dispatch',
      });
    });

    it('decomposes a GLM frontend goal into an ai_dispatch step', () => {
      const goal = 'Build a frontend UI component with GLM';
      const steps = engine.decomposeGoal(goal);

      expect(steps).toHaveLength(1);
      expect(steps[0]?.actionType).toBe('ai_dispatch');
      expect(steps[0]?.params).toMatchObject({
        modelKey: 'glm',
        prompt: goal,
        title: 'GLM Frontend Architecture Dispatch',
      });
    });

    it('executes an execute_skill step in mock mode', async () => {
      const skillSpy = vi.spyOn(computerOperator, 'executeSkillAction').mockResolvedValue({
        success: true,
        data: { created: true, filePath: join(TEMP_DIR, 'doc.docx') },
      });

      engine.setAutoApprove(true);
      const task = engine.createTask('Skill execution task', [
        {
          description: 'Create a Word document via the Office skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'office',
            action: 'createWordDoc',
            params: {
              filePath: join(TEMP_DIR, 'doc.docx'),
              title: 'Gematron Autonomous Doc',
              content: 'Autonomous skill execution',
            },
          },
        },
      ]);

      await engine.startTask(task.id);
      await new Promise((r) => setTimeout(r, 60));

      const cur = engine.getCurrentTask();
      expect(cur?.status).toBe('completed');
      expect(cur?.steps[0]?.status).toBe('completed');
      expect(skillSpy).toHaveBeenCalledWith(
        'office',
        'createWordDoc',
        expect.objectContaining({ filePath: join(TEMP_DIR, 'doc.docx') }),
      );
    });

    it('executes an ai_dispatch step in mock mode', async () => {
      const skillSpy = vi.spyOn(computerOperator, 'executeSkillAction').mockResolvedValue({
        success: true,
        data: { sessionId: 'ses_mock123', promptQueued: true },
      });

      engine.setAutoApprove(true);
      const task = engine.createTask('AI dispatch task', [
        {
          description: 'Dispatch frontend architecture to GLM',
          actionType: 'ai_dispatch',
          params: {
            modelKey: 'glm',
            prompt: 'Build a frontend UI component with GLM',
            title: 'GLM Frontend Architecture Dispatch',
          },
        },
      ]);

      await engine.startTask(task.id);
      await new Promise((r) => setTimeout(r, 60));

      const cur = engine.getCurrentTask();
      expect(cur?.status).toBe('completed');
      expect(cur?.steps[0]?.status).toBe('completed');
      expect(skillSpy).toHaveBeenCalledWith(
        'opencode',
        'dispatchTask',
        expect.objectContaining({
          modelKey: 'glm',
          prompt: 'Build a frontend UI component with GLM',
          title: 'GLM Frontend Architecture Dispatch',
        }),
      );
    });
  });
});
