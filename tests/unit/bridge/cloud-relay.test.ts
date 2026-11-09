import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CloudSupervisorRelay } from '../../../apps/local-bridge/src/cloud-relay.js';

describe('CloudSupervisorRelay', () => {
  let relay: CloudSupervisorRelay;

  beforeEach(() => {
    relay = new CloudSupervisorRelay({ mockMode: true, signingSecret: 'test-secret-12345' });
  });

  it('signs and verifies webhook payload with HMAC-SHA256', () => {
    const raw = {
      id: 'evt_1',
      type: 'task:completed' as const,
      timestamp: 1000,
      data: { taskId: 'task_abc', durationMs: 250 },
    };
    const signature = relay.signPayload(raw);
    expect(signature).toBeDefined();
    expect(signature.length).toBe(64);

    const valid = relay.verifySignature({ ...raw, signature });
    expect(valid).toBe(true);

    const tampered = relay.verifySignature({ ...raw, signature, data: { taskId: 'hacked' } });
    expect(tampered).toBe(false);
  });

  it('dispatches event in mock mode and records to queue', async () => {
    const spy = vi.fn();
    relay.on('event:dispatched', spy);

    const res = await relay.dispatchEvent('emergency:stop', { reason: 'User hotkey pressed' });
    expect(res.success).toBe(true);
    expect(res.buffered).toBe(false);
    expect(relay.getQueueLength()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('emits event:created on dispatch', async () => {
    const spy = vi.fn();
    relay.on('event:created', spy);

    await relay.dispatchEvent('supervisor:heartbeat', { uptime: 3600 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'supervisor:heartbeat' }));
  });
});