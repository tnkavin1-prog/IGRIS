import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HardwareMonitorService } from '../../../apps/desktop-hud/src/main/hardware-monitor.js';
import type { HardwareTelemetry } from '../../../apps/desktop-hud/src/main/types.js';

describe('HardwareMonitorService', () => {
  let monitor: HardwareMonitorService;

  beforeEach(() => {
    monitor = new HardwareMonitorService({ mockMode: true });
  });

  afterEach(() => {
    monitor.dispose();
  });

  it('samples valid hardware telemetry in mock mode', async () => {
    const metrics = await monitor.sampleMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
    expect(metrics.cpuUsage).toBeLessThanOrEqual(100);
    expect(metrics.memoryTotal).toBeGreaterThan(0);
    expect(metrics.memoryFree).toBeGreaterThan(0);
    expect(metrics.memoryUsed).toBeGreaterThan(0);
    expect(metrics.memoryUsagePercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memoryUsagePercent).toBeLessThanOrEqual(100);
    expect(metrics.activeProcessCount).toBeGreaterThan(0);
    expect(metrics.uptimeSeconds).toBeGreaterThan(0);
    expect(metrics.timestamp).toBeGreaterThan(0);
  });

  it('allows overriding mock metrics for deterministic testing', async () => {
    monitor.setMockMetrics({
      cpuUsage: 88.5,
      memoryUsagePercent: 64.2,
      activeProcessCount: 210,
    });

    const metrics = await monitor.sampleMetrics();
    expect(metrics.cpuUsage).toBe(88.5);
    expect(metrics.memoryUsagePercent).toBe(64.2);
    expect(metrics.activeProcessCount).toBe(210);
  });

  it('stores and retrieves last metrics via getLastMetrics', async () => {
    expect(monitor.getLastMetrics()).toBeNull();
    const sampled = await monitor.sampleMetrics();
    expect(monitor.getLastMetrics()).toEqual(sampled);
  });

  it('emits metrics-updated events on sampleMetrics and periodic interval', async () => {
    const received: HardwareTelemetry[] = [];
    monitor.on('metrics-updated', (m) => {
      received.push(m);
    });

    await monitor.sampleMetrics();
    expect(received.length).toBe(1);
    expect(received[0]?.cpuUsage).toBeDefined();
  });

  it('starts and stops background periodic sampling loop', async () => {
    vi.useFakeTimers();
    const periodicMonitor = new HardwareMonitorService({
      mockMode: true,
      sampleIntervalMs: 500,
    });

    let tickCount = 0;
    periodicMonitor.on('metrics-updated', () => {
      tickCount++;
    });

    periodicMonitor.start();
    // 1 immediate sample on start
    expect(tickCount).toBe(1);

    vi.advanceTimersByTime(1100);
    expect(tickCount).toBe(3); // 1 + 2 interval ticks

    periodicMonitor.stop();
    vi.advanceTimersByTime(1000);
    expect(tickCount).toBe(3); // stopped, no further ticks

    periodicMonitor.dispose();
    vi.useRealTimers();
  });

  it('samples live hardware telemetry in non-mock mode without throwing', async () => {
    const liveMonitor = new HardwareMonitorService({ mockMode: false });
    try {
      const metrics = await liveMonitor.sampleMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.cpuUsage).toBe('number');
      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.cpuUsage).toBeLessThanOrEqual(100);
      expect(metrics.memoryTotal).toBeGreaterThan(0);
      expect(metrics.memoryFree).toBeGreaterThan(0);
      expect(metrics.memoryUsed).toBe(metrics.memoryTotal - metrics.memoryFree);
      expect(metrics.activeProcessCount).toBeGreaterThan(0);
      expect(metrics.uptimeSeconds).toBeGreaterThan(0);

      // Verify second sample computes delta CPU usage cleanly
      await new Promise((r) => setTimeout(r, 60));
      const secondMetrics = await liveMonitor.sampleMetrics();
      expect(secondMetrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(secondMetrics.cpuUsage).toBeLessThanOrEqual(100);
      expect(secondMetrics.activeProcessCount).toBeGreaterThan(0);
    } finally {
      liveMonitor.dispose();
    }
  });

  it('handles rapid consecutive sampleMetrics calls safely', async () => {
    const promises = [monitor.sampleMetrics(), monitor.sampleMetrics(), monitor.sampleMetrics()];
    const results = await Promise.all(promises);
    expect(results).toHaveLength(3);
    for (const res of results) {
      expect(res.memoryTotal).toBeGreaterThan(0);
    }
  });

  it('allows switching mockMode dynamically', async () => {
    monitor.setMockMode(false);
    const liveMetrics = await monitor.sampleMetrics();
    expect(liveMetrics.memoryTotal).toBeGreaterThan(0);

    monitor.setMockMode(true);
    monitor.setMockMetrics({ cpuUsage: 12.3 });
    const mockMetrics = await monitor.sampleMetrics();
    expect(mockMetrics.cpuUsage).toBe(12.3);
  });
});
