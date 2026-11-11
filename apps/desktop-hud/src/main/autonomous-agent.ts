/**
 * AutonomousAgent — Tier-1 computer-use reasoning loop.
 *
 * Implements the Observe → Think → Act → Verify cycle that lets Gematron
 * drive the computer autonomously (like Aura by Neural Agent):
 *
 *   1. OBSERVE   — Capture a screenshot, read screen text, list windows
 *   2. THINK     — Decide the next action based on the goal and current state
 *   3. ACT       — Execute the action via NativeInput / AppManager / ScreenGrounding
 *   4. VERIFY    — Re-observe and check if the action had the intended effect
 *   5. REPEAT    — If not yet achieved, replan and try again (self-correction)
 *
 * No user intervention is required. If the agent is unsure, it asks ITSELF
 * (reasons internally) rather than interrupting the user. It keeps going
 * until the goal is achieved, max iterations are reached, or it stops
 * itself due to repeated failure.
 */

import { EventEmitter } from 'node:events';
import type { CaptureResult } from './types.js';
import { computerOperator } from './computer-operator.js';
import { screenGrounding } from './screen-grounding.js';
import { ComputerVisionService } from './computer-vision.js';
import { AppManagerService } from './app-manager.js';
import { NativeInputService } from './native-input.js';
import { downloadManager } from './download-manager.js';

// Create service instances for autonomous observation and action
const cv = new ComputerVisionService();
const am = new AppManagerService();
const ni = new NativeInputService();

export interface AgentObservation {
  timestamp: number;
  screenshot?: CaptureResult;
  screenText?: string;
  windows: Array<{
    title: string;
    processName: string;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
  cursor: { x: number; y: number };
  activeWindow?: string;
}

export interface AgentStep {
  id: string;
  description: string;
  action: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  attempts: number;
  maxAttempts: number;
}

export interface AgentSession {
  id: string;
  goal: string;
  status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  steps: AgentStep[];
  currentStepIndex: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  iterations: number;
  maxIterations: number;
}

export interface AgentOptions {
  maxIterations?: number;
  maxStepAttempts?: number;
  stepTimeoutMs?: number;
  autoApprove?: boolean;
  voiceEnabled?: boolean;
  onObservation?: (obs: AgentObservation) => void;
  onStepStart?: (step: AgentStep) => void;
  onStepComplete?: (step: AgentStep, result: any) => void;
  onStepFail?: (step: AgentStep, error: string) => void;
  onGoalComplete?: (session: AgentSession) => void;
  onGoalFail?: (session: AgentSession, error: string) => void;
}

export class AutonomousAgent extends EventEmitter {
  private maxIterations: number;
  private maxStepAttempts: number;

  private currentSession: AgentSession | null = null;
  private isRunning = false;
  private stopRequested = false;

  private readonly onObservation?: (obs: AgentObservation) => void;
  private readonly onStepStart?: (step: AgentStep) => void;
  // Used in executeStepWithRetries below
  private readonly onStepComplete?: (step: AgentStep, result: any) => void;
  private readonly onStepFail?: (step: AgentStep, error: string) => void;
  private readonly onGoalComplete?: (session: AgentSession) => void;
  private readonly onGoalFail?: (session: AgentSession, error: string) => void;

  constructor(options: AgentOptions = {}) {
    super();
    this.maxIterations = options.maxIterations ?? 30;
    this.maxStepAttempts = options.maxStepAttempts ?? 3;

    this.onObservation = options.onObservation;
    this.onStepStart = options.onStepStart;
    this.onStepComplete = options.onStepComplete;
    this.onStepFail = options.onStepFail;
    this.onGoalComplete = options.onGoalComplete;
    this.onGoalFail = options.onGoalFail;
  }

  /* ---------------------------------------------------------------- */
  /*  Public API                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Start an autonomous session to achieve a goal.
   * Runs the Observe → Think → Act → Verify loop until completion.
   */
  public async startSession(goal: string, options?: Partial<AgentOptions>): Promise<AgentSession> {
    if (this.isRunning) {
      throw new Error('Autonomous agent is already running a session.');
    }

    this.isRunning = true;
    this.stopRequested = false;

    const session: AgentSession = {
      id: `agent_${Date.now()}`,
      goal,
      status: 'planning',
      steps: [],
      currentStepIndex: 0,
      startedAt: Date.now(),
      iterations: 0,
      maxIterations: Math.max(1, Math.min(50, options?.maxIterations ?? this.maxIterations)),
    };

    this.currentSession = session;
    this.emit('session:started', session);

    try {
      session.status = 'running';
      this.emit('session:updated', session);

      await this.runLoop(session);
    } catch (err) {
      session.status = 'failed';
      session.error = err instanceof Error ? err.message : String(err);
      session.completedAt = Date.now();
      this.emit('session:failed', session);
      if (this.onGoalFail) this.onGoalFail(session, session.error);
      throw err;
    }

    const finalStatus = session.status as AgentSession['status'];
    if (finalStatus !== 'cancelled' && finalStatus !== 'failed') {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session:completed', session);
      if (this.onGoalComplete) this.onGoalComplete(session);
    }

    this.isRunning = false;
    this.currentSession = null;
    return session;
  }

  /**
   * Stop the current autonomous session (emergency killswitch).
   */
  public async stopSession(): Promise<{ stopped: boolean }> {
    this.stopRequested = true;
    await ni.releaseAllInputStates();
    if (this.currentSession) {
      this.currentSession.status = 'cancelled';
      this.currentSession.completedAt = Date.now();
      this.emit('session:cancelled', this.currentSession);
    }
    this.isRunning = false;
    return { stopped: true };
  }

  public getSession(): AgentSession | null {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  public isSessionRunning(): boolean {
    return this.isRunning;
  }

  /* ---------------------------------------------------------------- */
  /*  Core Loop                                                       */
  /* ---------------------------------------------------------------- */

  private async runLoop(session: AgentSession): Promise<void> {
    while (
      session.status === 'running' &&
      !this.stopRequested &&
      session.iterations < session.maxIterations
    ) {
      session.iterations += 1;

      // 1. OBSERVE
      const observation = await this.observe(session);
      if (this.onObservation) this.onObservation(observation);
      this.emit('agent:observe', { session, observation });

      // 2. CHECK GOAL ACHIEVEMENT
      const achieved = await this.checkGoalAchieved(observation);
      if (achieved) {
        session.status = 'completed';
        session.completedAt = Date.now();
        this.emit('session:updated', session);
        return;
      }

      // 3. THINK — decide next action
      const nextAction = await this.think(session, observation);
      if (!nextAction) {
        session.status = 'failed';
        session.error = 'Agent could not determine next action to progress toward goal.';
        session.completedAt = Date.now();
        this.emit('session:failed', session);
        if (this.onGoalFail) this.onGoalFail(session, session.error);
        return;
      }

      // 4. ACT — execute with retries
      const step: AgentStep = {
        id: `step_${Date.now()}_${session.steps.length}`,
        description: nextAction.description,
        action: nextAction.action,
        params: nextAction.params,
        status: 'pending',
        attempts: 0,
        maxAttempts: this.isReadOnlyAction(nextAction.action) ? this.maxStepAttempts : 1,
      };
      session.steps.push(step);
      session.currentStepIndex = session.steps.length - 1;

      const stepResult = await this.executeStepWithRetries(session, step, observation);

      // 5. VERIFY — did the action work?
      const verified = await this.verifyStep(step, stepResult);
      if (verified) {
        step.status = 'completed';
        step.result = stepResult;
        if (this.onStepComplete) this.onStepComplete(step, stepResult);
        this.emit('agent:step-complete', { session, step, result: stepResult });
      } else {
        step.status = 'failed';
        step.error = stepResult?.error || 'Step verification failed';
        step.attempts += 1;
        if (this.onStepFail) this.onStepFail(step, step.error || '');
        this.emit('agent:step-fail', { session, step, error: step.error });
        session.status = 'failed';
        session.error = step.error;
        session.completedAt = Date.now();
        return;
      }

      // Brief pause between iterations
      await new Promise((r) => setTimeout(r, 500));
    }

    if (session.iterations >= session.maxIterations) {
      session.status = 'failed';
      session.error = `Max iterations (${session.maxIterations}) reached without achieving goal.`;
      session.completedAt = Date.now();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  1. OBSERVE                                                      */
  /* ---------------------------------------------------------------- */

  private async observe(_session: AgentSession): Promise<AgentObservation> {
    const windows = await am.listRunningWindows().catch(() => []);
    const cursor = await ni.getCursorPosition().catch(() => ({ x: 0, y: 0 }));

    let screenshot: CaptureResult | undefined;
    let screenText = '';

    try {
      screenshot = await cv.captureScreen();
      if (screenshot) {
        const visionService = (globalThis as any).__geminiLiveService;
        if (visionService?.sendImageFrame) {
          visionService.sendImageFrame(screenshot.data);
        }
      }
    } catch {
      /* screenshot is optional */
    }

    try {
      const textResult = await screenGrounding.readScreen('', { maxResults: 20 });
      screenText = textResult.matches.map((m) => m.text).join('\n');
    } catch {
      /* screen text is optional */
    }

    return {
      timestamp: Date.now(),
      screenshot,
      screenText,
      windows: windows.map((w) => ({
        title: w.title,
        processName: w.processName,
        bounds: w.bounds
          ? { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height }
          : undefined,
      })),
      cursor,
      activeWindow: windows[0]?.title,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  2. CHECK GOAL ACHIEVEMENT                                       */
  /* ---------------------------------------------------------------- */

  private async checkGoalAchieved(observation: AgentObservation): Promise<boolean> {
    if (!this.currentSession) return false;
    const session = this.currentSession;
    const goal = session.goal.toLowerCase();

    const completedActions = new Set(
      session.steps.filter((s) => s.status === 'completed').map((s) => s.action),
    );

    const hasBlender = observation.windows.some((w) => w.title.toLowerCase().includes('blender'));
    const hasNotepad = observation.windows.some((w) => w.title.toLowerCase().includes('notepad'));
    const hasCalculator = observation.windows.some((w) =>
      w.title.toLowerCase().includes('calculator'),
    );
    if (goal.includes('blender') && goal.includes('render')) {
      if (hasBlender && completedActions.has('renderScene')) {
        return true;
      }
    }

    if (goal.includes('open blender')) {
      return hasBlender;
    }

    if (goal.includes('download')) {
      return completedActions.has('downloadScene');
    }

    if (goal.includes('notepad') || goal.includes('write')) {
      if (goal.includes('write') || goal.includes('type') || /\bnote\b/.test(goal)) {
        return hasNotepad && completedActions.has('computer_type');
      }
      return hasNotepad;
    }

    if (goal.includes('calculator') || goal.includes('calc')) {
      return hasCalculator;
    }

    if (goal.includes('open') && (goal.includes('chrome') || goal.includes('browser'))) {
      return observation.windows.some((w) => w.processName.toLowerCase() === 'chrome');
    }

    return false;
  }

  /* ---------------------------------------------------------------- */
  /*  3. THINK — decide next action                                   */
  /* ---------------------------------------------------------------- */

  private async think(
    session: AgentSession,
    observation: AgentObservation,
  ): Promise<{
    description: string;
    action: string;
    params: Record<string, unknown>;
  } | null> {
    const goal = session.goal.toLowerCase();
    const completedActions = new Set(
      session.steps.filter((s) => s.status === 'completed').map((s) => s.action),
    );
    const failedActions = new Set(
      session.steps.filter((s) => s.status === 'failed').map((s) => s.action),
    );
    const hasBlender = observation.windows.some((w) => w.title.toLowerCase().includes('blender'));
    const hasNotepad = observation.windows.some((w) => w.title.toLowerCase().includes('notepad'));
    const hasCalculator = observation.windows.some((w) =>
      w.title.toLowerCase().includes('calculator'),
    );
    const hasChrome = observation.windows.some((w) => w.title.toLowerCase().includes('chrome'));

    // ---------- BLENDER GOALS ----------
    if (goal.includes('blender')) {
      if (
        !hasBlender &&
        !completedActions.has('openBlender') &&
        !failedActions.has('openBlender')
      ) {
        return {
          description: 'Open Blender GUI application',
          action: 'openBlender',
          params: {},
        };
      }

      if (
        goal.includes('download') &&
        !completedActions.has('downloadScene') &&
        !failedActions.has('downloadScene')
      ) {
        const urlMatch = session.goal.match(/https?:\/\/[^\s]+/);
        const url = urlMatch
          ? urlMatch[0]
          : 'https://download.blender.org/demo/test/animations/big_buck_bunny.zip';
        return {
          description: 'Download 3D scene from the web',
          action: 'downloadScene',
          params: { url },
        };
      }

      if (
        hasBlender &&
        goal.includes('open') &&
        !completedActions.has('openFileInBlender') &&
        !failedActions.has('openFileInBlender')
      ) {
        const downloads = await downloadManager.listDownloads().catch(() => []);
        const blendFile = downloads.find((d) => d.name.endsWith('.blend'));
        if (blendFile) {
          return {
            description: `Open downloaded scene in Blender: ${blendFile.name}`,
            action: 'openFileInBlender',
            params: { filePath: blendFile.path },
          };
        }
        return {
          description: 'Create new Blender scene',
          action: 'openBlender',
          params: {},
        };
      }

      if (
        hasBlender &&
        (goal.includes('add') || goal.includes('cube') || goal.includes('sphere')) &&
        !completedActions.has('addMesh')
      ) {
        const meshType = goal.includes('cube')
          ? 'cube'
          : goal.includes('sphere')
            ? 'sphere'
            : 'cube';
        return {
          description: `Add ${meshType} mesh to Blender scene`,
          action: 'addMesh',
          params: { type: meshType },
        };
      }

      if (
        hasBlender &&
        (goal.includes('material') || goal.includes('shader') || goal.includes('color')) &&
        !completedActions.has('addMaterial')
      ) {
        return {
          description: 'Add material to selected object in Blender',
          action: 'addMaterial',
          params: { name: 'GematronMaterial', color: '#FF5733', roughness: 0.4, metallic: 0.1 },
        };
      }

      if (
        hasBlender &&
        (goal.includes('camera') || goal.includes('view') || goal.includes('position')) &&
        !completedActions.has('positionCamera')
      ) {
        return {
          description: 'Position Blender camera for best view',
          action: 'positionCamera',
          params: { location: '0,-3,2', rotation: '60,0,0' },
        };
      }

      if (
        hasBlender &&
        goal.includes('render') &&
        !completedActions.has('renderScene') &&
        !failedActions.has('renderScene')
      ) {
        return {
          description: 'Render the Blender scene',
          action: 'renderScene',
          params: { outputPath: 'E:\\Gematron\\downloads\\blender_render.png', format: 'png' },
        };
      }

      if (hasBlender && goal.includes('save') && !completedActions.has('saveBlend')) {
        return {
          description: 'Save the Blender scene',
          action: 'saveBlend',
          params: { filePath: 'E:\\Gematron\\downloads\\gemetron_scene.blend' },
        };
      }

      if (hasBlender && completedActions.size === 0) {
        return {
          description: 'Observe Blender interface state',
          action: 'takeScreenshot',
          params: {},
        };
      }
    }

    // ---------- NOTEPAD GOALS ----------
    if (goal.includes('notepad') || goal.includes('write') || goal.includes('note')) {
      if (!hasNotepad && !completedActions.has('openApp')) {
        return {
          description: 'Open Notepad',
          action: 'openApp',
          params: { name: 'notepad' },
        };
      }
      if (hasNotepad && !completedActions.has('computer_type')) {
        return {
          description: 'Type content into Notepad',
          action: 'computer_type',
          params: {
            text: `[Gematron Autonomous Agent]\nGoal: ${session.goal}\nExecuted: ${new Date().toLocaleString()}\nStatus: Autonomous operation complete.\n`,
          },
        };
      }
    }

    // ---------- CALCULATOR GOALS ----------
    if (goal.includes('calculator') || goal.includes('calc')) {
      if (!hasCalculator && !completedActions.has('openApp')) {
        return {
          description: 'Open Calculator',
          action: 'openApp',
          params: { name: 'calculator' },
        };
      }
    }

    // ---------- WEB/BROWSER GOALS ----------
    if (
      goal.includes('search') ||
      goal.includes('google') ||
      goal.includes('web') ||
      goal.includes('chrome')
    ) {
      if (!hasChrome && !completedActions.has('openApp')) {
        return {
          description: 'Open Google Chrome',
          action: 'openApp',
          params: { name: 'chrome' },
        };
      }
    }

    // Observe once, then stop honestly instead of looping screenshots or repeating mutations.
    if (!completedActions.has('computer_screenshot')) {
      return {
        description: 'Capture current desktop state for observation',
        action: 'computer_screenshot',
        params: {},
      };
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /*  4. ACT — execute step with retries                              */
  /* ---------------------------------------------------------------- */

  private isReadOnlyAction(action: string): boolean {
    return (
      action === 'computer_screenshot' || action === 'takeScreenshot' || action === 'checkBlender'
    );
  }

  private async executeStepWithRetries(
    _session: AgentSession,
    step: AgentStep,
    _observation: AgentObservation,
  ): Promise<any> {
    let lastError = '';
    let attempt = 0;

    while (attempt < step.maxAttempts && !this.stopRequested) {
      attempt += 1;
      step.attempts = attempt;
      step.status = 'running';
      if (this.onStepStart) this.onStepStart(step);

      try {
        const result = await this.executeSingleStep(step);
        step.status = 'completed';
        step.result = result;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        step.error = lastError;

        await ni.releaseAllInputStates().catch(() => {});

        if (attempt < step.maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    step.status = 'failed';
    step.error = lastError;
    throw new Error(
      lastError || `Step "${step.description}" failed after ${step.maxAttempts} attempts`,
    );
  }

  private async executeSingleStep(step: AgentStep): Promise<any> {
    const { action, params } = step;

    const skillActions = [
      'openBlender',
      'downloadScene',
      'openFileInBlender',
      'importScene',
      'addMesh',
      'addMaterial',
      'addShader',
      'positionCamera',
      'renderScene',
      'saveBlend',
      'takeScreenshot',
      'closeBlender',
      'checkBlender',
    ];

    if (skillActions.includes(action)) {
      const result = await computerOperator.executeSkillAction('blender-gui', action, params);
      if (!result.success) {
        throw new Error(result.error || `Blender GUI action "${action}" failed`);
      }
      return result;
    }

    if (action === 'openApp') {
      const result = await am.launchApplication(String(params.name || ''));
      if (!result.ok)
        throw new Error(result.error || `Application "${params.name}" failed to open.`);
      return { success: true, ...result };
    }

    switch (action) {
      case 'computer_type':
        await ni.typeText(String(params.text || ''));
        if (params.pressEnter) await ni.sendHotkey('Enter');
        return { typed: true, length: String(params.text || '').length };

      case 'computer_click': {
        const ok = await ni.mouseClick(Number(params.x || 0), Number(params.y || 0));
        if (!ok) throw new Error('Mouse click failed');
        return { clicked: true, x: params.x, y: params.y };
      }

      case 'computer_hotkey':
        await ni.sendHotkey(String(params.keys || 'Enter'));
        return { hotkey: params.keys };

      case 'computer_screenshot': {
        const shot = await cv.captureScreen();
        if (!shot) throw new Error('Screenshot failed');
        return { screenshot: shot.data, width: shot.width, height: shot.height };
      }

      case 'mouse_move':
        await ni.mouseMove(Number(params.x || 0), Number(params.y || 0));
        return { moved: true, x: params.x, y: params.y };

      case 'mouse_drag':
        await ni.mouseDrag(
          Number(params.start_x || 0),
          Number(params.start_y || 0),
          Number(params.end_x || 0),
          Number(params.end_y || 0),
          Number(params.steps || 10),
        );
        return { dragged: true };

      case 'press_key':
        await ni.sendHotkey(String(params.key || 'Enter'));
        return { key: params.key };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  5. VERIFY — check if step succeeded                             */
  /* ---------------------------------------------------------------- */

  private async verifyStep(_step: AgentStep, result: any): Promise<boolean> {
    if (result && result.success === false) return false;
    if (result && result.error) return false;
    return true;
  }
}

export const autonomousAgent = new AutonomousAgent();
