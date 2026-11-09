import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ApplicationSkill,
  SkillActionDefinition,
  SkillResult,
} from '../skill-framework.js';

export interface OpenCodeSkillOptions {
  mockMode?: boolean;
  serverUrl?: string;
  passwordFile?: string;
}

export class OpenCodeSkill implements ApplicationSkill {
  public readonly id = 'opencode';
  public readonly name = 'OpenCode Local Intelligence Skill';
  public readonly targetApp = 'OpenCode Desktop / Daemon';
  public readonly description =
    'Orchestrates local free AI models (DeepSeek V4.1 Flash, GLM 5.3 Flash) via OpenCode REST API for autonomous coding, refactoring, and tool execution.';

  private mockMode: boolean;
  private serverUrl: string;
  private passwordFile: string;

  constructor(options: OpenCodeSkillOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
    this.serverUrl = options.serverUrl || process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096';
    this.passwordFile =
      options.passwordFile || join('E:\\Gematron', 'logs', 'opencode-server-password.txt');
  }

  private getAuthHeader(): string {
    let pw = process.env.OPENCODE_PASSWORD;
    if (!pw && existsSync(this.passwordFile)) {
      try {
        pw = readFileSync(this.passwordFile, 'utf8').trim();
      } catch {}
    }
    if (!pw) pw = 'mock-password';
    return 'Basic ' + Buffer.from(`opencode:${pw}`).toString('base64');
  }

  public async isAvailable(): Promise<boolean> {
    if (this.mockMode) return true;
    try {
      const res = await fetch(`${this.serverUrl}/api/info`, {
        headers: { Authorization: this.getAuthHeader() },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public getActions(): SkillActionDefinition[] {
    return [
      {
        name: 'checkService',
        description: 'Checks health, version, and capabilities of the OpenCode server.',
      },
      {
        name: 'listFreeModels',
        description: 'Retrieves all verified $0.00 free models available through OpenCode.',
      },
      {
        name: 'dispatchTask',
        description: 'Dispatches an autonomous software task to a verified free OpenCode model.',
        parameters: [
          { name: 'model', type: 'string', description: 'deepseek-v4.1-flash-free | glm-5.3-flash-free', required: true },
          { name: 'prompt', type: 'string', description: 'Actionable engineering prompt', required: true },
          { name: 'title', type: 'string', description: 'Session title', required: false },
        ],
      },
      {
        name: 'getSessionStatus',
        description: 'Checks the current execution status and idle outcome of an active session.',
        parameters: [
          { name: 'sessionId', type: 'string', description: 'Session ID returned by dispatchTask', required: true },
        ],
      },
    ];
  }

  public async execute(action: string, params: Record<string, unknown> = {}): Promise<SkillResult> {
    switch (action) {
      case 'checkService': {
        if (this.mockMode) {
          return { success: true, data: { status: 'running', version: '2.2.5 (mock)', url: this.serverUrl } };
        }
        try {
          const res = await fetch(`${this.serverUrl}/api/info`, {
            headers: { Authorization: this.getAuthHeader() },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const info = await res.json();
          return { success: true, data: info };
        } catch (err) {
          return { success: false, error: `OpenCode service unreachable: ${(err as Error).message}` };
        }
      }

      case 'listFreeModels': {
        if (this.mockMode) {
          return {
            success: true,
            data: [
              { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free', cost: 0 },
              { id: 'glm-5.3-flash-free', name: 'GLM 5.3 Flash Free', cost: 0 },
            ],
          };
        }
        try {
          const res = await fetch(`${this.serverUrl}/api/model`, {
            headers: { Authorization: this.getAuthHeader() },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const allModels: Array<{ id: string; providerID: string; name: string }> = json.data || [];
          const freeModels = allModels.filter(
            (m) => m.providerID !== 'opencode-go' && (m.id.endsWith('-free') || m.id.includes('free')),
          );
          return { success: true, data: freeModels };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'dispatchTask': {
        const model = String(params.model || 'deepseek-v4.1-flash-free').trim();
        const prompt = String(params.prompt || '').trim();
        const title = String(params.title || 'Gematron Task').trim();
        if (!prompt) return { success: false, error: 'prompt is required.' };

        if (this.mockMode) {
          return { success: true, data: { sessionId: 'ses_mock123', model, promptQueued: true } };
        }

        try {
          // 1. Create Session
          const sessRes = await fetch(`${this.serverUrl}/api/session`, {
            method: 'POST',
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title,
              agent: 'build',
              model: { id: model, providerID: 'opencode' },
              location: { directory: 'E:\\Gematron' },
            }),
          });
          if (!sessRes.ok) throw new Error(`Failed to create session: HTTP ${sessRes.status}`);
          const sessJson = await sessRes.json();
          const sessionId = sessJson.data?.id;

          // 2. Queue Prompt
          const promptRes = await fetch(`${this.serverUrl}/api/session/${sessionId}/prompt`, {
            method: 'POST',
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: prompt }),
          });
          if (!promptRes.ok) throw new Error(`Failed to queue prompt: HTTP ${promptRes.status}`);

          return { success: true, data: { sessionId, model, status: 'dispatched' } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'getSessionStatus': {
        const sessionId = String(params.sessionId || '').trim();
        if (!sessionId) return { success: false, error: 'sessionId is required.' };

        if (this.mockMode) {
          return { success: true, data: { sessionId, outcome: 'succeeded', completed: true } };
        }

        try {
          const res = await fetch(`${this.serverUrl}/api/session/${sessionId}/message`, {
            headers: { Authorization: this.getAuthHeader() },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const msgs: Array<{ type: string; outcome?: string }> = json.data || [];
          const idleMsg = msgs.find((m) => m.type === 'idle');

          return {
            success: true,
            data: {
              sessionId,
              completed: Boolean(idleMsg),
              outcome: idleMsg?.outcome || 'running',
              messageCount: msgs.length,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      default:
        return { success: false, error: `Unknown action "${action}" for skill "${this.id}".` };
    }
  }

  public async verify(action: string, result: SkillResult): Promise<boolean> {
    if (!result || !result.success) return false;
    switch (action) {
      case 'checkService':
        return Boolean((result.data as { version?: string })?.version);
      case 'listFreeModels':
        return Array.isArray(result.data);
      case 'dispatchTask':
        return Boolean((result.data as { sessionId?: string })?.sessionId);
      case 'getSessionStatus':
        return typeof (result.data as { completed?: boolean })?.completed === 'boolean';
      default:
        return true;
    }
  }
}

export const openCodeSkill = new OpenCodeSkill();
