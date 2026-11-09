import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  ApplicationSkill,
  SkillActionDefinition,
  SkillResult,
} from '../skill-framework.js';

const execAsync = promisify(exec);

export interface CreativeSkillOptions {
  mockMode?: boolean;
}

export class CreativeSkill implements ApplicationSkill {
  public readonly id = 'creative';
  public readonly name = 'Adobe Creative Suite Skill';
  public readonly targetApp = 'Adobe Photoshop / Premiere Pro / After Effects';
  public readonly description =
    'Automates graphic editing in Photoshop, video sequencing in Premiere Pro, and motion graphic rendering in After Effects via ExtendScript and CLI.';

  private mockMode: boolean;

  constructor(options: CreativeSkillOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
  }

  public async isAvailable(): Promise<boolean> {
    if (this.mockMode) return true;
    const adobeDir = 'C:\\Program Files\\Adobe';
    return existsSync(adobeDir);
  }

  public getActions(): SkillActionDefinition[] {
    return [
      {
        name: 'checkCreativeApps',
        description: 'Scans the host system for installed Adobe Photoshop, Premiere Pro, and After Effects editions.',
      },
      {
        name: 'executeExtendScript',
        description: 'Executes an ExtendScript (.jsx) file or script string in target Adobe application.',
        parameters: [
          { name: 'app', type: 'string', description: 'photoshop | premiere | aftereffects', required: true },
          { name: 'scriptContent', type: 'string', description: 'JavaScript / ExtendScript code', required: true },
        ],
      },
      {
        name: 'renderPhotoshopBatch',
        description: 'Performs headless or scripted export of PSD assets into PNG/JPEG formats.',
        parameters: [
          { name: 'psdFile', type: 'string', description: 'Path to source .psd file', required: true },
          { name: 'format', type: 'string', description: 'png | jpg | webp', required: false, default: 'png' },
          { name: 'outputDir', type: 'string', description: 'Destination folder', required: true },
        ],
      },
    ];
  }

  public async execute(action: string, params: Record<string, unknown> = {}): Promise<SkillResult> {
    switch (action) {
      case 'checkCreativeApps': {
        if (this.mockMode) {
          return {
            success: true,
            data: {
              photoshop: { installed: true, version: '2026 (mock)' },
              premiere: { installed: true, version: '2026 (mock)' },
              afterEffects: { installed: true, version: '2026 (mock)' },
            },
          };
        }
        const adobeDir = 'C:\\Program Files\\Adobe';
        const appsFound: Record<string, boolean> = {
          photoshop: false,
          premiere: false,
          afterEffects: false,
        };

        if (existsSync(adobeDir)) {
          try {
            const entries = await fs.readdir(adobeDir);
            for (const entry of entries) {
              const lower = entry.toLowerCase();
              if (lower.includes('photoshop')) appsFound.photoshop = true;
              if (lower.includes('premiere')) appsFound.premiere = true;
              if (lower.includes('after effects')) appsFound.afterEffects = true;
            }
          } catch {}
        }

        return { success: true, data: appsFound };
      }

      case 'executeExtendScript': {
        const targetApp = String(params.app || '').toLowerCase().trim();
        const scriptContent = String(params.scriptContent || '').trim();
        if (!scriptContent) return { success: false, error: 'scriptContent is required.' };

        if (this.mockMode) {
          return { success: true, data: { executed: true, targetApp, output: 'ExtendScript executed in mock mode' } };
        }

        const tempScript = join('E:\\Gematron\\temp', `adobe_${Date.now()}.jsx`);
        try {
          await fs.writeFile(tempScript, scriptContent, 'utf8');
          // Windows file association trigger for Adobe JSX
          const script = `Start-Process "${tempScript}"`;
          await execAsync(`powershell -NoProfile -Command "${script}"`);
          return { success: true, data: { executed: true, targetApp, scriptPath: tempScript } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'renderPhotoshopBatch': {
        const psdFile = String(params.psdFile || '').trim();
        const outputDir = String(params.outputDir || '').trim();
        const format = String(params.format || 'png').toLowerCase();

        if (!psdFile || !outputDir) {
          return { success: false, error: 'psdFile and outputDir are required.' };
        }

        if (this.mockMode) {
          return { success: true, data: { exported: true, psdFile, outputDir, format } };
        }

        // Generate automated JSX script for Photoshop export
        const exportJsx = `
          var doc = app.open(new File("${psdFile.replace(/\\/g, '\\\\')}"));
          var exportOptions = new ExportOptionsSaveForWeb();
          exportOptions.format = SaveDocumentType.PNG;
          exportOptions.PNG8 = false;
          var targetFile = new File("${join(outputDir, 'export.png').replace(/\\/g, '\\\\')}");
          doc.exportDocument(targetFile, ExportType.SAVEFORWEB, exportOptions);
          doc.close(SaveOptions.DONOTSAVECHANGES);
        `;
        return this.execute('executeExtendScript', { app: 'photoshop', scriptContent: exportJsx });
      }

      default:
        return { success: false, error: `Unknown action "${action}" for skill "${this.id}".` };
    }
  }

  public async verify(action: string, result: SkillResult): Promise<boolean> {
    if (!result || !result.success) return false;
    switch (action) {
      case 'checkCreativeApps':
        return typeof result.data === 'object' && result.data !== null;
      case 'executeExtendScript':
      case 'renderPhotoshopBatch':
        return Boolean((result.data as { executed?: boolean; exported?: boolean })?.executed || (result.data as { exported?: boolean })?.exported);
      default:
        return true;
    }
  }
}

export const creativeSkill = new CreativeSkill();
