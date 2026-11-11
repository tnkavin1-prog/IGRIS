import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface NativeBridgeTransport {
  request(action: string, args?: string[], timeoutMs?: number): Promise<string>;
  dispose(): void;
}

export class NativeBridgeError extends Error {
  public readonly retrySafe: boolean;

  constructor(message: string, retrySafe = false) {
    super(message);
    this.name = 'NativeBridgeError';
    this.retrySafe = retrySafe;
  }
}

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface BridgeResponse {
  id?: string;
  ok?: boolean;
  result?: string;
  error?: string;
  ready?: boolean;
}

export class NativeBridgeClient implements NativeBridgeTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private buffer = '';
  private ready = false;

  constructor(private readonly executablePath: string) {}

  public async request(action: string, args: string[] = [], timeoutMs = 8000): Promise<string> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !this.ready) {
      throw new NativeBridgeError('Native input service is not ready.', true);
    }

    const id = String(++this.sequence);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new NativeBridgeError(
            `Native action "${action}" timed out; its outcome is unknown and it was not retried.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const payload = `${JSON.stringify({ id, action, args })}\n`;
      child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        request.reject(
          new NativeBridgeError(
            `Native action "${action}" could not be confirmed and was not retried: ${error.message}`,
          ),
        );
      });
    });
  }

  public dispose(): void {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (child) {
      child.stdin.end();
      child.kill();
    }
    this.rejectPending(new NativeBridgeError('Native input service was disposed.'));
  }

  private ensureStarted(): Promise<void> {
    if (this.child && this.ready) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startProcess().finally(() => {
      if (!this.ready) this.startPromise = null;
    });
    return this.startPromise;
  }

  private startProcess(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.executablePath, ['serve'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        reject(new NativeBridgeError((error as Error).message, true));
        return;
      }
      this.child = child;

      const startupTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new NativeBridgeError('Native input service startup timed out.', true));
      }, 5000);

      child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line) this.handleLine(line);
          newline = this.buffer.indexOf('\n');
        }
      });

      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(new NativeBridgeError(error.message, true));
        }
        this.handleExit(new NativeBridgeError(error.message));
      });

      child.once('close', (code) => {
        const error = new NativeBridgeError(`Native input service exited with code ${code}.`);
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(new NativeBridgeError(error.message, true));
        }
        this.handleExit(error);
      });

      this.readyResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        this.ready = true;
        resolve();
      };
    });
  }

  private readyResolve: (() => void) | null = null;

  private handleLine(line: string): void {
    let message: BridgeResponse;
    try {
      message = JSON.parse(line) as BridgeResponse;
    } catch {
      return;
    }
    if (message.ready) {
      this.readyResolve?.();
      return;
    }
    if (!message.id) return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result ?? '');
    else request.reject(new NativeBridgeError(message.error || 'Native action failed.'));
  }

  private handleExit(error: NativeBridgeError): void {
    this.child = null;
    this.ready = false;
    this.readyResolve = null;
    this.startPromise = null;
    this.buffer = '';
    this.rejectPending(error);
  }

  private rejectPending(error: NativeBridgeError): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
