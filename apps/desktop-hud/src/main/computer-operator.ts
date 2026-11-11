import {
  skillRegistry,
  type SkillRegistry,
  type SkillResult,
  type SkillCatalogEntry,
} from './skill-framework.js';
import { windowsSkill, WindowsSkill } from './skills/windows.skill.js';
import { officeSkill, OfficeSkill } from './skills/office.skill.js';
import { blenderSkill, BlenderSkill } from './skills/blender.skill.js';
import { blenderGUISkill, BlenderGUISkill } from './skills/blender-gui.skill.js';
import { creativeSkill, CreativeSkill } from './skills/creative.skill.js';
import { openCodeSkill, OpenCodeSkill } from './skills/opencode.skill.js';
import type { AppManagerService } from './app-manager.js';
import type { CDPClient } from './cdp-client.js';
import { autonomousAgent } from './autonomous-agent.js';

export interface ComputerOperatorOptions {
  mockMode?: boolean;
  appManager?: AppManagerService;
  cdpClient?: CDPClient;
}

export interface OperatorGoalResult {
  goal: string;
  skillId: string;
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
}

export class UniversalComputerOperator {
  public readonly registry: SkillRegistry;
  private mockMode: boolean;
  private appManager?: AppManagerService;
  private cdpClient?: CDPClient;
  private initialized = false;

  constructor(options: ComputerOperatorOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
    this.appManager = options.appManager;
    this.cdpClient = options.cdpClient;
    this.registry = skillRegistry;
  }

  /** Returns the injected application manager, when available. */
  public getAppManager(): AppManagerService | undefined {
    return this.appManager;
  }

  /** Returns the injected CDP client, when available. */
  public getCdpClient(): CDPClient | undefined {
    return this.cdpClient;
  }

  /**
   * Initializes and registers all application skills into the skill registry.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // Register all primary application skills
    this.registry.registerSkill(
      this.mockMode ? new WindowsSkill({ mockMode: true }) : windowsSkill,
    );
    this.registry.registerSkill(this.mockMode ? new OfficeSkill({ mockMode: true }) : officeSkill);
    this.registry.registerSkill(
      this.mockMode ? new BlenderSkill({ mockMode: true }) : blenderSkill,
    );
    // Blender GUI skill runs the real Blender window (mouse/keyboard driven)
    this.registry.registerSkill(
      this.mockMode ? new BlenderGUISkill({ mockMode: true }) : blenderGUISkill,
    );
    this.registry.registerSkill(
      this.mockMode ? new CreativeSkill({ mockMode: true }) : creativeSkill,
    );
    this.registry.registerSkill(
      this.mockMode ? new OpenCodeSkill({ mockMode: true }) : openCodeSkill,
    );

    this.initialized = true;
  }

  /**
   * Directly executes an action on a specific registered skill.
   */
  public async executeSkillAction(
    skillId: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<SkillResult> {
    await this.initialize();
    return this.registry.executeAction(skillId, action, params);
  }

  /**
   * Returns a complete catalog of all registered skills and their action signatures.
   */
  public getCapabilities(): SkillCatalogEntry[] {
    return this.registry.exportCatalog();
  }

  /**
   * Autonomous Natural Language Goal Router.
   * Parses user intent and dispatches to the most appropriate application skill.
   */
  public async executeGoal(
    goal: string,
    context: Record<string, unknown> = {},
  ): Promise<OperatorGoalResult> {
    await this.initialize();
    const startedAt = Date.now();
    const normalized = goal.toLowerCase().trim();

    let targetSkill = 'windows';
    let targetAction = 'getSystemTelemetry';
    const params: Record<string, unknown> = { ...context };

    if (
      normalized.includes('word') ||
      normalized.includes('document') ||
      normalized.includes('doc')
    ) {
      targetSkill = 'office';
      targetAction = /\bread\b/i.test(normalized) ? 'readWordDoc' : 'createWordDoc';
      if (!params.filePath) params.filePath = 'E:\\Gematron\\temp\\document.docx';
      if (!params.title) params.title = 'Gematron Generated Document';
      if (!params.content) params.content = goal;
    } else if (
      normalized.includes('excel') ||
      normalized.includes('sheet') ||
      normalized.includes('spreadsheet') ||
      normalized.includes('table')
    ) {
      targetSkill = 'office';
      targetAction = /\bread\b/i.test(normalized) ? 'readExcelSheet' : 'createExcelSheet';
      if (!params.filePath) params.filePath = 'E:\\Gematron\\temp\\data.xlsx';
      if (!params.headers) params.headers = ['Item', 'Value', 'Timestamp'];
      if (!params.rows) params.rows = [['Goal', goal, Date.now()]];
    } else if (
      normalized.includes('powerpoint') ||
      normalized.includes('presentation') ||
      normalized.includes('slides') ||
      normalized.includes('slide')
    ) {
      targetSkill = 'office';
      targetAction = 'createPowerPoint';
      if (!params.filePath) params.filePath = 'E:\\Gematron\\temp\\presentation.pptx';
      if (!params.slides) params.slides = [{ title: 'Gematron Autonomous Slide', bullets: [goal] }];
    } else if (
      normalized.includes('blender') ||
      normalized.includes('3d') ||
      normalized.includes('render scene')
    ) {
      targetSkill = 'blender';
      targetAction = normalized.includes('render') ? 'renderScene' : 'checkBlender';
    } else if (
      normalized.includes('photoshop') ||
      normalized.includes('psd') ||
      normalized.includes('premiere') ||
      normalized.includes('after effects')
    ) {
      targetSkill = 'creative';
      targetAction =
        normalized.includes('batch') || normalized.includes('export')
          ? 'renderPhotoshopBatch'
          : 'checkCreativeApps';
    } else if (
      normalized.includes('opencode') ||
      normalized.includes('model') ||
      normalized.includes('free model') ||
      normalized.includes('deepseek') ||
      normalized.includes('glm')
    ) {
      targetSkill = 'opencode';
      targetAction =
        normalized.includes('dispatch') || normalized.includes('code')
          ? 'dispatchTask'
          : 'listFreeModels';
      if (!params.prompt) params.prompt = goal;
    } else if (
      normalized.includes('open') ||
      normalized.includes('launch') ||
      normalized.includes('start')
    ) {
      targetSkill = 'windows';
      targetAction = 'openApp';
      const words = normalized.split(/\s+/);
      const appIdx = words.findIndex((w) => ['open', 'launch', 'start'].includes(w));
      const appName = words[appIdx + 1] || 'notepad.exe';
      params.name = appName;
    } else if (
      normalized.includes('close') ||
      normalized.includes('kill') ||
      normalized.includes('terminate')
    ) {
      targetSkill = 'windows';
      targetAction = 'closeApp';
      const words = normalized.split(/\s+/);
      const killIdx = words.findIndex((w) => ['close', 'kill', 'terminate'].includes(w));
      const procName = words[killIdx + 1] || 'notepad.exe';
      params.processName = procName.endsWith('.exe') ? procName : `${procName}.exe`;
    } else if (normalized.includes('search file') || normalized.includes('find file')) {
      targetSkill = 'windows';
      targetAction = 'searchFiles';
      params.directory = params.directory || 'E:\\Gematron';
      params.query = params.query || normalized.replace(/.*(search|find)\s+files?\s+/i, '').trim();
    } else if (normalized.includes('organize') || normalized.includes('organise')) {
      targetSkill = 'windows';
      targetAction = 'organizeFiles';
      params.sourceDir = params.sourceDir || 'E:\\Gematron\\temp';
    } else if (normalized.includes('window') || normalized.includes('active windows')) {
      targetSkill = 'windows';
      targetAction = 'listWindows';
    }

    const result = await this.registry.executeAction(targetSkill, targetAction, params);

    return {
      goal,
      skillId: targetSkill,
      action: targetAction,
      success: result.success,
      data: result.data,
      error: result.error,
      executionTimeMs: Date.now() - startedAt,
    };
  }

  /**
   * Execute a fully autonomous goal using the Observe → Think → Act → Verify loop.
   * This is the Tier-1 computer-use entry point: the agent drives the computer
   * independently until the goal is achieved, with self-correction on failure.
   *
   * @param goal - Natural language goal (e.g. "Open Blender, download a scene, add shaders, and render")
   * @param options - Optional session overrides (max iterations, voice callbacks, etc.)
   */
  public async executeAutonomousGoal(
    goal: string,
    options?: {
      maxIterations?: number;
      maxStepAttempts?: number;
      stepTimeoutMs?: number;
      onObservation?: (obs: any) => void;
      onStepStart?: (step: any) => void;
      onStepComplete?: (step: any, result: any) => void;
      onStepFail?: (step: any, error: string) => void;
      onGoalComplete?: (session: any) => void;
      onGoalFail?: (session: any, error: string) => void;
    },
  ): Promise<{
    ok: boolean;
    sessionId: string;
    goal: string;
    status: string;
    steps: number;
    error?: string;
  }> {
    try {
      const session = await autonomousAgent.startSession(goal, {
        maxIterations: options?.maxIterations,
        maxStepAttempts: options?.maxStepAttempts,
        stepTimeoutMs: options?.stepTimeoutMs,
        autoApprove: true,
        voiceEnabled: true,
        onObservation: options?.onObservation,
        onStepStart: options?.onStepStart,
        onStepComplete: options?.onStepComplete,
        onStepFail: options?.onStepFail,
        onGoalComplete: options?.onGoalComplete,
        onGoalFail: options?.onGoalFail,
      });

      return {
        ok: session.status === 'completed',
        sessionId: session.id,
        goal: session.goal,
        status: session.status,
        steps: session.steps.length,
        error: session.error,
      };
    } catch (err) {
      return {
        ok: false,
        sessionId: '',
        goal,
        status: 'failed',
        steps: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Stop the currently running autonomous session (emergency killswitch).
   */
  public async stopAutonomousSession(): Promise<{ stopped: boolean }> {
    return autonomousAgent.stopSession();
  }

  /**
   * Get the current autonomous session status.
   */
  public getAutonomousSession(): any {
    return autonomousAgent.getSession();
  }

  /**
   * Aggregates telemetry and system health across Windows and all registered skills.
   */
  public async getSystemHealth(): Promise<Record<string, unknown>> {
    await this.initialize();
    const telemetry = await this.registry.executeAction('windows', 'getSystemTelemetry');
    const skillsList = this.registry.listSkills();
    const skillAvailability: Record<string, boolean> = {};

    for (const skill of skillsList) {
      try {
        skillAvailability[skill.id] = await skill.isAvailable();
      } catch {
        skillAvailability[skill.id] = false;
      }
    }

    return {
      timestamp: Date.now(),
      system: telemetry.data || null,
      skills: skillAvailability,
      registeredSkillsCount: skillsList.length,
    };
  }
}

export const computerOperator = new UniversalComputerOperator();
