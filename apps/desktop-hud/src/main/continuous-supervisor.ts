import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export interface SubsystemHealth {
  name: string;
  healthy: boolean;
  endpoint?: string;
  latencyMs?: number;
  lastChecked: number;
  error?: string;
}

export interface SupervisorState {
  version: string;
  startedAt: number;
  lastHeartbeat: number;
  uptimeSeconds: number;
  subsystems: Record<string, SubsystemHealth>;
  storage: {
    targetDrive: 'E:';
    projectPath: string;
    writable: boolean;
  };
  metrics: {
    cpuPercent: number;
    memoryPercent: number;
  };
  taskQueue: {
    activeTaskCount: number;
    completedTaskCount: number;
  };
}

export interface ContinuousSupervisorOptions {
  mockMode?: boolean;
  stateFilePath?: string;
  heartbeatIntervalMs?: number;
}

export class ContinuousSupervisor extends EventEmitter {
  private mockMode: boolean;
  private stateFilePath: string;
  private heartbeatIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private state: SupervisorState;

  constructor(options: ContinuousSupervisorOptions = {}) {
    super();
    this.mockMode = Boolean(options.mockMode);
    this.stateFilePath = options.stateFilePath || 'E:\\Gematron\\logs\\supervisor-state.json';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 5000;

    this.state = {
      version: '1.0.0',
      startedAt: this.startedAt,
      lastHeartbeat: Date.now(),
      uptimeSeconds: 0,
      subsystems: {
        opencode: { name: 'OpenCode Daemon', healthy: true, endpoint: 'http://127.0.0.1:4096', lastChecked: Date.now() },
        chrome_cdp: { name: 'Chrome CDP', healthy: true, endpoint: 'http://127.0.0.1:9222', lastChecked: Date.now() },
        control_server: { name: 'Control Server', healthy: true, endpoint: 'http://127.0.0.1:9228', lastChecked: Date.now() },
      },
      storage: {
        targetDrive: 'E:',
        projectPath: 'E:\\Gematron',
        writable: true,
      },
      metrics: {
        cpuPercent: 12,
        memoryPercent: 35,
      },
      taskQueue: {
        activeTaskCount: 0,
        completedTaskCount: 0,
      },
    };
  }

  public getState(): SupervisorState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public async checkSubsystems(): Promise<Record<string, SubsystemHealth>> {
    const now = Date.now();
    if (this.mockMode) {
      for (const sub of Object.values(this.state.subsystems)) {
        if (sub) {
          sub.lastChecked = now;
          sub.healthy = true;
        }
      }
      return this.state.subsystems;
    }

    // Live checks using fetch
    for (const [, sub] of Object.entries(this.state.subsystems)) {
      if (!sub || !sub.endpoint) continue;
      const start = Date.now();
      try {
        const res = await fetch(sub.endpoint, { signal: AbortSignal.timeout(1200) });
        sub.healthy = res.ok || res.status < 500;
        sub.latencyMs = Date.now() - start;
        sub.error = undefined;
      } catch (err) {
        sub.healthy = false;
        sub.latencyMs = undefined;
        sub.error = (err as Error).message;
      }
      sub.lastChecked = Date.now();
    }

    return this.state.subsystems;
  }

  public async heartbeat(): Promise<SupervisorState> {
    const now = Date.now();
    this.state.lastHeartbeat = now;
    this.state.uptimeSeconds = Math.round((now - this.startedAt) / 1000);

    await this.checkSubsystems();
    this.saveState();
    this.emit('heartbeat', this.getState());
    return this.getState();
  }

  public saveState(): void {
    if (this.mockMode) return;
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
      this.emit('state-saved', this.stateFilePath);
    } catch (err) {
      this.emit('error', err);
    }
  }

  public loadState(): boolean {
    if (this.mockMode || !fs.existsSync(this.stateFilePath)) return false;
    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      const loaded = JSON.parse(raw) as SupervisorState;
      if (loaded && loaded.version) {
        this.state = {
          ...loaded,
          lastHeartbeat: Date.now(),
        };
        return true;
      }
    } catch {
      /* ignore load errors */
    }
    return false;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const continuousSupervisor = new ContinuousSupervisor();
