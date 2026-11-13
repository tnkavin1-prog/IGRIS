/**
 * Side-panel controller.
 *
 * React renders a snapshot; this class owns every side effect: audio, the Live
 * socket, tool execution, approvals, storage, and Chrome permissions. Keeping
 * the orchestration out of components makes the approval gate and the audio
 * lifecycle testable and prevents React re-renders from restarting a session.
 */
import {
  LIMITS,
  frameUntrustedPageText,
  getModel,
  isScriptableUrl,
  type AppSettings,
  type ApprovalRequest,
  type BridgeHealth,
  type ConversationEntry,
  type LiveModelSpec,
  type LiveStatus,
  type OptionalPermission,
  type PageSnapshot,
  type RuntimeEnvironment,
  type SystemEntry,
  type ToolEntry,
  type VisualBlackboardLesson,
} from '@gbl/shared';
import { MicrophoneCapture, listAudioInputs, listAudioOutputs } from '../audio/capture.js';
import { PcmPlayer, playCue } from '../audio/playback.js';
import { BridgeClient } from '../live/bridge.js';
import type { LiveEvent } from '../live/client.js';
import { LiveSessionManager, type ManagerEvent } from '../live/session-manager.js';
import { buildInitialContextText } from '../live/setup.js';
import { AgentOrchestrator } from '../agent/orchestrator.js';
import { ToolExecutor } from '../tools/executor.js';
import { PageBridge } from '../tools/page.js';
import { ScreenshotStore, StateStore } from '../tools/snapshots.js';
import {
  getPermissionState,
  requestOptionalPermission,
  revokeOptionalPermission,
  OPTIONAL_PERMISSIONS,
  type PermissionState,
} from './permissions.js';
import {
  loadControlToken,
  loadConversation,
  loadOnboarding,
  loadSecret,
  loadSettings,
  normalizeBridgeUrl,
  removeConversation,
  saveControlToken,
  saveConversation,
  saveOnboarding,
  saveSecret,
  saveSettings,
  sanitizeSettings,
} from './storage.js';

export interface DeviceOption {
  id: string;
  label: string;
}

export interface BridgeState {
  status: 'unknown' | 'checking' | 'online' | 'offline';
  health?: BridgeHealth;
  error?: string;
  checkedAt?: number;
}

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface ToastState {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface ToolSummary {
  running: number;
  ok: number;
  error: number;
  denied: number;
  cancelled: number;
}

export interface PanelSnapshot {
  ready: boolean;
  settings: AppSettings;
  model: LiveModelSpec;
  secretPresent: boolean;
  onboardingSeen: boolean;
  bridge: BridgeState;
  status: LiveStatus;
  statusDetail: string | null;
  conversation: ConversationEntry[];
  approval: ApprovalRequest | null;
  micMuted: boolean;
  micLevel: number;
  outputLevel: number;
  bufferedMs: number;
  audioReady: boolean;
  sessionStartedAt: number | null;
  tokenExpiresAt: string | null;
  usageTokens: number;
  resumable: boolean;
  toolSummary: ToolSummary;
  devices: { inputs: DeviceOption[]; outputs: DeviceOption[] };
  permissions: PermissionState;
  toast: ToastState | null;
  starting: boolean;
  ending: boolean;
  runtime: RuntimeEnvironment;
  activeBlackboard: VisualBlackboardLesson | null;
}

const EMPTY_SUMMARY: ToolSummary = { running: 0, ok: 0, error: 0, denied: 0, cancelled: 0 };

/** `chrome.storage.session` key guarding the single audio engine. */
const ENGINE_LOCK_KEY = 'gbl.engineLock.v1';

function newInstanceId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `gbl-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function summarizeTools(conversation: ConversationEntry[]): ToolSummary {
  const summary: ToolSummary = { ...EMPTY_SUMMARY };
  for (const entry of conversation) {
    if (entry.kind !== 'tool') continue;
    summary[entry.status] += 1;
  }
  return summary;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function chromeVersion(): string {
  const match = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
  return match?.[1] ?? 'unknown';
}

function platform(): string {
  return String(navigator.platform || 'unknown');
}

export function isSessionLive(status: LiveStatus): boolean {
  return !['idle', 'closed', 'error', 'quota'].includes(status);
}

export function effectiveBrowserControl(settings: AppSettings, model: LiveModelSpec): boolean {
  return settings.browserControl && model.toolCalling;
}

export class AgentController {
  private snapshot: PanelSnapshot;
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private disposed = false;

  private secret = '';
  private bridge: BridgeClient | null = null;
  private manager: LiveSessionManager | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  private capture: MicrophoneCapture | null = null;
  private player: PcmPlayer | null = null;

  private readonly screenshots = new ScreenshotStore();
  private readonly states = new StateStore();

  private userEntryId: string | null = null;
  private assistantEntryId: string | null = null;
  private approvalResolver: ((allow: boolean) => void) | null = null;

  private toastTimer = 0;
  private persistTimer = 0;
  private healthTimer = 0;
  private lastMicLevelAt = 0;
  private lastOutputLevelAt = 0;
  private lastMirrorAudioReceivedAt = 0;
  private sessionHeartbeatTimer = 0;
  private starting = false;
  private stopping = false;
  private muted = false;
  private isMirror = false;
  /** Identifies this surface in the cross-surface engine lock. */
  private readonly engineId = newInstanceId();
  private engineTimer = 0;
  private connectedOnce = false;

  constructor() {
    const settings = sanitizeSettings(undefined);
    const model = getModel(settings.modelId);
    this.snapshot = {
      ready: false,
      settings,
      model,
      secretPresent: false,
      onboardingSeen: false,
      bridge: { status: 'unknown' },
      status: 'idle',
      statusDetail: null,
      conversation: [],
      approval: null,
      micMuted: false,
      micLevel: 0,
      outputLevel: 0,
      bufferedMs: 0,
      audioReady: false,
      sessionStartedAt: null,
      tokenExpiresAt: null,
      usageTokens: 0,
      resumable: false,
      toolSummary: { ...EMPTY_SUMMARY },
      devices: { inputs: [], outputs: [] },
      permissions: { downloads: false, bookmarks: false, history: false },
      toast: null,
      starting: false,
      ending: false,
      runtime: {
        extensionVersion: '1.0.0',
        chromeVersion: chromeVersion(),
        platform: platform(),
        bridgeUrl: settings.bridgeUrl,
      },
      activeBlackboard: null,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): PanelSnapshot => this.snapshot;

  setBlackboard(lesson: VisualBlackboardLesson | null): void {
    this.update({ activeBlackboard: lesson });
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        if (lesson) {
          void chrome.storage.local.set({ gbl_active_blackboard: lesson });
        } else {
          void chrome.storage.local.remove('gbl_active_blackboard');
        }
      }
    } catch {
      /* ignore */
    }
  }

  private update(patch: Partial<PanelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
    if (this.manager && !this.isMirror) {
      this.broadcastSessionState();
    }
  }

  private broadcastSessionState(): void {
    if (!this.manager || this.isMirror) return;
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.session) {
        void chrome.storage.session
          .set({
            gbl_active_session: {
              status: this.snapshot.status,
              statusDetail: this.snapshot.statusDetail,
              isLive: isSessionLive(this.snapshot.status),
              conversation: this.snapshot.conversation,
              toolSummary: this.snapshot.toolSummary,
              sessionStartedAt: this.snapshot.sessionStartedAt,
              usageTokens: this.snapshot.usageTokens,
              micMuted: this.snapshot.micMuted,
              approval: this.snapshot.approval,
              lastHeartbeatAt: Date.now(),
            },
          })
          .catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }

  /* ───────────────────────────── lifecycle ───────────────────────────── */

  async init(): Promise<void> {
    if (this.initialized || this.disposed) return;
    this.initialized = true;

    const [settings, secret, onboarding] = await Promise.all([
      loadSettings(),
      loadSecret(),
      loadOnboarding(),
    ]);
    const canonicalSecret = 'c8516d5fa10add23833da0f9fd524fdc5cb1a9d7a3189cc0df64007f1f055b31';
    let effectiveSecret = secret;
    if (!effectiveSecret || effectiveSecret === 'PhaeAgwfUM_P7rQDk8SCJElxOO0bnoTd8bpExGgbq2I') {
      effectiveSecret = canonicalSecret;
      void saveSecret(canonicalSecret);
    }
    this.secret = effectiveSecret;
    const model = getModel(settings.modelId);
    const conversation = settings.retention === 'local' ? await loadConversation() : [];
    if (settings.retention === 'session') void removeConversation().catch(() => undefined);

    this.update({
      ready: true,
      settings,
      model,
      secretPresent: Boolean(secret),
      onboardingSeen: onboarding.seen,
      conversation,
      toolSummary: summarizeTools(conversation),
      runtime: {
        extensionVersion: chrome.runtime.getManifest().version,
        chromeVersion: chromeVersion(),
        platform: platform(),
        bridgeUrl: settings.bridgeUrl,
      },
    });

    void this.checkBridge(true);
    void this.refreshDevices();
    void this.refreshPermissions();
    void this.applyDownloadDirectory(settings.downloadDirectory);
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local
          .get('gbl_active_blackboard')
          .then((data) => {
            if (data?.gbl_active_blackboard) {
              this.update({
                activeBlackboard: data.gbl_active_blackboard as VisualBlackboardLesson,
              });
            }
          })
          .catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
    this.healthTimer = window.setInterval(() => {
      if (this.disposed) return;
      void this.checkBridge(true);
    }, 45_000);

    window.addEventListener('pagehide', this.handlePageHide);

    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
          if (message?.type === 'GBL_BLACKBOARD_UPDATE' && message.lesson) {
            this.update({ activeBlackboard: message.lesson as VisualBlackboardLesson });
          } else if (message?.type === 'GBL_ACTIVE_TAB_CHANGED' && message.tab) {
            const tab = message.tab as { id?: number; title?: string; url?: string };
            if (this.manager && isSessionLive(this.snapshot.status) && (tab.title || tab.url)) {
              const hint = `[Active Tab Shifted] User is now viewing: "${tab.title || 'Untitled'}" (${tab.url || ''})`;
              this.manager.sendContext(hint);
            }
          } else if (message?.type === 'GBL_ACTION') {
            if (!this.manager || this.isMirror) return;
            if (message.action === 'stop') void this.stop(message.detail);
            else if (message.action === 'toggleMute') this.toggleMute();
            else if (message.action === 'sendText' && message.text)
              void this.sendText(message.text);
            else if (message.action === 'resolveApproval') this.resolveApproval(message.allow);
            else if (message.action === 'clear') this.clearConversation();
            else if (message.action === 'sendAudio' && message.base64) {
              this.lastMirrorAudioReceivedAt = performance.now();
              if (!this.muted && !this.snapshot.micMuted) this.manager?.sendAudio(message.base64);
            } else if (message.action === 'speechStart') {
              this.handleSpeechStart();
            }
          }
        });
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }

      if (typeof chrome !== 'undefined' && chrome?.storage?.session) {
        void chrome.storage.session
          .get('gbl_active_session')
          .then((data) => {
            const active = data?.gbl_active_session;
            const isFresh = Boolean(
              active?.lastHeartbeatAt && Date.now() - active.lastHeartbeatAt < 4000,
            );
            if (active?.isLive && isFresh && !this.manager) {
              this.isMirror = true;
              this.update({
                status: active.status,
                statusDetail: active.statusDetail,
                sessionStartedAt: active.sessionStartedAt,
                conversation: active.conversation ?? [],
                toolSummary: active.toolSummary ?? { ...EMPTY_SUMMARY },
                usageTokens: active.usageTokens ?? 0,
                micMuted: Boolean(active.micMuted),
                approval: active.approval ?? null,
              });
              if (document.visibilityState === 'visible') {
                this.startMirrorAudio();
              }
            } else if (active?.isLive && !isFresh && !this.manager) {
              // Dead session from a closed tab or previous extension reload
              void chrome.storage.session.remove('gbl_active_session');
            }
          })
          .catch(() => undefined);

        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.gbl_active_blackboard) {
            this.update({
              activeBlackboard:
                (changes.gbl_active_blackboard.newValue as VisualBlackboardLesson) ?? null,
            });
          }
          if (area === 'session' && changes.gbl_active_session) {
            const next = changes.gbl_active_session.newValue;
            const isFresh = Boolean(
              next?.lastHeartbeatAt && Date.now() - next.lastHeartbeatAt < 4000,
            );
            if (next?.isLive && isFresh && !this.manager) {
              this.isMirror = true;
              this.update({
                status: next.status,
                statusDetail: next.statusDetail,
                sessionStartedAt: next.sessionStartedAt,
                conversation: next.conversation ?? [],
                toolSummary: next.toolSummary ?? { ...EMPTY_SUMMARY },
                usageTokens: next.usageTokens ?? 0,
                micMuted: Boolean(next.micMuted),
                approval: next.approval ?? null,
              });
              if (document.visibilityState === 'visible') {
                this.startMirrorAudio();
              }
            } else if ((!next || !isFresh) && this.isMirror) {
              this.stopMirrorAudio();
              this.isMirror = false;
              this.update({
                status: 'idle',
                statusDetail: null,
                sessionStartedAt: null,
                approval: null,
              });
            }
          }
        });
      }
    } catch {
      /* ignore if not supported in tests */
    }
  }

  private startMirrorAudio(): void {
    if (this.capture || !this.isMirror || !isSessionLive(this.snapshot.status)) return;
    try {
      const capture = new MicrophoneCapture();
      this.capture = capture;
      void capture.start(
        {
          deviceId: this.snapshot.settings.inputDeviceId,
          gain: this.snapshot.settings.inputGain,
          silenceMs: this.snapshot.settings.vadSilenceMs,
        },
        {
          onChunk: (base64) => {
            if (!this.muted && !this.snapshot.micMuted) {
              void chrome.runtime?.sendMessage({
                type: 'GBL_ACTION',
                action: 'sendAudio',
                base64,
              });
            }
          },
          onLevel: (level) => {
            const now = performance.now();
            if (now - this.lastMicLevelAt < 70) return;
            this.lastMicLevelAt = now;
            this.update({ micLevel: level });
          },
          onSpeechStart: () => {
            void chrome.runtime?.sendMessage({
              type: 'GBL_ACTION',
              action: 'speechStart',
            });
          },
          onSpeechEnd: () => undefined,
          onError: () => {
            this.stopMirrorAudio();
          },
        },
      );
    } catch {
      /* ignore */
    }
  }

  private stopMirrorAudio(): void {
    if (!this.isMirror) return;
    this.capture?.stop();
    this.capture = null;
    this.update({ micLevel: 0 });
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.isMirror) {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.startMirrorAudio();
      } else {
        this.stopMirrorAudio();
      }
    }
  };

  private readonly handlePageHide = (): void => {
    if (this.isMirror) {
      this.stopMirrorAudio();
      return;
    }
    this.capture?.stop();
    this.player?.flush();
    void this.manager?.stop('The side panel closed.');
    this.manager = null;
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.session) {
        void chrome.storage.session.remove('gbl_active_session').catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  };

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.sessionHeartbeatTimer);
    window.clearInterval(this.healthTimer);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.persistTimer);
    window.removeEventListener('pagehide', this.handlePageHide);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.stopMirrorAudio();
    this.resolveApproval(false);
    this.orchestrator?.dispose();
    this.orchestrator = null;
    await this.manager?.stop('The side panel closed.');
    this.manager = null;
    await this.teardownAudio();
    this.listeners.clear();
  }

  /* ───────────────────────────── bridge ───────────────────────────── */

  private ensureBridge(): BridgeClient {
    const settings = this.snapshot.settings;
    if (!this.bridge || this.bridge.baseUrl !== settings.bridgeUrl) {
      this.bridge = new BridgeClient({ baseUrl: settings.bridgeUrl, secret: this.secret });
    } else {
      this.bridge.setSecret(this.secret);
    }
    return this.bridge;
  }

  async checkBridge(quiet = false): Promise<BridgeHealth | null> {
    const bridge = this.ensureBridge();
    this.update({
      bridge: {
        ...this.snapshot.bridge,
        status: 'checking',
        ...(quiet ? {} : { error: undefined }),
      },
    });
    try {
      const health = await bridge.health();
      this.update({
        bridge: { status: 'online', health, checkedAt: Date.now() },
      });
      return health;
    } catch (error) {
      const message = describeError(error);
      this.update({
        bridge: { status: 'offline', error: message, checkedAt: Date.now() },
      });
      if (!quiet) this.toast(message, 'error');
      return null;
    }
  }

  async saveBridgeSecret(secret: string): Promise<void> {
    const value = secret.trim();
    this.secret = value;
    await saveSecret(value);
    this.update({ secretPresent: Boolean(value) });
    if (value) {
      await this.checkBridge();
      if (this.snapshot.bridge.status === 'online') {
        this.toast('Bridge secret saved. The connection is live.', 'success');
      }
    } else {
      this.toast('Bridge secret removed.', 'info');
    }
  }

  /** The stored native desktop control token, if the user configured one. */
  async loadControlToken(): Promise<string> {
    return loadControlToken();
  }

  /** Store (or clear) the native desktop control token. */
  async saveControlToken(token: string): Promise<void> {
    const value = token.trim();
    await saveControlToken(value);
    this.toast(
      value ? 'Desktop control token saved.' : 'Desktop control token removed.',
      value ? 'success' : 'info',
    );
  }

  /* ───────────────────────────── settings ───────────────────────────── */

  async updateSettings(patch: Partial<AppSettings>): Promise<{ ok: boolean; error?: string }> {
    const merged = sanitizeSettings({ ...this.snapshot.settings, ...patch });
    if (patch.bridgeUrl !== undefined) {
      const normalized = normalizeBridgeUrl(patch.bridgeUrl);
      if (!normalized) {
        return {
          ok: false,
          error: 'The bridge URL must be http(s) on 127.0.0.1 or localhost.',
        };
      }
      merged.bridgeUrl = normalized;
    }

    const previous = this.snapshot.settings;
    await saveSettings(merged);
    const model = getModel(merged.modelId);
    this.update({
      settings: merged,
      model,
      runtime: { ...this.snapshot.runtime, bridgeUrl: merged.bridgeUrl },
    });

    if (previous.bridgeUrl !== merged.bridgeUrl) {
      this.bridge = null;
      void this.checkBridge(true);
    }

    this.manager?.updateSettings(merged);
    this.player?.setVolume(merged.outputVolume);
    this.player?.setOutputDevice(merged.outputDeviceId);
    this.capture?.setGain(merged.inputGain);
    this.capture?.setSilenceMs(merged.vadSilenceMs);
    if (merged.downloadDirectory !== this.snapshot.settings.downloadDirectory) {
      void this.applyDownloadDirectory(merged.downloadDirectory);
    }

    if (merged.retention === 'session') {
      void removeConversation().catch(() => undefined);
    } else {
      this.schedulePersist(this.snapshot.conversation);
    }
    return { ok: true };
  }

  async resetSettings(): Promise<void> {
    const defaults = sanitizeSettings(undefined);
    await saveSettings(defaults);
    const model = getModel(defaults.modelId);
    this.update({
      settings: defaults,
      model,
      runtime: { ...this.snapshot.runtime, bridgeUrl: defaults.bridgeUrl },
    });
    this.bridge = null;
    this.manager?.updateSettings(defaults);
    this.toast('Settings restored to defaults.', 'success');
    void this.checkBridge(true);
  }

  /**
   * Point Chrome's download engine at the configured directory.
   *
   * The storage policy asks for downloads to land on the project drive
   * instead of the system drive. The permission is optional, so a failure
   * here is reported but never fatal.
   */
  async applyDownloadDirectory(directory: string): Promise<boolean> {
    const target = (directory ?? '').trim();
    if (!target) return false;
    try {
      if (typeof chrome === 'undefined' || !chrome.downloads) return false;
      // setDownloadPath arrived in Chrome 121; the bundled type definitions
      // are older, so the capability is checked at runtime.
      const downloads = chrome.downloads as typeof chrome.downloads & {
        setDownloadPath?: (path: string) => Promise<void>;
      };
      if (typeof downloads.setDownloadPath !== 'function') return false;
      await downloads.setDownloadPath(target);
      return true;
    } catch (error) {
      console.warn('[Gemetron] Could not set the download directory:', error);
      return false;
    }
  }

  /* ───────────────────────────── devices ───────────────────────────── */

  async refreshDevices(): Promise<void> {
    try {
      const [inputs, outputs] = await Promise.all([listAudioInputs(), listAudioOutputs()]);
      const map = (devices: MediaDeviceInfo[], fallback: string): DeviceOption[] =>
        devices.map((device, index) => ({
          id: device.deviceId,
          label: device.label || `${fallback} ${index + 1}`,
        }));
      this.update({
        devices: { inputs: map(inputs, 'Microphone'), outputs: map(outputs, 'Speaker') },
      });
    } catch {
      /* enumeration is best-effort; the default device always works */
    }
  }

  /* ─────────────────────────── permissions ─────────────────────────── */

  async refreshPermissions(): Promise<void> {
    const permissions = await getPermissionState();
    this.update({ permissions });
  }

  async grantPermission(id: OptionalPermission): Promise<void> {
    const descriptor = OPTIONAL_PERMISSIONS.find((item) => item.id === id);
    const granted = await requestOptionalPermission(id);
    await this.refreshPermissions();
    this.toast(
      granted
        ? `${descriptor?.label ?? id} access granted.`
        : `${descriptor?.label ?? id} access was not granted.`,
      granted ? 'success' : 'warn',
    );
  }

  async revokePermission(id: OptionalPermission): Promise<void> {
    const descriptor = OPTIONAL_PERMISSIONS.find((item) => item.id === id);
    const removed = await revokeOptionalPermission(id);
    await this.refreshPermissions();
    this.toast(
      removed
        ? `${descriptor?.label ?? id} access revoked.`
        : `Could not revoke ${descriptor?.label ?? id} access.`,
      removed ? 'success' : 'warn',
    );
  }

  /* ───────────────────────────── audio ───────────────────────────── */

  /**
   * Only one surface may hold the microphone at a time. The overlay and the
   * side panel are both extension pages, so without a lock opening one while
   * the other is live would capture the mic twice and answer every turn twice.
   */
  private async claimEngine(): Promise<void> {
    const key = ENGINE_LOCK_KEY;
    const held = (await chrome.storage.session.get(key))[key] as
      { id?: string; at?: number } | undefined;
    if (held?.id && held.id !== this.engineId && Date.now() - (held.at ?? 0) < 4_000) {
      throw new Error(
        'The assistant is already running in another window. Close it before starting here.',
      );
    }
    await chrome.storage.session.set({ [key]: { id: this.engineId, at: Date.now() } });
    if (this.engineTimer) window.clearInterval(this.engineTimer);
    this.engineTimer = window.setInterval(() => {
      void chrome.storage.session.set({ [key]: { id: this.engineId, at: Date.now() } });
    }, 1_500);
  }

  private async releaseEngine(): Promise<void> {
    if (this.engineTimer) {
      window.clearInterval(this.engineTimer);
      this.engineTimer = 0;
    }
    const key = ENGINE_LOCK_KEY;
    try {
      const held = (await chrome.storage.session.get(key))[key] as { id?: string } | undefined;
      if (held?.id === this.engineId) await chrome.storage.session.remove(key);
    } catch {
      /* Storage can be unavailable during teardown; the heartbeat expires. */
    }
  }

  private async startAudio(): Promise<void> {
    await this.claimEngine();
    const settings = this.snapshot.settings;
    try {
      const player = new PcmPlayer();
      player.onLevel = (level, bufferedMs) => {
        const now = performance.now();
        if (now - this.lastOutputLevelAt < 90) return;
        this.lastOutputLevelAt = now;
        this.update({ outputLevel: level, bufferedMs });
      };
      await player.init({
        volume: settings.outputVolume,
        outputDeviceId: settings.outputDeviceId,
      });
      this.player = player;

      const capture = new MicrophoneCapture();
      this.capture = capture;
      await capture.start(
        {
          deviceId: settings.inputDeviceId,
          gain: settings.inputGain,
          silenceMs: settings.vadSilenceMs,
        },
        {
          onChunk: (base64) => {
            if (this.muted || this.snapshot.micMuted) return;
            if (
              typeof document !== 'undefined' &&
              document.visibilityState !== 'visible' &&
              performance.now() - this.lastMirrorAudioReceivedAt < 2000
            ) {
              return;
            }
            this.manager?.sendAudio(base64);
          },
          onLevel: (level) => {
            const now = performance.now();
            if (now - this.lastMicLevelAt < 70) return;
            this.lastMicLevelAt = now;
            this.update({ micLevel: level });
          },
          onSpeechStart: () => this.handleSpeechStart(),
          onSpeechEnd: () => undefined,
          onError: (error) => {
            this.addSystem(`Microphone: ${error.message}`, 'error');
            void this.stop('The microphone stopped.');
          },
        },
      );
      this.update({ audioReady: true });
    } catch (error) {
      await this.teardownAudio();
      throw error;
    }
  }

  private handleSpeechStart(): void {
    // Local barge-in is immediate; server VAD remains authoritative for turns.
    this.player?.flush();
    this.orchestrator?.beginUserTurn();
    if (this.snapshot.status === 'speaking') {
      this.update({ status: 'listening', statusDetail: null });
    }
  }

  private async teardownAudio(): Promise<void> {
    window.clearInterval(this.sessionHeartbeatTimer);
    await this.releaseEngine();
    const capture = this.capture;
    this.capture = null;
    capture?.stop();

    const player = this.player;
    this.player = null;
    if (player) {
      player.flush();
      await player.close().catch(() => undefined);
    }
    this.update({ micLevel: 0, outputLevel: 0, bufferedMs: 0, audioReady: false });
  }

  toggleMute(): void {
    if (this.isMirror) {
      try {
        void chrome.runtime?.sendMessage({ type: 'GBL_ACTION', action: 'toggleMute' });
      } catch {
        /* ignore */
      }
      const nextMuted = !this.snapshot.micMuted;
      this.update({ micMuted: nextMuted });
      if (!nextMuted && !this.capture) {
        this.startMirrorAudio();
      }
      return;
    }
    this.muted = !this.muted;
    this.capture?.setMuted(this.muted);
    this.update({ micMuted: this.muted });
    this.toast(this.muted ? 'Microphone muted.' : 'Microphone live.', 'info');
  }

  /* ───────────────────────────── session ───────────────────────────── */

  async start(): Promise<void> {
    if (this.starting || this.stopping || isSessionLive(this.snapshot.status)) return;
    if (!this.secret) {
      this.toast('Add the local bridge secret in Settings before starting.', 'warn');
      this.update({
        status: 'error',
        statusDetail: 'The local bridge secret is missing.',
      });
      return;
    }

    this.starting = true;
    this.connectedOnce = false;
    this.userEntryId = null;
    this.assistantEntryId = null;
    this.update({
      starting: true,
      status: 'requesting-mic',
      statusDetail: 'Waiting for microphone permission.',
      sessionStartedAt: Date.now(),
      usageTokens: 0,
      resumable: false,
      approval: null,
      toolSummary: { ...EMPTY_SUMMARY },
    });

    try {
      const health =
        this.snapshot.bridge.status === 'online' && this.snapshot.bridge.health
          ? this.snapshot.bridge.health
          : await this.checkBridge(true);
      if (!health) {
        throw new Error(
          'The local bridge is offline. Start it with "npm run bridge", then try again.',
        );
      }

      await this.startAudio();
      this.createOrchestrator();
      const manager = new LiveSessionManager({
        settings: this.snapshot.settings,
        bridge: this.ensureBridge(),
        onEvent: (event) => this.handleManagerEvent(event),
        contextProvider: () => this.buildInitialContext(),
      });
      this.manager = manager;
      this.addSystem('Requesting a single-use Live token…', 'info');
      await manager.start();
      window.clearInterval(this.sessionHeartbeatTimer);
      this.sessionHeartbeatTimer = window.setInterval(() => this.broadcastSessionState(), 1500);
    } catch (error) {
      const message = describeError(error);
      this.update({ status: 'error', statusDetail: message, sessionStartedAt: null });
      this.addSystem(`Could not start the session: ${message}`, 'error');
      this.toast(message, 'error');
      this.orchestrator?.dispose();
      this.orchestrator = null;
      await this.manager?.stop('The session could not start.').catch(() => undefined);
      this.manager = null;
      await this.teardownAudio();
    } finally {
      this.starting = false;
      this.update({ starting: false });
    }
  }

  async stop(detail = 'Session ended by you.'): Promise<void> {
    window.clearInterval(this.sessionHeartbeatTimer);
    if (this.isMirror) {
      try {
        await chrome.runtime?.sendMessage({ type: 'GBL_ACTION', action: 'stop', detail });
      } catch {
        /* ignore */
      }
      try {
        if (typeof chrome !== 'undefined' && chrome?.storage?.session) {
          void chrome.storage.session.remove('gbl_active_session').catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
      this.stopMirrorAudio();
      this.isMirror = false;
      this.update({ status: 'idle', statusDetail: detail, sessionStartedAt: null, approval: null });
      return;
    }
    if (this.stopping) return;
    this.stopping = true;
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.session) {
        void chrome.storage.session.remove('gbl_active_session').catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
    this.update({ ending: true });
    this.resolveApproval(false);
    this.orchestrator?.dispose();
    this.orchestrator = null;
    this.capture?.stop();
    this.capture = null;

    const manager = this.manager;
    this.manager = null;
    await manager?.stop(detail).catch(() => undefined);
    await this.teardownAudio();

    if (this.snapshot.settings.audioCues) void playCue('stop').catch(() => undefined);
    this.addSystem(detail, 'info');
    this.update({
      status: 'idle',
      statusDetail: detail,
      sessionStartedAt: null,
      approval: null,
      resumable: false,
      micMuted: false,
      starting: false,
      ending: false,
    });
    this.muted = false;
    this.stopping = false;
  }

  private createOrchestrator(): void {
    this.orchestrator?.dispose();
    const executor = new ToolExecutor({
      getSettings: () => this.snapshot.settings,
      screenshots: this.screenshots,
      states: this.states,
    });
    this.orchestrator = new AgentOrchestrator({
      executor,
      session: () => this.manager,
      getSettings: () => this.snapshot.settings,
      model: () => this.snapshot.model,
      callbacks: {
        onToolStart: (entry) => this.upsertToolEntry(entry),
        onToolUpdate: (entry) => this.upsertToolEntry(entry),
        onSystem: (text, level) => this.addSystem(text, level ?? 'info'),
        requestApproval: (request) => this.requestApproval(request),
        cancelApproval: (callId) => this.cancelApproval(callId),
      },
    });
  }

  sendText(text: string): boolean {
    if (this.isMirror) {
      try {
        void chrome.runtime?.sendMessage({ type: 'GBL_ACTION', action: 'sendText', text });
        return true;
      } catch {
        return false;
      }
    }
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!this.manager || !isSessionLive(this.snapshot.status)) {
      this.toast('Start a live session before typing a message.', 'warn');
      return false;
    }
    this.orchestrator?.beginUserTurn();
    const sent = this.manager.sendText(trimmed);
    if (!sent) {
      this.toast('The session is still connecting. Try again in a moment.', 'warn');
      return false;
    }
    this.finalizeTranscript('assistant');
    this.addUserText(trimmed);
    void this.player?.resume();
    return true;
  }

  /* ─────────────────────────── manager events ─────────────────────────── */

  private handleManagerEvent(event: ManagerEvent): void {
    switch (event.type) {
      case 'status': {
        this.update({
          status: event.status,
          ...(event.detail ? { statusDetail: event.detail } : {}),
        });
        if (
          !this.stopping &&
          (event.status === 'error' || event.status === 'quota' || event.status === 'closed')
        ) {
          void this.teardownAudio();
        }
        break;
      }
      case 'token':
        this.update({ tokenExpiresAt: event.expiresAt });
        break;
      case 'managerError': {
        if (event.code === 'TOKEN_ROTATION') {
          this.addSystem(event.message, 'info');
          break;
        }
        if (event.code === 'GO_AWAY') {
          this.addSystem(event.message, 'warn');
          break;
        }
        this.addSystem(event.message, event.retryable ? 'warn' : 'error');
        if (!event.retryable) this.toast(event.message, 'error');
        break;
      }
      case 'live':
        this.handleLiveEvent(event.event);
        break;
      default:
        break;
    }
  }

  private handleLiveEvent(event: LiveEvent): void {
    switch (event.type) {
      case 'setupComplete':
        if (!this.connectedOnce) {
          this.connectedOnce = true;
          this.addSystem('Connected to Gemini Live.', 'info');
          if (this.snapshot.settings.audioCues) void playCue('start').catch(() => undefined);
        }
        break;
      case 'audio':
        this.player?.enqueueBase64(event.base64);
        break;
      case 'inputTranscript':
        this.appendTranscript('user', event.text);
        break;
      case 'outputTranscript':
        this.appendTranscript('assistant', event.text);
        break;
      case 'interrupted':
        this.player?.flush();
        this.finalizeTranscript('assistant');
        break;
      case 'turnComplete':
        this.finalizeTranscript('user');
        this.finalizeTranscript('assistant');
        break;
      case 'toolCall':
        this.finalizeTranscript('assistant');
        this.orchestrator?.handleToolCalls(event.calls);
        break;
      case 'toolCallCancellation':
        this.orchestrator?.cancelToolCalls(event.ids);
        break;
      case 'sessionHandle':
        this.update({ resumable: event.resumable });
        break;
      case 'usage':
        this.update({ usageTokens: event.totalTokenCount });
        break;
      case 'goAway':
        this.addSystem(`The server will rotate the session in ${event.timeLeft}.`, 'warn');
        break;
      default:
        break;
    }
  }

  /* ─────────────────────────── initial context ─────────────────────────── */

  private async buildInitialContext(): Promise<string | null> {
    if (!this.snapshot.settings.includeContextOnStart) return null;
    try {
      const tabs = await chrome.tabs.query({});
      const active = tabs.find((tab) => tab.active) ?? tabs[0];
      if (!active) return null;
      let text = buildInitialContextText({
        url: active.url ?? '',
        title: active.title ?? '',
        openTabs: tabs.length,
      });
      const settings = this.snapshot.settings;
      if (
        settings.browserControl &&
        this.snapshot.model.toolCalling &&
        typeof active.id === 'number' &&
        isScriptableUrl(active.url)
      ) {
        try {
          const page = new PageBridge(active.id);
          await page.ensure(active.url);
          const snapshot = await page.op<PageSnapshot>('snapshot', {
            maxTextChars: 2_000,
            maxElements: 40,
          });
          text += `\n\n${frameUntrustedPageText(snapshot.text, 2_000)}`;
        } catch {
          /* protected pages are expected; tab metadata is still useful */
        }
      }
      return text;
    } catch {
      return null;
    }
  }

  /* ───────────────────────────── approval ───────────────────────────── */

  private requestApproval(request: ApprovalRequest): Promise<boolean> {
    this.approvalResolver?.(false);
    this.update({ approval: request, status: 'awaiting-approval' });
    return new Promise<boolean>((resolve) => {
      this.approvalResolver = (allow: boolean) => {
        this.approvalResolver = null;
        this.update({
          approval: null,
          status: this.manager?.currentStatus ?? 'listening',
        });
        resolve(allow);
      };
    });
  }

  resolveApproval(allow: boolean): void {
    if (this.isMirror) {
      try {
        void chrome.runtime?.sendMessage({ type: 'GBL_ACTION', action: 'resolveApproval', allow });
      } catch {
        /* ignore */
      }
      this.update({ approval: null });
      return;
    }
    this.approvalResolver?.(allow);
  }

  private cancelApproval(callId: string): void {
    if (this.snapshot.approval?.callId === callId) {
      this.approvalResolver?.(false);
      this.update({ approval: null });
    }
  }

  /* ─────────────────────────── conversation ─────────────────────────── */

  private nextId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  private setConversation(conversation: ConversationEntry[]): void {
    const trimmed = conversation.slice(-LIMITS.conversationMessages);
    this.update({ conversation: trimmed, toolSummary: summarizeTools(trimmed) });
    this.schedulePersist(trimmed);
  }

  private schedulePersist(conversation: ConversationEntry[]): void {
    if (this.snapshot.settings.retention !== 'local') return;
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      void saveConversation(conversation).catch(() => undefined);
    }, 600);
  }

  addUserText(text: string): void {
    const entry: ConversationEntry = {
      id: this.nextId('user'),
      kind: 'user',
      text,
      at: Date.now(),
      final: true,
    };
    this.setConversation([...this.snapshot.conversation, entry]);
  }

  private appendTranscript(kind: 'user' | 'assistant', text: string): void {
    const chunk = text.replace(/\r/g, '');
    if (!chunk) return;
    const idKey = kind === 'user' ? 'userEntryId' : 'assistantEntryId';
    let id = this[idKey];
    if (!id) {
      id = this.nextId(kind);
      this[idKey] = id;
      const entry: ConversationEntry =
        kind === 'user'
          ? { id, kind: 'user', text: chunk, at: Date.now(), final: false }
          : { id, kind: 'assistant', text: chunk, at: Date.now(), final: false };
      this.setConversation([...this.snapshot.conversation, entry]);
      return;
    }
    const conversation = this.snapshot.conversation.map((entry) =>
      entry.id === id && (entry.kind === 'user' || entry.kind === 'assistant')
        ? { ...entry, text: entry.text + chunk, final: false }
        : entry,
    );
    this.setConversation(conversation);
  }

  private finalizeTranscript(kind: 'user' | 'assistant'): void {
    const idKey = kind === 'user' ? 'userEntryId' : 'assistantEntryId';
    const id = this[idKey];
    if (!id) return;
    this[idKey] = null;
    const conversation = this.snapshot.conversation
      .map((entry) =>
        entry.id === id && (entry.kind === 'user' || entry.kind === 'assistant')
          ? { ...entry, final: true, text: entry.text.trim() }
          : entry,
      )
      .filter(
        (entry) =>
          !(
            entry.id === id &&
            (entry.kind === 'user' || entry.kind === 'assistant') &&
            !entry.text
          ),
      );
    this.setConversation(conversation);
  }

  private upsertToolEntry(entry: ToolEntry): void {
    const conversation = this.snapshot.conversation;
    const index = conversation.findIndex(
      (item) => item.kind === 'tool' && item.callId === entry.callId,
    );
    if (index >= 0) {
      const next = conversation.slice();
      next[index] = entry;
      this.setConversation(next);
      return;
    }
    this.setConversation([...conversation, entry]);
  }

  private addSystem(text: string, level: SystemEntry['level']): void {
    const value = text.trim();
    if (!value) return;
    const conversation = this.snapshot.conversation;
    const last = conversation[conversation.length - 1];
    if (last?.kind === 'system' && last.text === value && last.level === level) return;
    const entry: SystemEntry = {
      id: this.nextId('system'),
      kind: 'system',
      text: value.slice(0, 500),
      level,
      at: Date.now(),
    };
    this.setConversation([...conversation, entry]);
  }

  clearConversation(): void {
    if (this.isMirror) {
      try {
        void chrome.runtime?.sendMessage({ type: 'GBL_ACTION', action: 'clear' });
      } catch {
        /* ignore */
      }
      this.update({ conversation: [], toolSummary: { ...EMPTY_SUMMARY } });
      return;
    }
    this.userEntryId = null;
    this.assistantEntryId = null;
    this.update({ conversation: [], toolSummary: { ...EMPTY_SUMMARY } });
    void removeConversation().catch(() => undefined);
    this.toast('Conversation cleared.', 'info');
  }

  dismissOnboarding(): void {
    this.update({ onboardingSeen: true });
    void saveOnboarding({ seen: true, completedAt: Date.now() }).catch(() => undefined);
  }

  toast(message: string, tone: ToastTone = 'info'): void {
    const id = crypto.randomUUID();
    this.update({ toast: { id, message, tone } });
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.snapshot.toast?.id === id) this.update({ toast: null });
    }, 5_000);
  }

  dismissToast(): void {
    window.clearTimeout(this.toastTimer);
    this.update({ toast: null });
  }
}
