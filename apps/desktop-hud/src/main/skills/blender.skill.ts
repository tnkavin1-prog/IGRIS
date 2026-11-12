import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../runtime-paths.js';
import type { ApplicationSkill, SkillActionDefinition, SkillResult } from '../skill-framework.js';

const execAsync = promisify(exec);

export interface BlenderSkillOptions {
  mockMode?: boolean;
  blenderPath?: string;
}

export class BlenderSkill implements ApplicationSkill {
  public readonly id = 'blender';
  public readonly name = 'Blender 3D Skill';
  public readonly targetApp = 'Blender 3D';
  public readonly description =
    'Automates 3D modeling, Python scene scripts, background rendering, and mesh export in Blender.';

  private mockMode: boolean;
  private customBlenderPath?: string;

  constructor(options: BlenderSkillOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
    this.customBlenderPath = options.blenderPath;
  }

  private async findBlenderExecutable(): Promise<string | null> {
    if (this.customBlenderPath && existsSync(this.customBlenderPath)) {
      return this.customBlenderPath;
    }
    try {
      const { stdout } = await execAsync('where blender');
      const lines = stdout.trim().split('\n');
      if (lines[0] && existsSync(lines[0].trim())) return lines[0].trim();
    } catch {}

    const standardPaths = [
      'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
      'C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe',
      'C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe',
      'C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe',
    ];
    for (const p of standardPaths) {
      if (existsSync(p)) return p;
    }
    return null;
  }

  public async isAvailable(): Promise<boolean> {
    if (this.mockMode) return true;
    const exe = await this.findBlenderExecutable();
    return Boolean(exe);
  }

  public getActions(): SkillActionDefinition[] {
    return [
      {
        name: 'checkBlender',
        description: 'Detects if Blender is installed and returns the executable path and version.',
      },
      {
        name: 'runPython',
        description: 'Executes Python code in a headless Blender session.',
        parameters: [
          {
            name: 'code',
            type: 'string',
            description: 'Python code string to execute',
            required: true,
          },
          {
            name: 'blendFile',
            type: 'string',
            description: 'Optional .blend file path to open',
            required: false,
          },
        ],
      },
      {
        name: 'renderScene',
        description: 'Renders a 3D scene from a .blend file to an image.',
        parameters: [
          {
            name: 'blendFile',
            type: 'string',
            description: 'Source .blend file path',
            required: true,
          },
          {
            name: 'outputImg',
            type: 'string',
            description: 'Target output image path',
            required: true,
          },
        ],
      },
    ];
  }

  public async execute(action: string, params: Record<string, unknown> = {}): Promise<SkillResult> {
    switch (action) {
      case 'checkBlender': {
        if (this.mockMode) {
          return {
            success: true,
            data: { installed: true, version: '4.2.0 (mock)', path: 'C:\\Blender\\blender.exe' },
          };
        }
        const exe = await this.findBlenderExecutable();
        if (!exe) return { success: false, error: 'Blender executable not found on host.' };
        try {
          const { stdout } = await execAsync(`"${exe}" -v`);
          return {
            success: true,
            data: { installed: true, version: stdout.split('\n')[0]?.trim(), path: exe },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'runPython': {
        const code = String(params.code || '').trim();
        const blendFile = String(params.blendFile || '').trim();
        if (!code) return { success: false, error: 'Python code is required.' };

        if (this.mockMode) {
          return {
            success: true,
            data: { executed: true, output: 'Scene executed in mock Blender' },
          };
        }

        const exe = await this.findBlenderExecutable();
        if (!exe) return { success: false, error: 'Blender is not installed.' };

        const tempScript = join(TEMP_DIR, `blender_${Date.now()}.py`);
        try {
          await fs.writeFile(tempScript, code, 'utf8');
          const fileArg = blendFile && existsSync(blendFile) ? `"${blendFile}" ` : '';
          const cmd = `"${exe}" -b ${fileArg}-P "${tempScript}"`;
          const { stdout, stderr } = await execAsync(cmd);
          return {
            success: true,
            data: { executed: true, stdout: stdout.trim(), stderr: stderr.trim() },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        } finally {
          await fs.unlink(tempScript).catch(() => {});
        }
      }

      case 'renderScene': {
        const blendFile = String(params.blendFile || params.blendFilePath || '').trim();
        const outputImg = String(params.outputImg || join(TEMP_DIR, 'render.png')).trim();
        if (this.mockMode) {
          return { success: true, data: { rendered: true, outputImg } };
        }
        if (!blendFile) {
          return { success: false, error: 'blendFile or blendFilePath is required.' };
        }
        const exe = await this.findBlenderExecutable();
        if (!exe) return { success: false, error: 'Blender is not installed.' };

        try {
          const cmd = `"${exe}" -b "${blendFile}" -o "${outputImg}" -F PNG -f 1`;
          await execAsync(cmd);
          return { success: true, data: { rendered: true, outputImg } };
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
      case 'checkBlender':
        return Boolean((result.data as { installed?: boolean })?.installed);
      case 'runPython':
        return Boolean((result.data as { executed?: boolean })?.executed);
      case 'renderScene':
        return Boolean((result.data as { rendered?: boolean })?.rendered);
      default:
        return true;
    }
  }
}

export const blenderSkill = new BlenderSkill();
