/**
 * Internal protocols:
 *  - side panel ↔ content script page operations
 *  - side panel ↔ local bridge
 *  - persisted settings and UI state
 *
 * Everything crossing a message boundary is JSON-serializable.
 */
import type { ThinkingLevel } from './models.js';

/* ────────────────────────── page observation ────────────────────────── */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementSummary {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  href?: string;
  /** Present only for non-secret form fields. */
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
  bbox?: BoundingBox;
  /** Extra context used by the approval engine, e.g. parent form text. */
  context?: string;
}

export interface PageFingerprint {
  url: string;
  title: string;
  generation: number;
  scrollY: number;
  scrollMax: number;
  elementCount: number;
  textLength: number;
  /** Viewport in CSS pixels; used to map screenshot pixels to clicks. */
  viewportWidth?: number;
  viewportHeight?: number;
  dpr?: number;
  /** Random id generated once per content-script instance. Changes on reload. */
  documentId: string;
  /** Cheap structural hash; changes when visible content changes. */
  digest: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  generation: number;
  viewport: { width: number; height: number; dpr: number };
  scroll: { y: number; max: number };
  headings: string[];
  text: string;
  textTruncated: boolean;
  elements: ElementSummary[];
  elementsTruncated: boolean;
  counts: { links: number; images: number; forms: number; inputs: number };
  fingerprint: PageFingerprint;
}

export interface PageStateResult {
  fingerprint: PageFingerprint;
  visibleText: string;
}

export interface LinkInfo {
  text: string;
  url: string;
  ref?: string;
  /** File extension hint, e.g. pdf. */
  kind?: string;
}

export interface ImageInfo {
  alt: string;
  src: string;
  host: string;
  width: number;
  height: number;
  ref?: string;
}

export interface MatchInfo {
  ref: string;
  role: string;
  name: string;
  tag: string;
  text: string;
}

export interface ContentResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; hint?: string };
}

export type PageOp =
  | 'ping'
  | 'snapshot'
  | 'visibleText'
  | 'fullText'
  | 'headings'
  | 'links'
  | 'images'
  | 'findText'
  | 'findElement'
  | 'elementState'
  | 'structure'
  | 'table'
  | 'click'
  | 'hover'
  | 'scroll'
  | 'scrollTo'
  | 'type'
  | 'select'
  | 'checkbox'
  | 'pressKey'
  | 'focus'
  | 'waitForElement'
  | 'waitForText'
  | 'submit'
  | 'pickAt'
  | 'grabFingerprint'
  | 'inspectTarget'
  | 'inspectActive'
  | 'linkHref'
  | 'openImageResult';

export interface PageOpRequest {
  type: 'GBL_CONTENT_OP';
  op: PageOp;
  args?: Record<string, unknown>;
}

/* ──────────────────────── content operation results ──────────────────── */

export interface PingResult {
  alive: true;
  version: string;
  url: string;
  generation: number;
}

export interface ActionResult {
  action: string;
  target?: ElementSummary;
  /** Fingerprint captured immediately before the action. */
  before: PageFingerprint;
  /** Present when the page survived long enough to measure. */
  after?: PageFingerprint;
  changed?: boolean;
  note?: string;
}

export interface InspectionResult {
  target: ElementSummary;
  /** Text used to judge whether the action is consequential. */
  riskText: string;
  inForm: boolean;
  formAction?: string;
  submitControl?: ElementSummary;
  isSubmitLike: boolean;
}

export interface TargetLocator {
  ref?: string;
  text?: string;
  role?: string;
  label?: string;
  name?: string;
  index?: number;
}

/* ───────────────────────────── bridge ─────────────────────────────── */

export interface TokenRequest {
  model: string;
  voice?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface TokenResponse {
  token: string;
  model: string;
  /** ISO timestamp: last moment a new Live session may be started. */
  newSessionExpiresAt: string;
  /** ISO timestamp: last moment messages may be sent on the session. */
  expiresAt: string;
  singleUse: true;
}

export interface BridgeHealth {
  ok: true;
  service: string;
  version: string;
  configured: boolean;
  keyConfigured: boolean;
  secretConfigured: boolean;
  originsConfigured: boolean;
  allowedModels: string[];
  serverTime: string;
}

export interface BridgeErrorBody {
  error: string;
  code:
    | 'unauthorized'
    | 'rate_limited'
    | 'invalid_request'
    | 'not_configured'
    | 'upstream_error'
    | 'forbidden'
    | 'not_found';
  retryAfterMs?: number;
  details?: string;
}

/* ─────────────────────────── settings / UI ─────────────────────────── */

export type RetentionMode = 'session' | 'local';
export type SessionMode = 'agent' | 'conversation';

export interface AppSettings {
  /** Loopback token bridge origin. Only 127.0.0.1 / localhost are accepted. */
  bridgeUrl: string;
  /** Live model id from the shared registry. */
  modelId: string;
  voice: string;
  language: string;
  thinkingLevel: ThinkingLevel;
  /** When false, tools are not declared and the session is conversation-only. */
  browserControl: boolean;
  confirmRisky: boolean;
  autoApprove?: boolean;
  includeContextOnStart: boolean;
  autoReconnect: boolean;
  vadSilenceMs: number;
  vadPrefixMs: number;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  inputGain: number;
  outputVolume: number;
  retention: RetentionMode;
  /** Hard ceiling on tool-call rounds per user turn. */
  maxToolSteps: number;
  /** Play a short chime when the session starts listening. */
  audioCues: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  bridgeUrl: 'http://127.0.0.1:47821',
  modelId: 'gemini-3.8-live',
  voice: 'Kore',
  language: 'en-IN',
  thinkingLevel: 'MEDIUM',
  browserControl: true,
  confirmRisky: true,
  autoApprove: false,
  includeContextOnStart: true,
  autoReconnect: true,
  vadSilenceMs: 600,
  vadPrefixMs: 40,
  inputDeviceId: null,
  outputDeviceId: null,
  inputGain: 1,
  outputVolume: 0.9,
  retention: 'session',
  maxToolSteps: 12,
  audioCues: false,
};

export type LiveStatus =
  | 'idle'
  | 'requesting-mic'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting'
  | 'reconnecting'
  | 'awaiting-approval'
  | 'quota'
  | 'error'
  | 'closed';

export type EntryStatus = 'running' | 'ok' | 'error' | 'denied' | 'cancelled';

export interface UserEntry {
  id: string;
  kind: 'user';
  text: string;
  at: number;
  final: boolean;
}
export interface AssistantEntry {
  id: string;
  kind: 'assistant';
  text: string;
  at: number;
  final: boolean;
}
export interface ToolEntry {
  id: string;
  kind: 'tool';
  callId: string;
  name: string;
  title: string;
  detail?: string;
  status: EntryStatus;
  at: number;
  durationMs?: number;
}
export interface SystemEntry {
  id: string;
  kind: 'system';
  text: string;
  level: 'info' | 'warn' | 'error';
  at: number;
}
export type ConversationEntry = UserEntry | AssistantEntry | ToolEntry | SystemEntry;

export interface ApprovalRequest {
  callId: string;
  toolName: string;
  title: string;
  description: string;
  detail?: string;
  /** e.g. "download", "form-submit", "close-tab". */
  risk: string;
  url?: string;
  /** Optional screenshot preview (data URL) for visual clicks. */
  previewDataUrl?: string;
}

export interface PlanStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

export interface AgentTaskState {
  objective: string;
  startedAt: number;
  steps: PlanStep[];
  toolRounds: number;
  lastObservation?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  toolCalling: boolean;
}

export interface RuntimeEnvironment {
  extensionVersion: string;
  chromeVersion: string;
  platform: string;
  bridgeUrl: string;
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
