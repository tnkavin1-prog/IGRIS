/**
 * Durable checkpoints for the vision-driven desktop agent.
 *
 * A running operation is treated as uncertain after restart. Recovery marks
 * it failed and never replays it, because the application may have accepted
 * the input before IGRIS crashed.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentSession } from './autonomous-agent.js';

export interface AgentSessionStoreOptions {
  dir: string;
  maxSessions?: number;
}
const CRASH_RECOVERY_MESSAGE =
  'IGRIS restarted before this session was verified. The last action may have occurred; it was marked uncertain and will not be replayed automatically.';

export class AgentSessionStore {
  private readonly dir: string;
  private readonly maxSessions: number;

  constructor(options: AgentSessionStoreOptions) {
    this.dir = options.dir;
    this.maxSessions = Math.max(5, Math.min(100, options.maxSessions ?? 25));
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* storage may be unavailable */
    }
  }

  public pathFor(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'session';
    return join(this.dir, `${safe}.json`);
  }

  public save(session: AgentSession): boolean {
    let temporary = '';
    try {
      mkdirSync(this.dir, { recursive: true });
      const destination = this.pathFor(session.id);
      temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      // Screenshots and large binary payloads belong to the live observation,
      // not a durable recovery record. Persist only bounded step metadata.
      const checkpoint: AgentSession = {
        ...session,
        steps: session.steps.map((step) => ({
          ...step,
          params: Object.fromEntries(
            Object.entries(step.params).filter(
              ([key, value]) =>
                !/(password|token|secret|cookie|authorization|api.?key|base64|screenshot|image)/i.test(
                  key,
                ) && !(typeof value === 'string' && value.length > 16_384),
            ),
          ),
          result:
            step.result && typeof step.result === 'object'
              ? Object.fromEntries(
                  Object.entries(step.result).filter(
                    ([key, value]) =>
                      !/(password|token|secret|cookie|authorization|api.?key|base64|screenshot|image)/i.test(
                        key,
                      ) && !(typeof value === 'string' && value.length > 16_384),
                  ),
                )
              : step.result,
        })),
      };
      writeFileSync(temporary, JSON.stringify(checkpoint), { encoding: 'utf8', flag: 'wx' });
      try {
        renameSync(temporary, destination);
        temporary = '';
      } catch {
        // Windows does not replace an existing target with rename. Keep a
        // backup while replacing so a failed write can restore old data.
        const backup = `${destination}.${randomUUID()}.bak`;
        let hadPrevious = false;
        try {
          if (existsSync(destination)) {
            renameSync(destination, backup);
            hadPrevious = true;
          }
          renameSync(temporary, destination);
          temporary = '';
          if (hadPrevious) unlinkSync(backup);
        } catch (error) {
          if (hadPrevious && existsSync(backup) && !existsSync(destination))
            renameSync(backup, destination);
          throw error;
        }
      }
      this.prune();
      return true;
    } catch {
      if (temporary) {
        try {
          unlinkSync(temporary);
        } catch {
          /* best effort */
        }
      }
      return false;
    }
  }

  public load(id: string): AgentSession | null {
    try {
      const raw = readFileSync(this.pathFor(id), 'utf8');
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      const session = value as AgentSession;
      if (session.id !== id || typeof session.goal !== 'string' || !Array.isArray(session.steps))
        return null;
      return session;
    } catch {
      return null;
    }
  }

  public list(): AgentSession[] {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => this.load(name.slice(0, -5)))
        .filter((value): value is AgentSession => value !== null)
        .sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      return [];
    }
  }

  public listIncomplete(): AgentSession[] {
    return this.list().filter((session) =>
      ['planning', 'running', 'paused'].includes(session.status),
    );
  }

  public recoverInterrupted(): AgentSession[] {
    const recovered: AgentSession[] = [];
    for (const session of this.listIncomplete()) {
      session.status = 'failed';
      session.recoveredFromCrash = true;
      session.completedAt = Date.now();
      session.error = CRASH_RECOVERY_MESSAGE;
      session.steps = session.steps.map((step) =>
        step.status === 'running'
          ? { ...step, status: 'failed', error: CRASH_RECOVERY_MESSAGE }
          : step,
      );
      this.save(session);
      recovered.push(session);
    }
    return recovered;
  }

  private prune(): void {
    const files = this.list();
    for (const stale of files.slice(this.maxSessions)) {
      try {
        unlinkSync(this.pathFor(stale.id));
      } catch {
        /* best effort */
      }
    }
  }
}
