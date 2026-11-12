import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecurityAuditor } from '../../../apps/desktop-hud/src/main/security-auditor.js';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function path() {
  const dir = mkdtempSync(join(tmpdir(), 'gemetron-audit-'));
  dirs.push(dir);
  return join(dir, 'audit.jsonl');
}
describe('SecurityAuditor', () => {
  it('chains records and protects them from external mutation', () => {
    const auditor = new SecurityAuditor({ mockMode: true });
    const first = auditor.logAudit('tool:started', 'operator', { tool: 'fixture' });
    const second = auditor.logAudit('tool:completed', 'operator', { success: true });
    expect(second.prevHash).toBe(first.hash);
    first.details.tool = 'tampered';
    auditor.getAuditTrail()[0]!.details.tool = 'changed';
    expect(auditor.verifyChainIntegrity()).toBe(true);
  });
  it('continues the disk chain across process restarts', () => {
    const auditFilePath = path();
    const first = new SecurityAuditor({ auditFilePath }).logAudit('tool:started', 'operator');
    const next = new SecurityAuditor({ auditFilePath });
    const second = next.logAudit('tool:completed', 'operator');
    expect(second.sequence).toBe(2);
    expect(second.prevHash).toBe(first.hash);
    expect(new SecurityAuditor({ auditFilePath }).verifyChainIntegrity()).toBe(true);
  });
  it('rejects a corrupted chain without modifying the file', () => {
    const auditFilePath = path();
    new SecurityAuditor({ auditFilePath }).logAudit('tool:started', 'operator');
    const corrupted = readFileSync(auditFilePath, 'utf8').replace('tool:started', 'tool:forged');
    writeFileSync(auditFilePath, corrupted);
    expect(() => new SecurityAuditor({ auditFilePath })).toThrow('integrity failed');
    expect(readFileSync(auditFilePath, 'utf8')).toBe(corrupted);
  });
});
