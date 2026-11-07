import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HardwareTelemetry } from './types.js';

const execAsync = promisify(exec);

export interface HardwareMonitorOptions {
  mockMode?: boolean;
  sampleIntervalMs?: number;
  mockMetrics?: Partial<HardwareTelemetry>;
}

interface CpuSnapshot {
  idle: number;
  total: number;
}

export class HardwareMonitorService extends EventEmitter {
  private mockMode: boolean;
  private sampleIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshot: CpuSnapshot | null = null;
  private lastMetrics: HardwareTelemetry | null = null;
  private cachedProcessCount: number = 142;
  private lastProcessCountSampleTime: number = 0;
  private mockOverrides: Partial<HardwareTelemetry> = {};

  constructor(options: HardwareMonitorOptions = {}) {
    super();
    this.mockMode = options.mockMode ?? process.platform !== 'win32';
    this.sampleIntervalMs = options.sampleIntervalMs ?? 2000;
    if (options.mockMetrics) {
      this.mockOverrides = { ...options.mockMetrics };
    }
    if (!this.mockMode) {
      this.lastSnapshot = this.takeCpuSnapshot();
    }
  }

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  public setMockMetrics(metrics: Partial<HardwareTelemetry>): void {
    this.mockOverrides = { ...this.mockOverrides, ...metrics };
  }

  public getLastMetrics(): HardwareTelemetry | null {
    return this.lastMetrics;
  }

  /**
   * Starts periodic hardware telemetry sampling
   */
  public start(intervalMs?: number): void {
    if (intervalMs) {
      this.sampleIntervalMs = intervalMs;
    }
    if (this.timer) {
      clearInterval(this.timer);
    }

    // Immediate first sample
    void this.sampleMetrics();

    this.timer = setInterval(() => {
      void this.sampleMetrics();
    }, this.sampleIntervalMs);

    // Unref timer so it doesn't prevent Node process from cleanly exiting
    this.timer.unref();
  }

  /**
   * Stops periodic sampling
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  /**
   * Samples live hardware telemetry from the host OS
   */
  public async sampleMetrics(): Promise<HardwareTelemetry> {
    if (this.mockMode) {
      const totalMem = 16 * 1024 * 1024 * 1024; // 16GB
      const freeMem = 9.8 * 1024 * 1024 * 1024;
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 1000) / 10;

      const metrics: HardwareTelemetry = {
        cpuUsage: this.mockOverrides.cpuUsage ?? 24.5,
        memoryTotal: this.mockOverrides.memoryTotal ?? totalMem,
        memoryFree: this.mockOverrides.memoryFree ?? freeMem,
        memoryUsed: this.mockOverrides.memoryUsed ?? usedMem,
        memoryUsagePercent: this.mockOverrides.memoryUsagePercent ?? memPercent,
        activeProcessCount: this.mockOverrides.activeProcessCount ?? 142,
        uptimeSeconds: this.mockOverrides.uptimeSeconds ?? 18450,
        timestamp: Date.now(),
      };

      this.lastMetrics = metrics;
      this.emit('metrics-updated', metrics);
      return metrics;
    }

    try {
      // 1. Calculate CPU Usage from os.cpus() deltas
      const currentSnapshot = this.takeCpuSnapshot();
      let cpuPercent = 0;

      if (this.lastSnapshot) {
        const idleDelta = currentSnapshot.idle - this.lastSnapshot.idle;
        const totalDelta = currentSnapshot.total - this.lastSnapshot.total;
        if (totalDelta > 0) {
          const usedRatio = (totalDelta - idleDelta) / totalDelta;
          cpuPercent = Math.max(0, Math.min(100, Math.round(usedRatio * 1000) / 10));
        }
      }
      this.lastSnapshot = currentSnapshot;

      // 2. Memory Usage
      const memoryTotal = os.totalmem();
      const memoryFree = os.freemem();
      const memoryUsed = memoryTotal - memoryFree;
      const memoryUsagePercent =
        memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 1000) / 10 : 0;

      // 3. Active Process Count (Throttled sampling to avoid child_process saturation)
      const now = Date.now();
      if (this.lastProcessCountSampleTime === 0) {
        this.lastProcessCountSampleTime = now;
        await this.refreshProcessCount();
      } else if (now - this.lastProcessCountSampleTime > 10000) {
        this.lastProcessCountSampleTime = now;
        void this.refreshProcessCount();
      }

      // 4. Host Uptime
      const uptimeSeconds = Math.round(os.uptime());

      const metrics: HardwareTelemetry = {
        cpuUsage: this.mockOverrides.cpuUsage ?? cpuPercent,
        memoryTotal: this.mockOverrides.memoryTotal ?? memoryTotal,
        memoryFree: this.mockOverrides.memoryFree ?? memoryFree,
        memoryUsed: this.mockOverrides.memoryUsed ?? memoryUsed,
        memoryUsagePercent: this.mockOverrides.memoryUsagePercent ?? memoryUsagePercent,
        activeProcessCount: this.mockOverrides.activeProcessCount ?? this.cachedProcessCount,
        uptimeSeconds: this.mockOverrides.uptimeSeconds ?? uptimeSeconds,
        timestamp: now,
      };

      this.lastMetrics = metrics;
      this.emit('metrics-updated', metrics);
      return metrics;
    } catch (err) {
      this.emit('error', err as Error);
      const fallback: HardwareTelemetry = {
        cpuUsage: 0,
        memoryTotal: os.totalmem(),
        memoryFree: os.freemem(),
        memoryUsed: os.totalmem() - os.freemem(),
        memoryUsagePercent: 0,
        activeProcessCount: this.cachedProcessCount,
        uptimeSeconds: Math.round(os.uptime()),
        timestamp: Date.now(),
      };
      this.lastMetrics = fallback;
      return fallback;
    }
  }

  private takeCpuSnapshot(): CpuSnapshot {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const key in cpu.times) {
        total += (cpu.times as Record<string, number>)[key] || 0;
      }
      idle += cpu.times.idle;
    }

    return { idle, total };
  }

  private async refreshProcessCount(): Promise<void> {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('tasklist /fo csv /nh', { timeout: 3000 });
        if (stdout) {
          const lines = stdout
            .trim()
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0);
          if (lines.length > 0) {
            this.cachedProcessCount = lines.length;
          }
        }
      } catch {
        // Fallback to default count
      }
    }
  }
}
