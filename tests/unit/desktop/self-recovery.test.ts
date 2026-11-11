import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutonomousSelfRecoveryEngine } from '../../../apps/desktop-hud/src/main/self-recovery.js';

describe('AutonomousSelfRecoveryEngine', () => {
  let engine: AutonomousSelfRecoveryEngine;

  beforeEach(() => {
    engine = new AutonomousSelfRecoveryEngine({ mockMode: true });
  });

  it('classifies network disconnect errors accurately', () => {
    const cat = engine.classifyError(new Error('connect ECONNREFUSED 127.0.0.1:9222'));
    expect(cat).toBe('network_disconnect');
  });

  it('classifies process crash and missing executable errors', () => {
    const cat = engine.classifyError(new Error('spawn ENOENT: blender.exe not found'));
    expect(cat).toBe('process_crash');
  });

  it('classifies permission and file locking errors', () => {
    const cat = engine.classifyError(new Error('EPERM: operation not permitted'));
    expect(cat).toBe('permission_denied');
  });

  it('classifies runtime syntax and type errors', () => {
    const cat = engine.classifyError(new TypeError('Cannot read properties of undefined'));
    expect(cat).toBe('runtime_syntax_error');
  });

  it('handles incidents and generates structured remediation reports', async () => {
    const spy = vi.fn();
    engine.on('incident:resolved', spy);

    const report = await engine.handleIncident(new Error('fetch failed: timeout'), {
      component: 'CDPClient',
    });
    expect(report.id).toBeDefined();
    expect(report.category).toBe('network_disconnect');
    expect(report.recovered).toBe(true);
    expect(report.remediation).toContain('reconnection');
    expect(spy).toHaveBeenCalledWith(report);
  });
});
