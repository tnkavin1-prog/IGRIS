import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import os from 'node:os';
import type { ApplicationSkill, SkillActionDefinition, SkillResult } from '../skill-framework.js';
import { AppManagerService } from '../app-manager.js';

const execAsync = promisify(exec);

export interface WindowsSkillOptions {
  mockMode?: boolean;
  appManager?: AppManagerService;
}

export class WindowsSkill implements ApplicationSkill {
  public readonly id = 'windows';
  public readonly name = 'Windows OS & File Explorer Skill';
  public readonly targetApp = 'Windows / Explorer';
  public readonly description =
    'Universal Windows OS operator: app lifecycle, window management, filesystem operations, and system telemetry.';

  private mockMode: boolean;
  private appManager: AppManagerService;

  constructor(options: WindowsSkillOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
    this.appManager = options.appManager ?? new AppManagerService({ mockMode: this.mockMode });
  }

  public async isAvailable(): Promise<boolean> {
    return os.platform() === 'win32' || this.mockMode;
  }

  public getActions(): SkillActionDefinition[] {
    return [
      {
        name: 'openApp',
        description: 'Launches an application by executable name or path.',
        parameters: [
          { name: 'name', type: 'string', description: 'Application name or path', required: true },
          { name: 'args', type: 'array', description: 'Command line arguments', required: false },
        ],
      },
      {
        name: 'closeApp',
        description: 'Terminates an application by process name.',
        parameters: [
          {
            name: 'processName',
            type: 'string',
            description: 'Process name (e.g. notepad.exe)',
            required: true,
          },
        ],
        dangerous: true,
      },
      {
        name: 'listWindows',
        description: 'Lists all open visible application windows.',
      },
      {
        name: 'focusWindow',
        description: 'Brings a window to the foreground by title.',
        parameters: [
          { name: 'title', type: 'string', description: 'Window title substring', required: true },
        ],
      },
      {
        name: 'exploreDirectory',
        description: 'Returns listing of directory entries.',
        parameters: [
          { name: 'path', type: 'string', description: 'Directory path', required: true },
        ],
      },
      {
        name: 'searchFiles',
        description: 'Searches for files matching a pattern in a directory.',
        parameters: [
          { name: 'directory', type: 'string', description: 'Search root path', required: true },
          {
            name: 'query',
            type: 'string',
            description: 'Name pattern or extension',
            required: true,
          },
        ],
      },
      {
        name: 'organizeFiles',
        description: 'Organizes files in a directory into folders by extension.',
        parameters: [
          {
            name: 'sourceDir',
            type: 'string',
            description: 'Directory to organize',
            required: true,
          },
        ],
      },
      {
        name: 'getSystemTelemetry',
        description: 'Returns real-time CPU, RAM, and OS telemetry.',
      },
    ];
  }

  public async execute(action: string, params: Record<string, unknown> = {}): Promise<SkillResult> {
    switch (action) {
      case 'openApp': {
        const name = String(params.name || '').trim();
        if (!name) return { success: false, error: 'Application name is required.' };
        if (this.mockMode) return { success: true, data: { pid: 1234, app: name, launched: true } };

        const args = Array.isArray(params.args) ? (params.args as string[]) : [];
        const launched = await this.appManager.launchApplication(name, args);
        return {
          success: launched.ok,
          data: { pid: launched.pid, app: name, windowTitle: launched.windowTitle },
          error: launched.error,
        };
      }

      case 'closeApp': {
        const procName = String(params.processName || '').trim();
        if (!procName) return { success: false, error: 'Process name is required.' };
        if (this.mockMode) return { success: true, data: { terminated: true, process: procName } };

        try {
          await execAsync(`taskkill /F /IM "${procName}"`);
          return { success: true, data: { terminated: true, process: procName } };
        } catch (err) {
          return {
            success: false,
            error: `Failed to terminate ${procName}: ${(err as Error).message}`,
          };
        }
      }

      case 'listWindows': {
        if (this.mockMode) {
          return {
            success: true,
            data: [
              { title: 'Google Chrome', process: 'chrome.exe' },
              { title: 'Visual Studio Code', process: 'Code.exe' },
            ],
          };
        }
        try {
          const script =
            'Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json';
          const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`);
          const windows = stdout.trim() ? JSON.parse(stdout) : [];
          return { success: true, data: Array.isArray(windows) ? windows : [windows] };
        } catch (err) {
          return { success: false, error: `Failed to list windows: ${(err as Error).message}` };
        }
      }

      case 'focusWindow': {
        const title = String(params.title || '').trim();
        if (!title) return { success: false, error: 'Window title is required.' };
        if (this.mockMode) return { success: true, data: { focused: true, title } };

        try {
          const script = `
            $wshell = New-Object -ComObject WScript.Shell
            $ret = $wshell.AppActivate("${title}")
            [PSCustomObject]@{ focused = $ret } | ConvertTo-Json
          `;
          const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`);
          const res = JSON.parse(stdout);
          return { success: Boolean(res.focused), data: res };
        } catch (err) {
          return { success: false, error: `Failed to focus window: ${(err as Error).message}` };
        }
      }

      case 'exploreDirectory': {
        const dirPath = String(params.path || '').trim();
        if (!dirPath || !existsSync(dirPath)) {
          return { success: false, error: `Directory does not exist: ${dirPath}` };
        }
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
          }));
          return { success: true, data: { path: dirPath, items } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'searchFiles': {
        if (this.mockMode) {
          return { success: true, data: { matches: ['mock_file.txt'], count: 1 } };
        }
        const searchDir = String(params.directory || '').trim();
        const query = String(params.query || '')
          .trim()
          .toLowerCase();
        if (!searchDir || !existsSync(searchDir)) {
          return { success: false, error: `Directory does not exist: ${searchDir}` };
        }
        try {
          const matches: string[] = [];
          const scan = async (d: string) => {
            const list = await fs.readdir(d, { withFileTypes: true });
            for (const item of list) {
              const full = join(d, item.name);
              if (item.name.toLowerCase().includes(query)) matches.push(full);
              if (item.isDirectory() && !item.name.startsWith('.')) {
                await scan(full);
              }
            }
          };
          await scan(searchDir);
          return { success: true, data: { matches, count: matches.length } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'organizeFiles': {
        const sourceDir = String(params.sourceDir || '').trim();
        if (!sourceDir || !existsSync(sourceDir)) {
          return { success: false, error: `Source directory does not exist: ${sourceDir}` };
        }
        try {
          const files = await fs.readdir(sourceDir, { withFileTypes: true });
          let movedCount = 0;
          for (const file of files) {
            if (!file.isFile()) continue;
            const ext = extname(file.name).replace('.', '').toLowerCase() || 'other';
            const targetFolder = join(sourceDir, ext.toUpperCase() + '_Files');
            if (!existsSync(targetFolder)) await fs.mkdir(targetFolder, { recursive: true });
            await fs.rename(join(sourceDir, file.name), join(targetFolder, file.name));
            movedCount++;
          }
          return { success: true, data: { movedCount, directory: sourceDir } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'getSystemTelemetry': {
        const cpus = os.cpus();
        const freeMem = os.freemem();
        const totalMem = os.totalmem();
        return {
          success: true,
          data: {
            platform: os.platform(),
            arch: os.arch(),
            cpuModel: cpus[0]?.model || 'Unknown',
            cpuCores: cpus.length,
            memory: {
              totalMB: Math.round(totalMem / (1024 * 1024)),
              freeMB: Math.round(freeMem / (1024 * 1024)),
              usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
            },
            uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
          },
        };
      }

      default:
        return { success: false, error: `Unknown action "${action}" for skill "${this.id}".` };
    }
  }

  public async verify(action: string, result: SkillResult): Promise<boolean> {
    if (!result || !result.success) return false;
    switch (action) {
      case 'openApp':
        return typeof (result.data as { pid?: number })?.pid === 'number';
      case 'closeApp':
        return Boolean((result.data as { terminated?: boolean })?.terminated);
      case 'listWindows':
        return Array.isArray(result.data);
      case 'exploreDirectory':
        return Array.isArray((result.data as { items?: unknown[] })?.items);
      case 'getSystemTelemetry':
        return typeof (result.data as { cpuCores?: number })?.cpuCores === 'number';
      default:
        return true;
    }
  }
}

export const windowsSkill = new WindowsSkill();
