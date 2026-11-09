import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContinuousSupervisor } from '../../../apps/desktop-hud/src/main/continuous-supervisor.js';

describe('ContinuousSupervisor', () => {
  let supervisor: ContinuousSupervisor;

  beforeEach(() => {
    supervisor = new ContinuousSupervisor({ mockMode: true, heartbeatIntervalMs: 50 });
  });

  afterEach(() => {
    supervisor.stop();
  });

  it('initializes with default supervisor state targeting E: drive', () => {
    const state = supervisor.getState();
    expect(state.version).toBe('1.0.0');
    expect(state.storage.targetDrive).toBe('E:');
    expect(state.subsystems.opencode).toBeDefined();
    expect(state.subsystems.chrome_cdp).toBeDefined();
    expect(state.subsystems.control_server).toBeDefined();
  });

  it('runs heartbeat and updates lastHeartbeat timestamp', async () => {
    const initial = supervisor.getState().lastHeartbeat;
    await new Promise((r) => setTimeout(r, 10));
    const updated = await supervisor.heartbeat();
    expect(updated.lastHeartbeat).toBeGreaterThanOrEqual(initial);
  });

  it('emits heartbeat event on timer trigger', async () => {
    const spy = vi.fn();
    supervisor.on('heartbeat', spy);
    supervisor.start();
    await new Promise((r) => setTimeout(r, 120));
    supervisor.stop();
    expect(spy).toHaveBeenCalled();
  });

  it('checks subsystems in mock mode and reports healthy', async () => {
    const subsystems = await supervisor.checkSubsystems();
    expect(subsystems.opencode.healthy).toBe(true);
    expect(subsystems.chrome_cdp.healthy).toBe(true);
    expect(subsystems.control_server.healthy).toBe(true);
  });
});
