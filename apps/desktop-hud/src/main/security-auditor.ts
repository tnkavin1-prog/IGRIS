import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOGS_DIR } from './runtime-paths.js';

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
export interface SecurityAuditorOptions {
  mockMode?: boolean;
  auditFilePath?: string;
}
const GENESIS = '0'.repeat(64);

export class SecurityAuditor extends EventEmitter {
  private auditFilePath: string;
  private memoryLogs: AuditEntry[] = [];
  private writable: boolean;

  constructor(options: SecurityAuditorOptions = {}) {
    super();
    this.writable = !options.mockMode;
    this.auditFilePath = options.auditFilePath || join(LOGS_DIR, 'audit.jsonl');
    if (this.writable && existsSync(this.auditFilePath)) {
      this.memoryLogs = readFileSync(this.auditFilePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (!this.verifyChainIntegrity())
        throw new Error('Audit chain integrity failed; existing log was not modified.');
    }
  }

  private hash(entry: Omit<AuditEntry, 'hash'>): string {
    return createHash('sha256')
      .update(
        `${entry.sequence}|${entry.timestamp}|${entry.action}|${entry.role}|${JSON.stringify(entry.details)}|${entry.prevHash}`,
      )
      .digest('hex');
  }

  public logAudit(
    action: string,
    role: UserRole,
    details: Record<string, unknown> = {},
  ): AuditEntry {
    const previous = this.memoryLogs.at(-1);
    const unsigned = {
      sequence: (previous?.sequence ?? 0) + 1,
      timestamp: Date.now(),
      action,
      role,
      details: structuredClone(details),
      prevHash: previous?.hash ?? GENESIS,
    };
    const entry: AuditEntry = { ...unsigned, hash: this.hash(unsigned) };
    if (this.writable) {
      try {
        mkdirSync(dirname(this.auditFilePath), { recursive: true });
        appendFileSync(this.auditFilePath, JSON.stringify(entry) + '\n', 'utf8');
      } catch {
        this.writable = false;
        console.warn('[Audit] Disk logging unavailable; remaining records are in memory only.');
        this.emit('audit:write-error');
      }
    }
    this.memoryLogs.push(entry);
    this.emit('audit:logged', structuredClone(entry));
    return structuredClone(entry);
  }

  public getAuditTrail(): AuditEntry[] {
    return structuredClone(this.memoryLogs);
  }

  public verifyChainIntegrity(): boolean {
    return this.memoryLogs.every(
      (entry, i) =>
        entry.sequence === i + 1 &&
        entry.prevHash === (this.memoryLogs[i - 1]?.hash ?? GENESIS) &&
        entry.hash === this.hash(entry),
    );
  }
}
