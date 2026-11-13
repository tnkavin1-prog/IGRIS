import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import type { CaptureResult } from './types.js';
import { computerOperator } from './computer-operator.js';
import { screenGrounding, type ScreenGroundingService } from './screen-grounding.js';
import { ComputerVisionService } from './computer-vision.js';
import { AppManagerService } from './app-manager.js';
import { NativeInputService } from './native-input.js';
import { retry } from './reliability.js';
import type { AgentPlanner } from './vision-planner.js';
import type { SecurityAuditor } from './security-auditor.js';

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
  expectedOutcome?: string;
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
  stepTimeoutMs?: number;
  autoApprove?: boolean;
  planner?: AgentPlanner;
  computerVision?: ComputerVisionService;
  appManager?: AppManagerService;
  nativeInput?: NativeInputService;
  grounding?: ScreenGroundingService;
  onObservation?: (obs: AgentObservation) => void;
  onStepStart?: (step: AgentStep) => void;
  onStepComplete?: (step: AgentStep, result: any) => void;
  onStepFail?: (step: AgentStep, error: string) => void;
  onGoalComplete?: (session: AgentSession) => void;
  onGoalFail?: (session: AgentSession, error: string) => void;
}

export function mapScreenshotPoint(
  shot: CaptureResult,
  x: unknown,
  y: unknown,
): { x: number; y: number } {
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= shot.width ||
    y >= shot.height
  ) {
    throw new Error('Action coordinates are outside the observed screenshot.');
  }
  if (!shot.screenBounds)
    throw new Error('Screenshot-to-desktop coordinate mapping is unavailable.');
  return {
    x: Math.round(shot.screenBounds.x + (x * shot.screenBounds.width) / shot.width),
    y: Math.round(shot.screenBounds.y + (y * shot.screenBounds.height) / shot.height),
  };
}

export class AutonomousAgent extends EventEmitter {
  private currentSession: AgentSession | null = null;
  private isRunning = false;
  private controller: AbortController | null = null;
  private options: AgentOptions;
  private planner?: AgentPlanner;
  private vision: ComputerVisionService;
  private manager: AppManagerService;
  private input: NativeInputService;
  private grounding: ScreenGroundingService;
  private auditor?: SecurityAuditor;

  constructor(options: AgentOptions = {}) {
    super();
    this.options = options;
    this.planner = options.planner;
    this.vision = options.computerVision || new ComputerVisionService();
    this.manager = options.appManager || new AppManagerService();
    this.input = options.nativeInput || new NativeInputService();
    this.grounding = options.grounding || screenGrounding;
  }
  public configure(
    planner: AgentPlanner,
    services: {
      computerVision: ComputerVisionService;
      appManager: AppManagerService;
      nativeInput: NativeInputService;
      auditor?: SecurityAuditor;
    },
  ): void {
    if (this.isRunning) throw new Error('Cannot reconfigure a running autonomous session.');
    this.planner = planner;
    this.vision = services.computerVision;
    this.manager = services.appManager;
    this.input = services.nativeInput;
    this.auditor = services.auditor;
  }
  public async startSession(
    goal: string,
    options: Partial<AgentOptions> = {},
  ): Promise<AgentSession> {
    if (this.isRunning) throw new Error('Autonomous agent is already running a session.');
    if (!goal.trim()) throw new Error('An autonomous goal is required.');
    if (!this.planner) throw new Error('Autonomous vision planner is not configured.');
    const settings = { ...this.options, ...options };
    this.isRunning = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const session: AgentSession = {
      id: `agent_${Date.now()}`,
      goal,
      status: 'running',
      steps: [],
      currentStepIndex: 0,
      startedAt: Date.now(),
      iterations: 0,
      maxIterations: Math.max(1, Math.min(50, settings.maxIterations ?? 30)),
    };
    this.currentSession = session;
    this.emit('session:started', session);
    try {
      await computerOperator.initialize();
      const catalog = computerOperator.getCapabilities();
      let failures = 0;
      while (!signal.aborted && session.iterations < session.maxIterations) {
        session.iterations++;
        const before = await this.observe(signal);
        settings.onObservation?.(before);
        this.emit('agent:observe', { session, observation: before });
        const decision = await this.planner.next(session, before, catalog, signal);
        signal.throwIfAborted();
        if (decision.status === 'blocked' || decision.requiresApproval)
          throw new Error(`User confirmation required: ${decision.description}`);
        if (decision.status === 'complete') {
          const after = await this.observe(signal);
          const verification = await this.planner.verify(goal, before, after, undefined, signal);
          signal.throwIfAborted();
          if (!verification.goalAchieved)
            throw new Error(`Goal completion was not verified: ${verification.evidence}`);
          session.status = 'completed';
          break;
        }
        if (
          session.steps.some(
            (previous) =>
              previous.action === decision.action &&
              previous.status === 'failed' &&
              isDeepStrictEqual(previous.params, decision.params),
          )
        ) {
          throw new Error(
            'Planner repeated an unverified mutation; stopped to avoid duplicate side effects.',
          );
        }
        const step: AgentStep = {
          id: `step_${session.id}_${session.steps.length}`,
          description: decision.description,
          expectedOutcome: decision.expectedOutcome,
          action: decision.action,
          params: decision.params,
          status: 'running',
          attempts: 1,
          maxAttempts: 1,
        };
        session.steps.push(step);
        session.currentStepIndex = session.steps.length - 1;
        settings.onStepStart?.(step);
        this.emit('agent:step-start', { session, step });
        const started = Date.now();
        this.auditor?.logAudit('agent:step-started', 'operator', {
          sessionId: session.id,
          stepId: step.id,
          action: step.action,
        });
        try {
          step.result = await this.execute(step, before, signal);
        } catch (error) {
          step.result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        signal.throwIfAborted();
        if (Date.now() - started > (settings.stepTimeoutMs ?? 60_000))
          throw new Error('Action exceeded its time budget; no retry was attempted.');
        const after = await this.observe(signal);
        settings.onObservation?.(after);
        this.emit('agent:observe', { session, observation: after });
        const verification = await this.planner.verify(goal, before, after, step, signal);
        signal.throwIfAborted();
        const succeeded =
          step.result?.success !== false &&
          step.result?.verified !== false &&
          verification.succeeded;
        this.auditor?.logAudit('agent:step-verified', 'operator', {
          sessionId: session.id,
          stepId: step.id,
          action: step.action,
          success: succeeded,
          goalAchieved: succeeded && verification.goalAchieved,
        });
        if (succeeded) {
          step.status = 'completed';
          failures = 0;
          settings.onStepComplete?.(step, { ...step.result, evidence: verification.evidence });
          this.emit('agent:step-complete', { session, step, result: step.result });
          if (verification.goalAchieved) {
            session.status = 'completed';
            break;
          }
        } else {
          step.status = 'failed';
          failures++;
          step.error =
            step.result?.error || verification.evidence || 'Visible outcome could not be verified.';
          settings.onStepFail?.(step, step.error!);
          this.emit('agent:step-fail', { session, step, error: step.error });
          if (failures >= 3) throw new Error('Three consecutive actions could not be verified.');
        }
        this.emit('session:updated', session);
      }
      if (session.status === 'running')
        throw new Error(
          `Max iterations (${session.maxIterations}) reached without verified completion.`,
        );
    } catch (err) {
      if (signal.aborted) session.status = 'cancelled';
      else {
        session.status = 'failed';
        session.error = err instanceof Error ? err.message : String(err);
        const active = session.steps.at(-1);
        if (active?.status === 'running') {
          active.status = 'failed';
          active.error = session.error;
        }
        settings.onGoalFail?.(session, session.error);
        this.emit('session:failed', session);
      }
    } finally {
      session.completedAt = Date.now();
      await this.input.releaseAllInputStates().catch(() => undefined);
      this.isRunning = false;
      this.controller = null;
    }
    if (session.status === 'completed') {
      settings.onGoalComplete?.(session);
      this.emit('session:completed', session);
    }
    return session;
  }
  public async stopSession(): Promise<{ stopped: boolean }> {
    this.controller?.abort();
    if (this.currentSession && this.isRunning) {
      this.currentSession.status = 'cancelled';
      this.emit('session:cancelled', this.currentSession);
    }
    await this.input.releaseAllInputStates();
    return { stopped: true };
  }
  public getSession(): AgentSession | null {
    return this.currentSession
      ? { ...this.currentSession, steps: [...this.currentSession.steps] }
      : null;
  }
  public isSessionRunning(): boolean {
    return this.isRunning;
  }
  private async observe(signal: AbortSignal): Promise<AgentObservation> {
    signal.throwIfAborted();
    const screenshot = await retry(
      () => this.vision.captureScreen(undefined, { maxWidth: 1280, maxHeight: 720 }),
      { timeoutMs: 4000, predicate: () => !signal.aborted },
    );
    const windows = await this.manager.listRunningWindows();
    const cursor = await this.input.getCursorPosition();
    // Which window owns the foreground is a first-class observation: without
    // it the agent cannot tell that focus moved away mid-task.
    const foreground = windows.find((w) => w.isForeground) ?? windows[0];
    return {
      timestamp: Date.now(),
      screenshot,
      windows,
      cursor,
      ...(foreground?.title ? { activeWindow: foreground.title } : {}),
    };
  }
  private async execute(
    step: AgentStep,
    observation: AgentObservation,
    signal: AbortSignal,
  ): Promise<any> {
    const p = step.params;
    const string = (name: string): string => {
      if (typeof p[name] !== 'string' || !String(p[name]).trim())
        throw new Error(`Missing string parameter: ${name}`);
      return p[name] as string;
    };
    const point = (x: string, y: string) => mapScreenshotPoint(observation.screenshot!, p[x], p[y]);
    signal.throwIfAborted();
    switch (step.action) {
      case 'openApp': {
        const result = await this.manager.launchApplication(string('name'));
        return { ...result, success: result.ok };
      }
      case 'computer_click': {
        const coords = point('x', 'y');
        return { success: await this.input.mouseClick(coords.x, coords.y), ...coords };
      }
      case 'computer_type':
        return { success: await this.input.typeText(string('text')) };
      case 'computer_hotkey': {
        if (
          !Array.isArray(p.keys) ||
          !p.keys.length ||
          p.keys.some((key) => typeof key !== 'string')
        )
          throw new Error('keys must be a non-empty string array.');
        return { success: await this.input.sendHotkey(p.keys as string[]) };
      }
      case 'press_key':
        return { success: await this.input.sendHotkey(string('key')) };
      case 'mouse_move': {
        const coords = point('x', 'y');
        return { success: await this.input.mouseMove(coords.x, coords.y) };
      }
      case 'mouse_drag': {
        const start = point('start_x', 'start_y'),
          end = point('end_x', 'end_y');
        return { success: await this.input.mouseDrag(start.x, start.y, end.x, end.y, 20) };
      }
      case 'click_element': {
        const result = await this.grounding.clickElement(string('description'), {
          containerTitle: typeof p.containerTitle === 'string' ? p.containerTitle : undefined,
        });
        return { ...result, success: result.ok };
      }
      case 'scroll': {
        if (typeof p.deltaY !== 'number' || !Number.isFinite(p.deltaY) || Math.abs(p.deltaY) > 2000)
          throw new Error('deltaY must be between -2000 and 2000.');
        return { success: await this.input.mouseScroll(p.deltaY) };
      }
      case 'execute_skill': {
        const skillId = string('skillId'),
          action = string('action');
        const definition = computerOperator.registry
          .getSkill(skillId)
          ?.getActions()
          .find((entry) => entry.name === action);
        if (!definition) throw new Error('Unknown skill action.');
        if (definition.dangerous)
          throw new Error(
            'Skill action requires explicit user approval outside the autonomous loop.',
          );
        if (!p.params || typeof p.params !== 'object' || Array.isArray(p.params))
          throw new Error('Skill params must be an object.');
        for (const param of definition.parameters ?? []) {
          if (param.required && (p.params as Record<string, unknown>)[param.name] === undefined)
            throw new Error(`Missing skill parameter: ${param.name}`);
        }
        const result = await computerOperator.executeSkillAction(
          skillId,
          action,
          p.params as Record<string, unknown>,
        );
        return {
          ...result,
          verified: await computerOperator.registry.verifyActionResult(skillId, action, result),
        };
      }
      case 'wait': {
        if (typeof p.ms !== 'number' || !Number.isFinite(p.ms) || p.ms < 0 || p.ms > 5000)
          throw new Error('Wait must be between 0 and 5000 ms.');
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new Error('Cancelled'));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          }, p.ms as number);
          signal.addEventListener('abort', abort, { once: true });
        });
        return { success: true };
      }
      default:
        throw new Error(`Unsupported autonomous action: ${step.action}`);
    }
  }
}
export const autonomousAgent = new AutonomousAgent();
