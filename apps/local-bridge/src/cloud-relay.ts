import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface WebhookEventPayload {
  id: string;
  type: 'task:completed' | 'task:failed' | 'emergency:stop' | 'supervisor:heartbeat';
  timestamp: number;
  data: Record<string, unknown>;
  signature?: string;
}

export interface CloudRelayOptions {
  mockMode?: boolean;
  webhookUrl?: string;
  signingSecret?: string;
  bufferFilePath?: string;
}

export class CloudSupervisorRelay extends EventEmitter {
  private mockMode: boolean;
  private webhookUrl?: string;
  private signingSecret: string;
  private bufferFilePath: string;
  private queue: WebhookEventPayload[] = [];

  constructor(options: CloudRelayOptions = {}) {
    super();
    this.mockMode = Boolean(options.mockMode);
    this.webhookUrl = options.webhookUrl;
    this.signingSecret = options.signingSecret || 'gematron-secret-key-128bit';
    this.bufferFilePath = options.bufferFilePath || 'E:\\Gematron\\logs\\relay-buffer.jsonl';
  }

  public signPayload(payload: Omit<WebhookEventPayload, 'signature'>): string {
    const hmac = crypto.createHmac('sha256', this.signingSecret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  public verifySignature(payload: WebhookEventPayload): boolean {
    if (!payload.signature) return false;
    const { signature, ...rest } = payload;
    const expected = this.signPayload(rest);
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  }

  public async dispatchEvent(
    type: WebhookEventPayload['type'],
    data: Record<string, unknown> = {}
  ): Promise<{ success: boolean; eventId: string; buffered: boolean }> {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const unsigned: Omit<WebhookEventPayload, 'signature'> = {
      id: eventId,
      type,
      timestamp: Date.now(),
      data,
    };
    const signature = this.signPayload(unsigned);
    const event: WebhookEventPayload = { ...unsigned, signature };

    this.emit('event:created', event);

    if (this.mockMode || !this.webhookUrl) {
      this.queue.push(event);
      this.emit('event:dispatched', { event, mock: true });
      return { success: true, eventId, buffered: false };
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gematron-Signature': signature,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      this.emit('event:dispatched', { event, mock: false });
      return { success: true, eventId, buffered: false };
    } catch (err) {
      this.bufferEvent(event);
      this.emit('event:buffered', { event, error: (err as Error).message });
      return { success: false, eventId, buffered: true };
    }
  }

  private bufferEvent(event: WebhookEventPayload): void {
    this.queue.push(event);
    try {
      const dir = path.dirname(this.bufferFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.bufferFilePath, JSON.stringify(event) + '\n', 'utf8');
    } catch {
      /* ignore write errors */
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public clearQueue(): void {
    this.queue = [];
  }
}

export const cloudRelay = new CloudSupervisorRelay();