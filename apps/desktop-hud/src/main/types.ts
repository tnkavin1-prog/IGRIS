export interface ChromeTabInfo {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
  favIconUrl?: string;
  active?: boolean;
}

export interface ChromeStatus {
  connected: boolean;
  port: number;
  browser?: string;
  activeTab: ChromeTabInfo | null;
  tabs: ChromeTabInfo[];
  error?: string;
}

export interface VisualBlackboardLesson {
  id: string;
  title: string;
  topic?: string;
  diagramType: 'geometry' | 'graph' | 'formula' | 'mensuration' | 'flowchart' | 'chalk_sketch';
  latexFormula?: string;
  svgMarkup: string;
  steps: string[];
  activeStep?: number;
  teachingNarration?: string;
  createdAt: number;
}

export interface ConversationMessage {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'system';
  name?: string;
  text?: string;
  title?: string;
  detail?: string;
  status?: 'running' | 'ok' | 'error';
  imageUrl?: string;
  at: number;
}

export type LiveHUDStatus =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error' | 'closed';

export type HudDisplayMode = 'orb' | 'bar' | 'full' | 'console';

export interface HUDSettings {
  apiKey: string;
  modelId: string;
  voice: string;
  autoApprove: boolean;
  alwaysOnTop: boolean;
  bridgeUrl?: string;
  soundEffectsEnabled?: boolean;
  soundVolume?: number;
  minimizeToTray?: boolean;
  wakeWordEnabled?: boolean;
}

export interface WorkflowAuditScreenshot {
  timestamp: number;
  title: string;
  base64Data: string;
  mimeType?: string;
}

export interface SessionExportPayload {
  conversation: ConversationMessage[];
  blackboard: VisualBlackboardLesson | null;
  activeTabTitle?: string;
  currentTask?: AgenticTask | null;
  taskHistory?: AgenticTask[];
  screenshots?: WorkflowAuditScreenshot[];
  telemetrySummary?: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    totalLatencyMs: number;
    startedAt?: number;
    completedAt?: number;
  };
}

/* ==================== OS-Level Computer Vision ==================== */
export interface DesktopSourceInfo {
  id: string;
  name: string;
  isScreen: boolean;
  displayId?: string;
  appIcon?: string;
}

export interface CaptureResult {
  data: string; // base64
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sourceId?: string;
  sourceName?: string;
  screenBounds?: { x: number; y: number; width: number; height: number };
  timestamp: number;
}

export interface SingleDisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  physicalBounds?: { x: number; y: number; width: number; height: number };
}

export interface DisplayMetrics {
  width: number;
  height: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  allDisplays?: SingleDisplayInfo[];
  virtualBounds?: { x: number; y: number; width: number; height: number };
}

/* ==================== Native Input & Control ==================== */
export interface CursorPosition {
  x: number;
  y: number;
}

export interface CrosshairTarget {
  x: number;
  y: number;
  label?: string;
  timestamp: number;
}

export interface BoundingBoxTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  source?: string;
  timestamp: number;
  color?: string;
}

export interface TextMatch {
  text: string;
  x: number;
  y: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  source: 'window_title' | 'window_control' | 'ui_automation' | 'browser_dom' | 'ocr' | 'mock';
  containerTitle?: string;
}

export interface FindTextOptions {
  windowTitle?: string;
  exact?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface TextLocationResult {
  found: boolean;
  query: string;
  matches: TextMatch[];
  bestMatch?: TextMatch;
}

/* ==================== Application Lifecycle & Windows ==================== */
export interface WindowItem {
  hwnd: number;
  title: string;
  processName: string;
  pid: number;
  isVisible: boolean;
  isIconic: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  appName: string;
  windowTitle?: string;
  /**
   * True when the launched window was confirmed to be the foreground window.
   * `ok` only proves that a matching window appeared.
   */
  verified?: boolean;
  error?: string;
}

export interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  durationMs: number;
  blocked?: boolean;
  reason?: string;
}

/* ==================== Autonomous Agentic Workflow ==================== */
export type WorkflowActionType =
  | 'launch_app'
  | 'switch_window'
  | 'browser_open_tab'
  | 'browser_navigate'
  | 'browser_click'
  | 'browser_read'
  | 'computer_click'
  | 'computer_type'
  | 'computer_hotkey'
  | 'computer_screenshot'
  | 'run_command'
  | 'verify_condition'
  | 'clipboard_read'
  | 'clipboard_write'
  | 'execute_skill'
  | 'operator_goal'
  | 'ai_dispatch';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'needs_approval';

/**
 * Risk tier of a workflow step. `dangerous` and `blocked` steps always
 * require an explicit human decision, regardless of the global auto-approve
 * setting; `blocked` steps are rejected outright by the command policy.
 */
export type StepRisk = 'safe' | 'caution' | 'dangerous' | 'blocked';

export interface WorkflowStepInput {
  id?: string;
  description: string;
  actionType: WorkflowActionType | string;
  params: Record<string, any>;
  requiresApproval?: boolean;
  riskLevel?: StepRisk;
}

export interface WorkflowStep {
  id: string;
  order: number;
  description: string;
  actionType: WorkflowActionType | string;
  params: Record<string, any>;
  status: StepStatus;
  requiresApproval: boolean;
  /** Risk tier, computed at plan time for command-executing steps. */
  riskLevel?: StepRisk;
  /** Set only after the user explicitly approved this step in the HUD. */
  approvedByUser?: boolean;
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export type TaskStatus =
  'planning' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface AgenticTask {
  id: string;
  goal: string;
  status: TaskStatus;
  steps: WorkflowStep[];
  activeStepIndex: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface HardwareTelemetry {
  cpuUsage: number;
  memoryTotal: number;
  memoryFree: number;
  memoryUsed: number;
  memoryUsagePercent: number;
  activeProcessCount: number;
  uptimeSeconds: number;
  timestamp: number;
}

export type WindowTilingLayout = 'side-by-side' | 'maximize-target' | 'grid-2x2';

export interface TileWindowsOptions {
  targetApp?: string;
  windowTitles?: string[];
  workArea?: { x: number; y: number; width: number; height: number };
  monitorIndex?: number;
}

export interface TabSearchMatch {
  id: string;
  title: string;
  url: string;
  matchCount: number;
  snippet: string;
}

export interface TabSearchResult {
  query: string;
  totalTabs: number;
  matchedTabs: TabSearchMatch[];
}

export interface TiledWindowInfo {
  title: string;
  hwnd?: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface TileWindowsResult {
  success: boolean;
  layout: WindowTilingLayout;
  tiledWindows: TiledWindowInfo[];
  message?: string;
  error?: string;
}

export interface NeuralTelemetry {
  active: boolean;
  cpuUsage?: number;
  memoryUsagePercent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  processCount?: number;
  uptimeSeconds?: number;
  currentApp?: string;
  lastAction?: string;
  workflowActive: boolean;
  activeStepTitle?: string;
  totalSteps?: number;
  completedSteps?: number;
}
