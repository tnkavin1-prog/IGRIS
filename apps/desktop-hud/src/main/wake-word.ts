import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { SCRIPTS_DIR } from './runtime-paths.js';

export class WakeWordService extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private enabled = false;
  private paused = false;
  private transitions: Promise<void> = Promise.resolve();

  public setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    return this.reconcile();
  }

  public setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    return this.reconcile();
  }

  public dispose(): Promise<void> {
    return this.setEnabled(false);
  }

  private reconcile(): Promise<void> {
    this.transitions = this.transitions.then(async () => {
      if (!this.enabled || this.paused) {
        await this.stop();
      } else if (!this.child) {
        this.start();
      }
    });
    return this.transitions;
  }

  private start(): void {
    if (process.platform !== 'win32') {
      this.emit('unavailable', 'Offline wake word requires Windows.');
      return;
    }
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(SCRIPTS_DIR, 'wake-word.ps1'),
      ],
      { windowsHide: true, stdio: 'pipe' },
    );
    this.child = child;
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop()!;
      for (const line of lines) {
        if (line === 'ready') this.emit('ready');
        if (line === 'wake' && this.enabled && !this.paused && this.child === child)
          this.emit('wake');
      }
    });
    child.stderr.on('data', () =>
      this.emit(
        'unavailable',
        'Windows speech recognition could not start. Check the English speech pack and microphone.',
      ),
    );
    child.on('error', () => {
      if (this.child === child) this.child = null;
      this.emit('unavailable', 'The offline wake-word helper could not start.');
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    child.stdin.on('error', () => undefined);
  }

  private async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end('stop\n');
    });
    if (this.child === child) this.child = null;
  }
}
