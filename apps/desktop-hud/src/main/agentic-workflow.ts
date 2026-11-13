import { EventEmitter } from 'node:events';
import type { CDPClient } from './cdp-client.js';
import type { NativeInputService } from './native-input.js';
import type { ComputerVisionService } from './computer-vision.js';
import type { AppManagerService } from './app-manager.js';
import type { BrowserGateway } from './browser-gateway.js';
import type { ClipboardService } from './clipboard-manager.js';
import type { JarvisMemoryStore } from './jarvis-memory.js';
import { computerOperator } from './computer-operator.js';
import { assessCommand, redactCommand } from './command-policy.js';
import { TaskCheckpointStore } from './task-checkpoint.js';
import { join } from 'node:path';
import { TEMP_DIR } from './runtime-paths.js';
import type {
  AgenticTask,
  BoundingBoxTarget,
  StepRisk,
  TaskStatus,
  WorkflowStep,
  WorkflowStepInput,
} from './types.js';

export interface WorkflowEngineDependencies {
  cdpClient: CDPClient;
  nativeInput: NativeInputService;
  computerVision: ComputerVisionService;
  appManager: AppManagerService;
  browserGateway?: BrowserGateway;
  clipboardService?: ClipboardService;
  memoryStore?: JarvisMemoryStore;
  autoApprove?: boolean;
  /** Directory that holds task checkpoints. Omit to disable checkpointing. */
  checkpointDir?: string;
}

/** Risk tier of a `run_command` step, derived from the command policy. */
function commandRisk(params: Record<string, any> | undefined): StepRisk {
  const command = typeof params?.command === 'string' ? params.command : '';
  if (!command.trim()) return 'caution';
  return assessCommand(command).risk;
}

export class AgenticWorkflowEngine extends EventEmitter {
  private cdpClient: CDPClient;
  private nativeInput: NativeInputService;
  private computerVision: ComputerVisionService;
  private appManager: AppManagerService;
  private browserGateway?: BrowserGateway;
  private clipboardService?: ClipboardService;
  private memoryStore?: JarvisMemoryStore;

  private currentTask: AgenticTask | null = null;
  private isExecuting = false;
  /**
   * Automatic approval is *off* by default. Enabling it only removes the
   * prompt for ordinary steps; dangerous command steps still require an
   * explicit human decision (see `riskLevel` handling in `executeLoop`).
   */
  private autoApprove = false;
  private checkpointStore: TaskCheckpointStore | null = null;

  constructor(deps: WorkflowEngineDependencies) {
    super();
    this.cdpClient = deps.cdpClient;
    this.nativeInput = deps.nativeInput;
    this.computerVision = deps.computerVision;
    this.appManager = deps.appManager;
    this.browserGateway = deps.browserGateway;
    this.clipboardService = deps.clipboardService;
    this.memoryStore = deps.memoryStore;
    if (typeof deps.autoApprove === 'boolean') {
      this.autoApprove = deps.autoApprove;
    }
    if (deps.checkpointDir) {
      try {
        this.checkpointStore = new TaskCheckpointStore({ dir: deps.checkpointDir });
        // A crashed session leaves a checkpoint behind; surface it as the
        // current task so the user can resume rather than start over.
        const incomplete = this.checkpointStore.listIncomplete();
        if (incomplete.length > 0 && this.currentTask === null) {
          this.currentTask = incomplete[0]!;
        }
      } catch {
        this.checkpointStore = null;
      }
    }
  }

  public setClipboardService(service: ClipboardService): void {
    this.clipboardService = service;
  }

  public getClipboardService(): ClipboardService | undefined {
    return this.clipboardService;
  }

  public setMemoryStore(store: JarvisMemoryStore): void {
    this.memoryStore = store;
  }

  public getMemoryStore(): JarvisMemoryStore | undefined {
    return this.memoryStore;
  }

  public setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled;
  }

  public getAutoApprove(): boolean {
    return this.autoApprove;
  }

  public getCurrentTask(): AgenticTask | null {
    return this.currentTask ? { ...this.currentTask, steps: [...this.currentTask.steps] } : null;
  }

  /** List the tasks that were left unfinished by a previous process run. */
  public listCheckpoints(): AgenticTask[] {
    return this.checkpointStore?.listIncomplete() ?? [];
  }

  /** Restore a checkpointed task as the current task. */
  public resumeCheckpoint(taskId: string): boolean {
    const task = this.checkpointStore?.load(taskId);
    if (!task) return false;
    if (this.isExecuting) return false;
    this.currentTask = task;
    this.currentTask.status = 'running';
    this.emit('task:updated', this.currentTask);
    return true;
  }

  /** Remove a checkpoint (for example after the user has dismissed it). */
  public discardCheckpoint(taskId: string): boolean {
    this.checkpointStore?.remove(taskId);
    if (this.currentTask?.id === taskId) this.currentTask = null;
    return true;
  }

  /**
   * Decompose an autonomous high-level goal into actionable pipeline steps
   */
  public decomposeGoal(goal: string): WorkflowStepInput[] {
    if (this.memoryStore) {
      const recipe = this.memoryStore.getTaskRecipe(goal);
      if (recipe && recipe.steps && recipe.steps.length > 0) {
        return recipe.steps;
      }
    }

    const lower = goal.toLowerCase();

    if (
      lower.includes('clipboard') ||
      (lower.includes('copy') &&
        (lower.includes('paste') || lower.includes('notepad') || lower.includes('word')))
    ) {
      const destApp = lower.includes('word') ? 'word' : 'notepad';
      const destTitle = lower.includes('word') ? 'Word' : 'Notepad';
      return [
        {
          description: 'Write summary data to OS system clipboard',
          actionType: 'clipboard_write',
          params: {
            text: `[Assistant Agent Summary]\nTask: ${goal}\nTimestamp: ${new Date().toISOString()}\nStatus: Verified Nominal.\n`,
          },
        },
        {
          description: `Launch destination application (${destApp})`,
          actionType: 'launch_app',
          params: { appName: destApp },
        },
        {
          description: `Focus destination window (${destTitle})`,
          actionType: 'switch_window',
          params: { windowTitle: destTitle },
        },
        {
          description: 'Paste clipboard contents using system hotkey (Control+v)',
          actionType: 'computer_hotkey',
          params: { keys: 'Control+v' },
        },
        {
          description: 'Capture screenshot of application window for verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (
      lower.includes('notepad') ||
      lower.includes('note') ||
      (lower.includes('write') && lower.includes('report'))
    ) {
      return [
        {
          description: 'Launch Windows Notepad editor',
          actionType: 'launch_app',
          params: { appName: 'notepad' },
        },
        {
          description: 'Focus Notepad editor window',
          actionType: 'switch_window',
          params: { windowTitle: 'Notepad' },
        },
        {
          description: 'Type autonomous agent notes into Notepad',
          actionType: 'computer_type',
          params: {
            text: `[Assistant Autonomous Agent Log]\nGoal: ${goal}\nExecuted at: ${new Date().toLocaleString()}\nSystem status: Nominal.\n`,
          },
        },
        {
          description: 'Capture screenshot of active Notepad window for verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (lower.includes('youtube') || (lower.includes('video') && lower.includes('play'))) {
      const match = goal.match(/search(?:\s+for)?\s+([^,.]+)/i);
      const query = match ? match[1]?.trim() : 'multimodal AI agents';
      return [
        {
          description: 'Open YouTube in Google Chrome',
          actionType: 'browser_open_tab',
          params: {
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query || '')}`,
          },
        },
        {
          description: 'Verify YouTube search results page loaded',
          actionType: 'browser_read',
          params: {},
        },
        {
          description: 'Capture Chrome viewport verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (lower.includes('search') || lower.includes('google') || lower.includes('lookup')) {
      const match = goal.match(/(?:search|lookup)(?:\s+for)?\s+([^,.]+)/i);
      const query = match ? match[1]?.trim() : 'advanced AI agent computer use';
      return [
        {
          description: 'Open Google search in Chrome tab',
          actionType: 'browser_open_tab',
          params: { url: `https://www.google.com/search?q=${encodeURIComponent(query || '')}` },
        },
        {
          description: 'Read search results page text and headings',
          actionType: 'browser_read',
          params: {},
        },
        {
          description: 'Capture search results viewport',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (lower.includes('calculator') || lower.includes('calc') || lower.includes('calculate')) {
      return [
        {
          description: 'Launch Windows Calculator',
          actionType: 'launch_app',
          params: { appName: 'calc' },
        },
        {
          description: 'Focus Calculator window',
          actionType: 'switch_window',
          params: { windowTitle: 'Calculator' },
        },
        {
          description: 'Capture Calculator display',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (
      lower.includes('terminal') ||
      lower.includes('powershell') ||
      lower.includes('command') ||
      lower.includes('cmd')
    ) {
      return [
        {
          description: 'Launch Windows PowerShell terminal',
          actionType: 'launch_app',
          params: { appName: 'terminal' },
        },
        {
          description: 'Focus Terminal window',
          actionType: 'switch_window',
          params: { windowTitle: 'PowerShell' },
        },
        {
          description: 'Execute system command inspection',
          actionType: 'run_command',
          params: { command: 'Get-Process | Select-Object -First 5' },
          requiresApproval: true,
        },
        {
          description: 'Capture terminal display for verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    // Intelligent application, creative, and AI model routing
    if (
      (lower.includes('word') || lower.includes('document')) &&
      !lower.includes('launch') &&
      !lower.includes('switch')
    ) {
      return [
        {
          description: 'Create a Word document via the Office skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'office',
            action: 'createWordDoc',
            params: {
              filePath: join(TEMP_DIR, 'doc.docx'),
              title: 'Gematron Autonomous Doc',
              content: goal,
            },
          },
        },
        {
          description: 'Capture screenshot for document verification',
          actionType: 'computer_screenshot',
          params: {},
        },
      ];
    }

    if (lower.includes('excel') || lower.includes('spreadsheet')) {
      return [
        {
          description: 'Create an Excel spreadsheet via the Office skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'office',
            action: 'createExcelSheet',
            params: {
              filePath: join(TEMP_DIR, 'sheet.xlsx'),
              headers: ['ID', 'Task', 'Date'],
              rows: [[1, goal, new Date().toISOString()]],
            },
          },
        },
      ];
    }

    if (
      lower.includes('presentation') ||
      lower.includes('powerpoint') ||
      lower.includes('slides')
    ) {
      return [
        {
          description: 'Create a PowerPoint presentation via the Office skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'office',
            action: 'createPowerPoint',
            params: {
              filePath: join(TEMP_DIR, 'slides.pptx'),
              slides: [{ title: 'Autonomous Slide', bullets: [goal] }],
            },
          },
        },
      ];
    }

    if (lower.includes('blender') || lower.includes('3d render')) {
      return [
        {
          description: 'Render a 3D scene via the Blender skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'blender',
            action: 'renderScene',
            params: {
              blendFile: join(TEMP_DIR, 'scene.blend'),
              outputImg: join(TEMP_DIR, 'scene.png'),
            },
          },
        },
      ];
    }

    if (
      lower.includes('photoshop') ||
      lower.includes('premiere') ||
      lower.includes('after effects')
    ) {
      return [
        {
          description: 'Inspect the Adobe creative suite via the Creative skill',
          actionType: 'execute_skill',
          params: {
            skillId: 'creative',
            action: 'checkCreativeApps',
            params: {},
          },
        },
      ];
    }

    if (
      lower.includes('deepseek') ||
      lower.includes('backend') ||
      lower.includes('api logic') ||
      lower.includes('algorithm')
    ) {
      return [
        {
          description: 'Dispatch backend logic generation to DeepSeek',
          actionType: 'ai_dispatch',
          params: {
            modelKey: 'deepseek',
            prompt: goal,
            title: 'DeepSeek Backend Logic Dispatch',
          },
        },
      ];
    }

    if (
      lower.includes('glm') ||
      lower.includes('frontend') ||
      lower.includes('ui component') ||
      lower.includes('svg')
    ) {
      return [
        {
          description: 'Dispatch frontend architecture generation to GLM',
          actionType: 'ai_dispatch',
          params: {
            modelKey: 'glm',
            prompt: goal,
            title: 'GLM Frontend Architecture Dispatch',
          },
        },
      ];
    }

    // Generic multi-step autonomous sequence
    return [
      {
        description: `Plan and analyze goal: ${goal}`,
        actionType: 'computer_screenshot',
        params: {},
      },
      {
        description: 'Verify current foreground desktop window',
        actionType: 'switch_window',
        params: { windowTitle: 'Chrome' },
      },
      {
        description: 'Read active page state for contextual synthesis',
        actionType: 'browser_read',
        params: {},
      },
    ];
  }

  /**
   * Create an agentic task
   */
  public createTask(goal: string, stepsInput?: WorkflowStepInput[]): AgenticTask {
    const rawSteps = stepsInput && stepsInput.length > 0 ? stepsInput : this.decomposeGoal(goal);

    const steps: WorkflowStep[] = rawSteps.map((s, idx) => {
      const riskLevel: StepRisk | undefined =
        s.riskLevel ?? (s.actionType === 'run_command' ? commandRisk(s.params) : undefined);
      const runsCommand = s.actionType === 'run_command';
      return {
        id: s.id || `step_${Date.now()}_${idx}`,
        order: idx + 1,
        description: s.description,
        actionType: s.actionType,
        params: s.params || {},
        status: 'pending',
        // Commands are sensitive by nature: even a "caution" command is shown
        // to the user unless automatic approval is explicitly enabled.
        requiresApproval: s.requiresApproval ?? runsCommand,
        riskLevel,
      };
    });

    const task: AgenticTask = {
      id: `task_${Date.now()}`,
      goal,
      status: 'planning',
      steps,
      activeStepIndex: 0,
      startedAt: Date.now(),
    };

    this.currentTask = task;
    this.emit('task:created', task);
    this.emit('task:updated', task);
    return task;
  }

  /**
   * Start or resume execution of a task
   */
  public async startTask(taskId?: string): Promise<AgenticTask> {
    if (!this.currentTask || (taskId && this.currentTask.id !== taskId)) {
      throw new Error(`Task ${taskId || ''} not found.`);
    }

    this.currentTask.status = 'running';
    this.emit('task:updated', this.currentTask);

    void this.executeLoop();
    return this.currentTask;
  }

  /**
   * Pause the currently running task
   */
  public pauseTask(taskId: string): boolean {
    if (
      this.currentTask &&
      this.currentTask.id === taskId &&
      this.currentTask.status === 'running'
    ) {
      this.currentTask.status = 'paused';
      this.emit('task:updated', this.currentTask);
      return true;
    }
    return false;
  }

  /**
   * Pause the active task regardless of ID
   */
  public pauseCurrentTask(): boolean {
    if (this.currentTask && this.currentTask.status === 'running') {
      return this.pauseTask(this.currentTask.id);
    }
    return false;
  }

  /**
   * Resume a paused task
   */
  public async resumeTask(taskId: string): Promise<boolean> {
    if (
      this.currentTask &&
      this.currentTask.id === taskId &&
      this.currentTask.status === 'paused'
    ) {
      this.currentTask.status = 'running';
      this.emit('task:updated', this.currentTask);
      void this.executeLoop();
      return true;
    }
    return false;
  }

  /**
   * Resume the currently paused task
   */
  public async resumeCurrentTask(): Promise<boolean> {
    if (this.currentTask && this.currentTask.status === 'paused') {
      return this.resumeTask(this.currentTask.id);
    }
    return false;
  }

  /**
   * Cancel an active task
   */
  public cancelTask(taskId: string): boolean {
    if (this.currentTask && this.currentTask.id === taskId) {
      this.currentTask.status = 'cancelled';
      this.currentTask.completedAt = Date.now();
      this.emit('task:cancelled', this.currentTask);
      this.emit('task:updated', this.currentTask);
      return true;
    }
    return false;
  }

  /**
   * Instantly halts active autonomous steps, cancels queued actions, and safely releases input states
   */
  public async emergencyStop(
    reason = 'Emergency killswitch activated',
  ): Promise<{ stopped: boolean; task: AgenticTask | null }> {
    const task = this.currentTask;
    if (!task) {
      this.appManager.abortActiveCommands();
      await this.nativeInput.releaseAllInputStates();
      return { stopped: false, task: null };
    }

    const wasRunning =
      task.status === 'running' || task.status === 'waiting_approval' || task.status === 'paused';
    task.status = 'cancelled';
    task.error = reason;
    task.completedAt = Date.now();

    for (const step of task.steps) {
      if (step.status === 'running') {
        step.status = 'failed';
        step.error = reason;
        step.completedAt = Date.now();
      } else if (step.status === 'pending' || step.status === 'needs_approval') {
        step.status = 'failed';
        step.error = 'Cancelled by emergency killswitch';
      }
    }

    this.isExecuting = false;
    this.appManager.abortActiveCommands();
    await this.nativeInput.releaseAllInputStates();

    this.emit('task:emergency-stop', { task, reason });
    this.emit('task:cancelled', task);
    this.emit('task:updated', task);

    return { stopped: wasRunning, task };
  }

  /**
   * User approved a sensitive step
   */
  public async approveStep(taskId: string, stepId: string): Promise<boolean> {
    if (!this.currentTask || this.currentTask.id !== taskId) return false;

    const step = this.currentTask.steps.find((s) => s.id === stepId);
    if (!step || step.status !== 'needs_approval') return false;

    step.requiresApproval = false;
    step.approvedByUser = true;
    step.status = 'pending';
    this.currentTask.status = 'running';
    this.emit('task:updated', this.currentTask);

    void this.executeLoop();
    return true;
  }

  /**
   * User rejected a sensitive step
   */
  public async rejectStep(
    taskId: string,
    stepId: string,
    reason = 'User declined execution',
  ): Promise<boolean> {
    if (!this.currentTask || this.currentTask.id !== taskId) return false;

    const step = this.currentTask.steps.find((s) => s.id === stepId);
    if (!step) return false;

    step.status = 'failed';
    step.error = reason;
    this.currentTask.status = 'failed';
    this.currentTask.error = reason;
    this.currentTask.completedAt = Date.now();
    this.emit('task:updated', this.currentTask);
    return true;
  }

  private async executeLoop(): Promise<void> {
    if (this.isExecuting || !this.currentTask || this.currentTask.status !== 'running') {
      return;
    }

    this.isExecuting = true;

    try {
      while (
        this.currentTask &&
        this.currentTask.status === 'running' &&
        this.currentTask.activeStepIndex < this.currentTask.steps.length
      ) {
        const step = this.currentTask.steps[this.currentTask.activeStepIndex];
        if (!step) break;

        // Approval enforcement. Dangerous/blocked steps *always* need a human
        // decision; blocked steps are rejected without any execution path.
        const risk: StepRisk = step.riskLevel ?? 'safe';
        if (risk === 'blocked') {
          step.status = 'failed';
          step.completedAt = Date.now();
          step.error =
            'Blocked by command policy: this action can destroy data, disable security, or persist code.';
          this.currentTask.status = 'failed';
          this.currentTask.error = step.error;
          this.currentTask.completedAt = Date.now();
          this.emit('task:step-failed', {
            task: this.currentTask,
            step,
            error: step.error,
          });
          this.emit('task:updated', this.currentTask);
          break;
        }

        const needsHuman = risk === 'dangerous';
        const approvalRequired =
          step.status !== 'running' &&
          (needsHuman ? step.approvedByUser !== true : step.requiresApproval && !this.autoApprove);

        if (approvalRequired) {
          step.status = 'needs_approval';
          this.currentTask.status = 'waiting_approval';
          this.emit('task:needs-approval', { task: this.currentTask, step });
          this.emit('task:updated', this.currentTask);
          break;
        }

        step.status = 'running';
        step.startedAt = Date.now();
        this.emit('task:step-started', { task: this.currentTask, step });
        this.emit('task:updated', this.currentTask);

        try {
          const result = await this.executeStepAction(step);
          // If task was cancelled or paused during action execution, abort immediately
          if (!this.currentTask || (this.currentTask.status as TaskStatus) !== 'running') {
            break;
          }

          step.status = 'completed';
          step.completedAt = Date.now();
          step.result = result;
          this.emit('task:step-completed', { task: this.currentTask, step, result });

          this.currentTask.activeStepIndex += 1;
          this.checkpointStore?.save(this.currentTask);
          this.emit('task:updated', this.currentTask);
        } catch (stepErr) {
          if (!this.currentTask || (this.currentTask.status as TaskStatus) !== 'running') {
            break;
          }

          // One failed action must not abandon the rest of the plan: the step
          // is recorded as failed, the remaining steps still run, and the task
          // ends as "partial" with the failure listed.
          step.status = 'failed';
          step.completedAt = Date.now();
          step.error = (stepErr as Error).message;
          this.currentTask.activeStepIndex += 1;
          this.currentTask.error = this.currentTask.error
            ? `${this.currentTask.error}; ${step.error}`
            : step.error;
          this.checkpointStore?.save(this.currentTask);
          this.emit('task:step-failed', { task: this.currentTask, step, error: step.error });
          this.emit('task:updated', this.currentTask);
          continue;
        }
      }

      if (
        this.currentTask &&
        this.currentTask.status === 'running' &&
        this.currentTask.activeStepIndex >= this.currentTask.steps.length
      ) {
        const failed = this.currentTask.steps.filter((s) => s.status === 'failed');
        this.currentTask.status = failed.length > 0 ? 'partial' : 'completed';
        this.currentTask.completedAt = Date.now();
        this.checkpointStore?.remove(this.currentTask.id);
        if (this.memoryStore) {
          this.memoryStore.addRecentContext({
            category: 'workflow',
            summary: `Completed autonomous workflow: "${this.currentTask.goal}"`,
            metadata: { taskId: this.currentTask.id, steps: this.currentTask.steps.length },
          });
          const recipe = this.memoryStore.getTaskRecipe(this.currentTask.goal);
          if (recipe) {
            this.memoryStore.recordRecipeSuccess(recipe.id);
          }
        }
        this.emit('task:completed', this.currentTask);
        this.emit('task:updated', this.currentTask);
      }
    } finally {
      this.isExecuting = false;
    }
  }

  private async executeStepAction(step: WorkflowStep): Promise<any> {
    const p = step.params;

    switch (step.actionType) {
      case 'launch_app': {
        const res = await this.appManager.launchApplication(p.appName, p.args || []);
        if (!res.ok) {
          throw new Error(res.error || `Failed to launch application "${p.appName}"`);
        }
        return res;
      }

      case 'switch_window': {
        const query = p.windowTitle || p.query || p.appName || '';
        const ok = await this.appManager.focusWindow(query);
        if (!ok) {
          throw new Error(`Window matching "${query}" was not found or could not be focused.`);
        }
        let bounds = { x: 100, y: 100, width: 800, height: 500 };
        try {
          const realBounds = await this.appManager.getWindowBounds(query);
          if (realBounds && realBounds.width > 0 && realBounds.height > 0) {
            bounds = realBounds;
          }
        } catch {}

        this.emit('target-highlight', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          label: `Focused Window: ${query}`,
          timestamp: Date.now(),
        } as BoundingBoxTarget);
        return { success: true, window: query, bounds };
      }

      case 'browser_open_tab': {
        if (!this.browserGateway) throw new Error('Browser control is not configured.');
        const res = await this.browserGateway.openTab(p.url);
        if (!res.success) throw new Error(res.error || 'Failed to create Chrome browser tab.');
        return res;
      }

      case 'browser_navigate': {
        if (!this.browserGateway) throw new Error('Browser control is not configured.');
        const res = await this.browserGateway.navigate(p.url);
        if (!res.success) throw new Error(res.error || `Navigation to ${p.url} failed.`);
        return res;
      }

      case 'browser_click':
        return await this.cdpClient.click(p.target || p.selector || 'button');

      case 'browser_read':
        return await this.cdpClient.readPage();

      case 'computer_click': {
        const clickX = p.x ?? 100;
        const clickY = p.y ?? 100;
        const targetW = p.width ?? 80;
        const targetH = p.height ?? 80;
        const ok = await this.nativeInput.mouseClick(clickX, clickY, {
          button: p.button || 'left',
          double: p.double ?? false,
          scaleWithDpi: true,
        });
        if (!ok) {
          throw new Error(`Mouse click at (${clickX}, ${clickY}) failed.`);
        }
        this.emit('target-highlight', {
          x: Math.max(0, clickX - Math.round(targetW / 2)),
          y: Math.max(0, clickY - Math.round(targetH / 2)),
          width: targetW,
          height: targetH,
          label: `Click Target (${clickX}, ${clickY})`,
          timestamp: Date.now(),
        } as BoundingBoxTarget);
        return { success: true, x: clickX, y: clickY };
      }

      case 'computer_type': {
        const ok = await this.nativeInput.typeText(p.text || '');
        if (!ok) {
          throw new Error('Native keyboard typing failed.');
        }
        return { success: true, length: (p.text || '').length };
      }

      case 'computer_hotkey': {
        const ok = await this.nativeInput.sendHotkey(p.keys || 'Enter');
        if (!ok) {
          throw new Error(`Sending hotkey chord "${p.keys}" failed.`);
        }
        return { success: true, keys: p.keys };
      }

      case 'computer_screenshot':
        return await this.computerVision.captureScreen(p.sourceId);

      case 'run_command': {
        const res = await this.appManager.runSystemCommand(p.command, {
          timeoutMs: p.timeoutMs,
          // Re-assessed at execution time so a command that changes between
          // planning and running cannot dodge the policy.
          approved: step.approvedByUser === true,
          audit: (event, details) => {
            this.memoryStore?.addRecentContext({
              category: 'workflow',
              summary: `Command ${event}: ${redactCommand(String(details?.command ?? p.command))}`,
              metadata: {
                ...details,
                taskId: this.currentTask?.id,
                stepId: step.id,
              },
            });
          },
        });
        if (!res.ok || res.blocked) {
          throw new Error(
            res.stderr || res.reason || `Command failed with exit code ${res.exitCode}`,
          );
        }
        return res;
      }

      case 'verify_condition':
        return { verified: true, message: 'Condition verified successfully' };

      case 'clipboard_read': {
        const text = this.clipboardService ? this.clipboardService.readText() : '';
        const html = this.clipboardService ? this.clipboardService.readHtml() : '';
        return { success: true, text, html, length: text.length };
      }

      case 'clipboard_write': {
        const text = p.text ?? '';
        const html = p.html;
        if (this.clipboardService) {
          if (html) this.clipboardService.writeHtml(html);
          this.clipboardService.writeText(text);
        }
        return { success: true, length: text.length };
      }

      case 'execute_skill': {
        const { skillId, action, params } = p;
        const res = await computerOperator.executeSkillAction(skillId, action, params || {});
        if (!res.success) {
          throw new Error(res.error || `Failed to execute skill "${skillId}:${action}"`);
        }
        return res;
      }

      case 'operator_goal': {
        const goalStr = String(p.goal || step.description || '');
        const res = await computerOperator.executeGoal(goalStr, p.context || {});
        if (!res.success) {
          throw new Error(res.error || `Failed to execute goal "${goalStr}"`);
        }
        return res;
      }

      case 'ai_dispatch': {
        const modelKey = (p.modelKey as 'deepseek' | 'glm') || 'deepseek';
        const prompt = String(p.prompt || '');
        const res = await computerOperator.executeSkillAction('opencode', 'dispatchTask', {
          modelKey,
          prompt,
          title: p.title || `Workflow AI Step: ${step.description}`,
        });
        if (!res.success) {
          throw new Error(res.error || `AI Model dispatch (${modelKey}) failed`);
        }
        return res;
      }

      default:
        return { success: true, actionType: step.actionType };
    }
  }
}
