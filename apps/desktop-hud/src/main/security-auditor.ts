import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type UserRole = 'viewer' | 'operator' | 'admin';

export interface AuditEntry {
  sequence: number;
  timestamp: number;
  action: string;
  role: UserRole;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface SecurityAuditorOptions {
  mockMode?: boolean;
  auditFilePath?: string;
}

export class SecurityAuditor extends EventEmitter {
  private mockMode: boolean;
  private auditFilePath: string;
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
  private sequence = 0;
  private memoryLogs: AuditEntry[] = [];

  constructor(options: SecurityAuditorOptions = {}) {
    super();
    this.mockMode = Boolean(options.mockMode);
    this.auditFilePath = options.auditFilePath || 'E:\\Gematron\\logs\\audit.jsonl';
  }

  /**
   * Enforces the Non-Negotiable E: Drive Storage Restriction.
   * Strictly forbids writing project files, logs, temp data, or outputs to C:.
   */
  public validateStoragePath(targetPath: string): SecurityCheckResult {
    const normalized = path.normalize(targetPath).toLowerCase();
    if (normalized.startsWith('c:') && !normalized.includes('windows\\temp')) {
      return {
        allowed: false,
        reason: 'CRITICAL SECURITY VIOLATION: Absolute E: Drive Storage Restriction prohibits writing project data to C: Drive.',
      };
    }
    return { allowed: true };
  }

  /**
   * Enforces Role-Based Access Control.
   */
  public checkPermission(role: UserRole, operation: 'read' | 'execute' | 'admin_override'): SecurityCheckResult {
    if (operation === 'read') return { allowed: true };
    if (operation === 'execute') {
      if (role === 'operator' || role === 'admin') return { allowed: true };
      return { allowed: false, reason: 'Execute permission requires operator or admin role.' };
    }
    if (operation === 'admin_override') {
      if (role === 'admin') return { allowed: true };
      return { allowed: false, reason: 'Admin override requires admin role.' };
    }
    return { allowed: false, reason: 'Unknown operation.' };
  }

  /**
   * Records an immutable, cryptographically chained audit log entry.
   */
  public logAudit(action: string, role: UserRole, details: Record<string, unknown> = {}): AuditEntry {
    this.sequence += 1;
    const timestamp = Date.now();
    const prevHash = this.lastHash;

    const payload = `${this.sequence}|${timestamp}|${action}|${role}|${JSON.stringify(details)}|${prevHash}`;
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    const entry: AuditEntry = {
      sequence: this.sequence,
      timestamp,
      action,
      role,
      details,
      prevHash,
      hash,
    };

    this.lastHash = hash;
    this.memoryLogs.push(entry);
    this.emit('audit:logged', entry);

    if (!this.mockMode) {
      try {
        const dir = path.dirname(this.auditFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.auditFilePath, JSON.stringify(entry) + '\n', 'utf8');
      } catch {
        /* ignore write errors */
      }
    }

    return entry;
  }

  public getAuditTrail(): AuditEntry[] {
    return [...this.memoryLogs];
  }

  public verifyChainIntegrity(): boolean {
    for (let i = 0; i < this.memoryLogs.length; i++) {
      const entry = this.memoryLogs[i];
      if (!entry) continue;
      const prevEntry = i > 0 ? this.memoryLogs[i - 1] : undefined;
      const prevHash = prevEntry ? prevEntry.hash : '0000000000000000000000000000000000000000000000000000000000000000';
      if (entry.prevHash !== prevHash) return false;

      const payload = `${entry.sequence}|${entry.timestamp}|${entry.action}|${entry.role}|${JSON.stringify(entry.details)}|${prevHash}`;
      const expected = crypto.createHash('sha256').update(payload).digest('hex');
      if (entry.hash !== expected) return false;
    }
    return true;
  }
}

export const securityAuditor = new SecurityAuditor();