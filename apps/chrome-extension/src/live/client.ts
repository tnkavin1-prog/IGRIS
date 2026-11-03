/**
 * Gemini Live WebSocket client.
 *
 * One instance == one socket == one ephemeral token. The session manager owns
 * reconnection because tokens are single-use; a reconnect must mint a new one.
 */
import {
  LIVE_WS_CONSTRAINED,
  type FunctionResponseScheduling,
  type LiveClientMessage,
  type LiveFunctionCall,
  type LiveFunctionResponse,
  type LiveServerMessage,
  type LiveSetup,
} from '@gbl/shared';

export type LiveEvent =
  | { type: 'open' }
  | { type: 'setupComplete' }
  | { type: 'audio'; base64: string; mimeType: string }
  | { type: 'inputTranscript'; text: string }
  | { type: 'outputTranscript'; text: string }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'generationComplete' }
  | { type: 'toolCall'; calls: LiveFunctionCall[] }
  | { type: 'toolCallCancellation'; ids: string[] }
  | { type: 'sessionHandle'; handle: string; resumable: boolean }
  | { type: 'goAway'; timeLeft: string }
  | { type: 'interactionStatus'; status: 'IN_PROGRESS' | 'IDLE' }
  | { type: 'usage'; totalTokenCount: number }
  | { type: 'error'; message: string; code?: number }
  | { type: 'close'; code: number; reason: string; wasClean: boolean };

export interface LiveSessionOptions {
  token: string;
  setup: LiveSetup;
  supportsScheduling: boolean;
  onEvent: (event: LiveEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class LiveSession {
  private socket: WebSocket | null = null;
  private open = false;
  private closed = false;
  private messageChain: Promise<void> = Promise.resolve();
  private lastError: string | null = null;

  constructor(private readonly options: LiveSessionOptions) {}

  get isOpen(): boolean {
    return this.open && this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.socket) return;
    const url = `${LIVE_WS_CONSTRAINED}?access_token=${encodeURIComponent(this.options.token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.open = true;
      this.send({ setup: this.options.setup });
      this.options.onEvent({ type: 'open' });
    };

    socket.onmessage = (event) => {
      this.messageChain = this.messageChain
        .then(() => this.handleMessage(event.data))
        .catch((error) => {
          this.options.onEvent({
            type: 'error',
            message: `Could not process a Live message: ${(error as Error).message}`,
          });
        });
    };

    socket.onerror = () => {
      // The close event that follows carries the useful code/reason.
      this.lastError = 'The Live connection reported a network error.';
    };

    socket.onclose = (event) => {
      this.open = false;
      this.closed = true;
      this.socket = null;
      this.options.onEvent({
        type: 'close',
        code: event.code,
        reason: event.reason || this.lastError || '',
        wasClean: event.wasClean,
      });
    };
  }

  private async handleMessage(data: unknown): Promise<void> {
    let text: string;
    if (typeof data === 'string') text = data;
    else if (data instanceof Blob) text = await data.text();
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else return;

    let message: LiveServerMessage;
    try {
      message = JSON.parse(text) as LiveServerMessage;
    } catch {
      this.options.onEvent({ type: 'error', message: 'The Live server sent malformed JSON.' });
      return;
    }

    if (message.error) {
      const detail = message.error.message ?? 'The Live server reported an error.';
      this.lastError = detail;
      this.options.onEvent({
        type: 'error',
        message: detail,
        ...(message.error.code !== undefined ? { code: message.error.code } : {}),
      });
      return;
    }

    if (message.setupComplete) {
      this.options.onEvent({ type: 'setupComplete' });
    }

    const content = message.serverContent;
    if (content) {
      if (content.interrupted) this.options.onEvent({ type: 'interrupted' });
      if (content.inputTranscription?.text) {
        this.options.onEvent({ type: 'inputTranscript', text: content.inputTranscription.text });
      }
      if (content.outputTranscription?.text) {
        this.options.onEvent({ type: 'outputTranscript', text: content.outputTranscription.text });
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          this.options.onEvent({
            type: 'audio',
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        }
      }
      if (content.turnComplete) this.options.onEvent({ type: 'turnComplete' });
      if (content.generationComplete) this.options.onEvent({ type: 'generationComplete' });
    }

    if (message.toolCall?.functionCalls?.length) {
      this.options.onEvent({ type: 'toolCall', calls: message.toolCall.functionCalls });
    }
    if (message.toolCallCancellation?.ids?.length) {
      this.options.onEvent({ type: 'toolCallCancellation', ids: message.toolCallCancellation.ids });
    }
    if (message.sessionResumptionUpdate) {
      const update = message.sessionResumptionUpdate;
      if (update.newHandle) {
        this.options.onEvent({
          type: 'sessionHandle',
          handle: update.newHandle,
          resumable: Boolean(update.resumable),
        });
      }
    }
    if (message.goAway?.timeLeft) {
      this.options.onEvent({ type: 'goAway', timeLeft: message.goAway.timeLeft });
    }
    if (message.interactionStatus) {
      this.options.onEvent({ type: 'interactionStatus', status: message.interactionStatus });
    }
    if (message.usageMetadata?.totalTokenCount !== undefined) {
      this.options.onEvent({
        type: 'usage',
        totalTokenCount: message.usageMetadata.totalTokenCount,
      });
    }
  }

  private send(message: LiveClientMessage): boolean {
    if (!this.isOpen) return false;
    try {
      this.socket?.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  sendAudio(base64: string): boolean {
    if (!base64) return false;
    return this.send({
      realtimeInput: {
        audio: { data: base64, mimeType: 'audio/pcm;rate=16000' },
      },
    });
  }

  sendText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return this.send({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: trimmed }] }],
        turnComplete: true,
      },
    });
  }

  /**
   * Send page context without ending the turn. `turnComplete: false` tells the
   * model "this is background material"; it must not answer the context as if
   * the user had just spoken, and the next real user turn remains intact.
   */
  sendContext(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return this.send({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: trimmed }] }],
        turnComplete: false,
      },
    });
  }

  sendImage(base64Jpeg: string, prompt: string): boolean {
    return this.send({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { data: base64Jpeg, mimeType: 'image/jpeg' } }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  sendToolResponses(responses: LiveFunctionResponse[]): boolean {
    if (responses.length === 0) return false;
    const scheduled: LiveFunctionResponse[] = responses.map((response) => ({
      ...response,
      response: {
        ...response.response,
        ...(this.options.supportsScheduling
          ? { scheduling: 'WHEN_IDLE' as FunctionResponseScheduling }
          : {}),
      },
    }));
    return this.send({ toolResponse: { functionResponses: scheduled } });
  }

  close(reason = 'Client closed the session.'): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    try {
      this.socket?.close(1000, reason.slice(0, 120));
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  /** True for close codes/messages that should not be retried automatically. */
  static isTerminalClose(code: number, reason: string): boolean {
    if (code === 1007 || code === 4003) return true;
    if (code === 4290) return true;
    if (/quota|rate limit|permission denied|api key|unauthorized|invalid.*token/i.test(reason)) {
      return true;
    }
    return false;
  }

  static describeClose(code: number, reason: string): string {
    if (reason) return reason;
    switch (code) {
      case 1000:
        return 'The session closed normally.';
      case 1006:
        return 'The network connection dropped.';
      case 1007:
        return 'The Live server rejected the session configuration.';
      case 1011:
        return 'The Live server reported an internal error.';
      case 4000:
        return 'The Live connection timed out.';
      case 4001:
        return 'The Live setup handshake did not complete.';
      case 4003:
        return 'The ephemeral token was rejected.';
      case 4290:
        return 'Gemini rate limit or quota reached.';
      default:
        return `The Live session closed (code ${code}).`;
    }
  }
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
