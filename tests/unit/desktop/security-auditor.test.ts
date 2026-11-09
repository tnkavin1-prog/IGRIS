import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityAuditor } from '../../../apps/desktop-hud/src/main/security-auditor.js';

describe('SecurityAuditor & RBAC', () => {
  let auditor: SecurityAuditor;

  beforeEach(() => {
    auditor = new SecurityAuditor({ mockMode: true });
  });

  it('strictly validates and rejects writes targeting C: drive', () => {
    const invalid = auditor.validateStoragePath('C:\\Users\\tnkav\\project\\file.ts');
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toContain('E: Drive Storage Restriction');

    const valid = auditor.validateStoragePath('E:\\Gematron\\temp\\report.docx');
    expect(valid.allowed).toBe(true);
  });

  it('enforces RBAC permissions based on user role', () => {
    expect(auditor.checkPermission('viewer', 'read').allowed).toBe(true);
    expect(auditor.checkPermission('viewer', 'execute').allowed).toBe(false);

    expect(auditor.checkPermission('operator', 'execute').allowed).toBe(true);
    expect(auditor.checkPermission('operator', 'admin_override').allowed).toBe(false);

    expect(auditor.checkPermission('admin', 'admin_override').allowed).toBe(true);
  });

  it('records tamper-evident cryptographically chained audit entries', () => {
    const e1 = auditor.logAudit('workflow:start', 'operator', { goal: 'Open Notepad' });
    const e2 = auditor.logAudit('emergency:stop', 'admin', { reason: 'Killswitch' });

    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);

    expect(auditor.verifyChainIntegrity()).toBe(true);
  });
});