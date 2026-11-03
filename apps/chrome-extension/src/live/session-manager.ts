/**
 * Owns the lifecycle of a Live conversation:
 *   mint ephemeral token → connect → setup → audio/tool traffic → reconnect.
 *
 * Ephemeral tokens are single-use, so every reconnect mints a fresh token and
 * reuses the resumption handle when the server provided one.
 */
import {
  getModel,
  type AppSettings,
  type LiveFunctionResponse,
  type LiveStatus,
} from '@gbl/shared';
import { type BridgeClient, BridgeError } from './bridge.js';
import { LiveSession, type LiveEvent, type LiveSessionOptions } from './client.js';
import { buildLiveSetup } from './setup.js';

export type ManagerEvent =
  | { type: 'status'; status: LiveStatus; detail?: string }
  | { type: 'live'; event: LiveEvent }
  | { type: 'managerError'; message: string; retryable: boolean; code?: string }
  | { type: 'token'; expiresAt: string; newSessionExpiresAt: string };

export interface SessionManagerOptions {
  settings: AppSettings;
  bridge: BridgeClient;
  onEvent: (event: ManagerEvent) => void;
  /** Called after setupComplete on a fresh (non-resumed) session. */
  contextProvider?: () => Promise<string | null>;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

export class LiveSessionManager {
  private session: LiveSession | null = null;
  private settings: AppSettings;
  private readonly bridge: BridgeClient;
  private readonly onEvent: (event: ManagerEvent) => void;
  private readonly contextProvider?: () => Promise<string | null>;
  private resumeHandle: string | null = null;
  private userStopped = false;
  private connecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer = 0;
  private rotationTimer = 0;
  private rotating = false;
  private contextSent = false;
  private status: LiveStatus = 'idle';
  private sessionTokenExpiresAt: string | null = null;

  constructor(options: SessionManagerOptions) {
    this.settings = options.settings;
    this.bridge = options.bridge;
    this.onEvent = options.onEvent;
    this.contextProvider = options.contextProvider;
  }

  get currentStatus(): LiveStatus {
    return this.status;
  }

  get isActive(): boolean {
    return this.status !== 'idle' && this.status !== 'closed' && this.status !== 'error';
  }

  get tokenExpiresAt(): string | null {
    return this.sessionTokenExpiresAt;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings;
  }

  private setStatus(status: LiveStatus, detail?: string): void {
    this.status = status;
    this.onEvent({ type: 'status', status, ...(detail ? { detail } : {}) });
  }

  async start(): Promise<void> {
    if (this.connecting || this.session?.isOpen) return;
    this.userStopped = false;
    this.reconnectAttempts = 0;
    this.contextSent = false;
    this.resumeHandle = null;
    await this.connect(false);
  }

  async stop(detail = 'Stopped by the user.'): Promise<void> {
    this.userStopped = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.rotationTimer);
    this.reconnectTimer = 0;
    this.rotationTimer = 0;
    this.rotating = false;
    const session = this.session;
    this.session = null;
    session?.close(detail);
    this.setStatus('closed', detail);
  }

  /**
   * Ephemeral tokens have a hard expiry. Rotate a little before it so a long
   * conversation continues seamlessly instead of dying mid-sentence.
   */
  private scheduleRotation(expiresAt: string): void {
    window.clearTimeout(this.rotationTimer);
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) return;
    const delay = expiry - Date.now() - 60_000;
    if (delay < 10_000) return;
    this.rotationTimer = window.setTimeout(() => {
      if (this.userStopped || !this.session?.isOpen) return;
      this.rotating = true;
      this.onEvent({
        type: 'managerError',
        message: 'Refreshing the Live token before it expires.',
        retryable: true,
        code: 'TOKEN_ROTATION',
      });
      this.session?.close('Refreshing the session token.');
      this.session = null;
    }, delay);
  }

  private scheduleReconnect(delayMs: number): void {
    window.clearTimeout(this.reconnectTimer);
    if (this.userStopped) return;
    this.setStatus('reconnecting');
    this.reconnectTimer = window.setTimeout(() => {
      void this.connect(true);
    }, delayMs);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    if (this.connecting || this.userStopped) return;
    this.connecting = true;
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');

    try {
      const model = getModel(this.settings.modelId);
      const token = await this.bridge.token(model.id);
      this.sessionTokenExpiresAt = token.expiresAt;
      this.onEvent({
        type: 'token',
        expiresAt: token.expiresAt,
        newSessionExpiresAt: token.newSessionExpiresAt,
      });
      this.scheduleRotation(token.expiresAt);
      if (this.userStopped) {
        this.connecting = false;
        return;
      }

      const setup = buildLiveSetup({
        settings: this.settings,
        modelId: model.id,
        resumeHandle: this.resumeHandle,
      });

      const options: LiveSessionOptions = {
        token: token.token,
        setup,
        supportsScheduling: model.supportsScheduling,
        onEvent: (event) => this.handleLiveEvent(event),
      };
      const session = new LiveSession(options);
      this.session = session;
      session.connect();
    } catch (error) {
      this.connecting = false;
      if (error instanceof BridgeError) {
        const retryable =
          error.code === 'network_error' ||
          error.code === 'timeout' ||
          error.code === 'upstream_error';
        if (error.code === 'rate_limited') {
          this.setStatus('quota', error.message);
        } else if (error.code === 'unauthorized' || error.code === 'not_configured') {
          this.setStatus('error', error.message);
        } else {
          this.setStatus('error', error.message);
        }
        this.onEvent({
          type: 'managerError',
          message: error.message,
          retryable,
          code: error.code,
        });
        if (retryable && this.settings.autoReconnect && !this.userStopped) {
          this.reconnectAttempts += 1;
          if (this.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            this.scheduleReconnect(BACKOFF_MS[this.reconnectAttempts - 1] ?? 15_000);
          }
        }
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      this.onEvent({ type: 'managerError', message, retryable: true });
    }
  }

  private handleLiveEvent(event: LiveEvent): void {
    switch (event.type) {
      case 'open':
        break;
      case 'setupComplete': {
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.setStatus('listening');
        if (!this.contextSent && !this.resumeHandle && this.contextProvider) {
          this.contextSent = true;
          void this.contextProvider()
            .then((text) => {
              if (text) this.session?.sendContext(text);
            })
            .catch(() => undefined);
        }
        break;
      }
      case 'audio':
        // Audio arrives in ~30 ms chunks. Emitting a status event for every
        // chunk would re-render the panel dozens of times per second.
        if (this.status !== 'speaking') this.setStatus('speaking');
        break;
      case 'inputTranscript':
        break;
      case 'outputTranscript':
        break;
      case 'interrupted':
        this.setStatus('listening');
        break;
      case 'turnComplete':
        this.setStatus('listening');
        break;
      case 'toolCall':
        this.setStatus('acting');
        break;
      case 'sessionHandle':
        if (event.resumable) this.resumeHandle = event.handle;
        break;
      case 'goAway': {
        const seconds = Number.parseFloat(event.timeLeft.replace(/[^\d.]/g, ''));
        const delay = Number.isFinite(seconds) ? Math.max(0, seconds - 3) * 1_000 : 1_000;
        if (!this.userStopped) {
          this.onEvent({
            type: 'managerError',
            message: 'The Live session is rotating; reconnecting automatically.',
            retryable: true,
            code: 'GO_AWAY',
          });
          this.session?.close('Server requested session rotation.');
          this.session = null;
          this.scheduleReconnect(delay);
        }
        break;
      }
      case 'interactionStatus':
        if (event.status === 'IN_PROGRESS') this.setStatus('thinking');
        else if (this.status === 'thinking') this.setStatus('listening');
        break;
      case 'error':
        this.onEvent({
          type: 'managerError',
          message: event.message,
          retryable: !LiveSession.isTerminalClose(0, event.message),
          ...(event.code !== undefined ? { code: String(event.code) } : {}),
        });
        break;
      case 'close': {
        this.connecting = false;
        this.session = null;
        if (this.rotating && !this.userStopped) {
          this.rotating = false;
          this.reconnectAttempts = 0;
          this.scheduleReconnect(250);
          break;
        }
        if (this.userStopped) {
          this.setStatus('closed');
          return;
        }
        const description = LiveSession.describeClose(event.code, event.reason);
        if (LiveSession.isTerminalClose(event.code, event.reason)) {
          const quota = event.code === 4290 || /quota|rate limit/i.test(event.reason);
          this.setStatus(quota ? 'quota' : 'error', description);
          this.onEvent({
            type: 'managerError',
            message: description,
            retryable: false,
            code: String(event.code),
          });
          return;
        }
        if (this.settings.autoReconnect && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = BACKOFF_MS[this.reconnectAttempts] ?? 15_000;
          this.reconnectAttempts += 1;
          this.onEvent({
            type: 'managerError',
            message: `${description} Reconnecting…`,
            retryable: true,
            code: String(event.code),
          });
          this.scheduleReconnect(delay);
        } else {
          this.setStatus('closed', description);
          this.onEvent({ type: 'managerError', message: description, retryable: false });
        }
        break;
      }
      default:
        break;
    }
    this.onEvent({ type: 'live', event });
  }

  sendAudio(base64: string): boolean {
    return this.session?.sendAudio(base64) ?? false;
  }

  sendText(text: string): boolean {
    return this.session?.sendText(text) ?? false;
  }

  sendImage(base64Jpeg: string, prompt: string): boolean {
    return this.session?.sendImage(base64Jpeg, prompt) ?? false;
  }

  sendToolResponses(responses: LiveFunctionResponse[]): boolean {
    return this.session?.sendToolResponses(responses) ?? false;
  }
}
