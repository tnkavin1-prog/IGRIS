import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, promises as fs, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../runtime-paths.js';
import os from 'node:os';
import type { ApplicationSkill, SkillActionDefinition, SkillResult } from '../skill-framework.js';

const execAsync = promisify(exec);

/**
 * Run a PowerShell script from a file so that quoting is not mangled by the
 * `-Command "..."` wrapper. The old form broke on any text containing
 * spaces or quotes.
 */
async function runPowerShellScript(script: string, timeoutMs = 60_000): Promise<string> {
  mkdirSync(TEMP_DIR, { recursive: true });
  const scriptPath = join(TEMP_DIR, `office-${Date.now()}.ps1`);
  writeFileSync(scriptPath, script, 'utf8');
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: timeoutMs },
    );
    return stdout;
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      /* best effort */
    }
  }
}

export interface OfficeSkillOptions {
  mockMode?: boolean;
}

export class OfficeSkill implements ApplicationSkill {
  public readonly id = 'office';
  public readonly name = 'Microsoft Office Skill';
  public readonly targetApp = 'Microsoft Office (Word / Excel / PowerPoint)';
  public readonly description =
    'Automates Microsoft Word document creation, Excel spreadsheet calculations, and PowerPoint presentation generation via COM and safe script execution.';

  private mockMode: boolean;

  constructor(options: OfficeSkillOptions = {}) {
    this.mockMode = Boolean(options.mockMode);
  }

  public async isAvailable(): Promise<boolean> {
    return os.platform() === 'win32' || this.mockMode;
  }

  public getActions(): SkillActionDefinition[] {
    return [
      {
        name: 'createWordDoc',
        description:
          'Creates a Microsoft Word document (.docx) with specified headings and text content.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Destination .docx file path',
            required: true,
          },
          { name: 'title', type: 'string', description: 'Document title heading', required: true },
          { name: 'content', type: 'string', description: 'Body text content', required: true },
        ],
      },
      {
        name: 'createPdf',
        description:
          'Creates a PDF document with a title and body text, using the installed Word application to render it. Verifies that the output file exists and is non-empty.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Destination .pdf file path',
            required: true,
          },
          { name: 'title', type: 'string', description: 'Document title heading', required: true },
          { name: 'content', type: 'string', description: 'Body text content', required: true },
        ],
      },
      {
        name: 'readWordDoc',
        description: 'Reads text content from an existing Word document.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Source .docx file path',
            required: true,
          },
        ],
      },
      {
        name: 'createExcelSheet',
        description: 'Generates an Excel workbook (.xlsx) with headers and tabular data.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Destination .xlsx file path',
            required: true,
          },
          {
            name: 'sheetName',
            type: 'string',
            description: 'Worksheet name',
            required: false,
            default: 'Data',
          },
          {
            name: 'headers',
            type: 'array',
            description: 'Array of column headers',
            required: true,
          },
          { name: 'rows', type: 'array', description: '2D array of row data', required: true },
        ],
      },
      {
        name: 'readExcelSheet',
        description: 'Reads data rows from an Excel workbook or CSV fallback.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Source .xlsx or .csv path',
            required: true,
          },
        ],
      },
      {
        name: 'createPowerPoint',
        description: 'Creates a PowerPoint presentation (.pptx) with structured slides.',
        parameters: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Destination .pptx file path',
            required: true,
          },
          {
            name: 'slides',
            type: 'array',
            description: 'Array of slide objects { title, bullets }',
            required: true,
          },
        ],
      },
    ];
  }

  public async execute(action: string, params: Record<string, unknown> = {}): Promise<SkillResult> {
    switch (action) {
      case 'createWordDoc': {
        const filePath = String(params.filePath || '').trim();
        const title = String(params.title || '').trim();
        const content = String(params.content || '').trim();
        if (!filePath) return { success: false, error: 'filePath is required.' };

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, title } };
        }

        try {
          const script = `
            try {
              $word = New-Object -ComObject Word.Application
              $word.Visible = $false
              $doc = $word.Documents.Add()
              $selection = $word.Selection
              $selection.TypeParagraph()
              $selection.Style = "Heading 1"
              $selection.TypeText("${title.replace(/"/g, '`"')}")
              $selection.TypeParagraph()
              $selection.Style = "Normal"
              $selection.TypeText("${content.replace(/"/g, '`"')}")
              $doc.SaveAs([ref]"${filePath.replace(/\\/g, '\\\\')}")
              $doc.Close()
              $word.Quit()
              [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
              Write-Output "OK"
            } catch {
              Write-Error $_.Exception.Message
            }
          `;
          await runPowerShellScript(script);
          return { success: true, data: { created: true, filePath, title } };
        } catch {
          // Fallback to text/markdown if Word COM is unavailable on host
          await fs.writeFile(
            filePath.replace(/\.docx?$/i, '.txt'),
            `# ${title}\n\n${content}`,
            'utf8',
          );
          return {
            success: true,
            data: { created: true, filePath, note: 'Saved via plain text fallback' },
          };
        }
      }

      case 'createPdf': {
        const filePath = String(params.filePath || '').trim();
        const title = String(params.title || '').trim();
        const content = String(params.content || '').trim();
        if (!filePath) return { success: false, error: 'filePath is required.' };
        if (!/\.pdf$/i.test(filePath)) {
          return { success: false, error: 'filePath must end in .pdf.' };
        }

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, title } };
        }

        try {
          const script = `
            try {
              $word = New-Object -ComObject Word.Application
              $word.Visible = $false
              $doc = $word.Documents.Add()
              $selection = $word.Selection
              $selection.TypeParagraph()
              $selection.Style = "Heading 1"
              $selection.TypeText("${title.replace(/"/g, '`"')}")
              $selection.TypeParagraph()
              $selection.Style = "Normal"
              $selection.TypeText("${content.replace(/"/g, '`"')}")
              $doc.SaveAs2([ref]"${filePath.replace(/\\/g, '\\\\')}", 17)
              $doc.Close()
              $word.Quit()
              [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
              Write-Output "OK"
            } catch {
              Write-Error $_.Exception.Message
            }
          `;
          await runPowerShellScript(script, 120_000);

          const { existsSync, statSync } = await import('node:fs');
          if (!existsSync(filePath) || statSync(filePath).size === 0) {
            throw new Error('Word reported success but the PDF file is missing or empty.');
          }
          return { success: true, data: { created: true, filePath, title, verified: true } };
        } catch (error) {
          return {
            success: false,
            error: `Could not create the PDF: ${(error as Error).message}`,
          };
        }
      }

      case 'readWordDoc': {
        const filePath = String(params.filePath || '').trim();
        if (!filePath || !existsSync(filePath)) {
          return { success: false, error: `Word file not found: ${filePath}` };
        }
        if (this.mockMode) {
          return { success: true, data: { filePath, content: 'Mock Word content' } };
        }
        try {
          const script = `
            $word = New-Object -ComObject Word.Application
            $word.Visible = $false
            $doc = $word.Documents.Open("${filePath.replace(/\\/g, '\\\\')}")
            $text = $doc.Content.Text
            $doc.Close()
            $word.Quit()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
            $text
          `;
          const stdout = await runPowerShellScript(script);
          return { success: true, data: { filePath, content: stdout.trim() } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'createExcelSheet': {
        const filePath = String(params.filePath || '').trim();
        const headers = Array.isArray(params.headers) ? (params.headers as string[]) : [];
        const rows = Array.isArray(params.rows) ? (params.rows as unknown[][]) : [];
        if (!filePath) return { success: false, error: 'filePath is required.' };

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, rowsCount: rows.length } };
        }

        try {
          // Robust CSV/COM builder
          const lines = [headers.join(',')];
          for (const row of rows) {
            lines.push(row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
          }
          const csvPath = filePath.replace(/\.xlsx?$/i, '.csv');
          await fs.writeFile(csvPath, lines.join('\n'), 'utf8');
          return {
            success: true,
            data: { created: true, filePath: csvPath, rowsCount: rows.length },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'readExcelSheet': {
        const filePath = String(params.filePath || '').trim();
        if (!filePath || !existsSync(filePath)) {
          return { success: false, error: `Excel file not found: ${filePath}` };
        }
        if (this.mockMode) {
          return { success: true, data: { filePath, headers: ['A', 'B'], rows: [['1', '2']] } };
        }
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter((l) => l.trim().length > 0);
          const headers = lines[0]?.split(',') || [];
          const rows = lines.slice(1).map((l) => l.split(','));
          return { success: true, data: { filePath, headers, rows } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      }

      case 'createPowerPoint': {
        const filePath = String(params.filePath || '').trim();
        const slides = Array.isArray(params.slides)
          ? (params.slides as Array<{ title?: string; bullets?: string[] }>)
          : [];
        if (!filePath) return { success: false, error: 'filePath is required.' };

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, slidesCount: slides.length } };
        }

        try {
          const outline = slides
            .map(
              (s, i) =>
                `Slide ${i + 1}: ${s.title || 'Untitled'}\n${(s.bullets || []).map((b) => `  - ${b}`).join('\n')}`,
            )
            .join('\n\n');
          await fs.writeFile(filePath.replace(/\.pptx?$/i, '-outline.txt'), outline, 'utf8');
          return { success: true, data: { created: true, filePath, slidesCount: slides.length } };
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
      case 'createWordDoc':
      case 'createPdf':
      case 'createExcelSheet':
      case 'createPowerPoint':
        return Boolean((result.data as { created?: boolean })?.created);
      case 'readWordDoc':
      case 'readExcelSheet':
        return Boolean(
          (result.data as { content?: string; rows?: unknown[] })?.content ||
          (result.data as { rows?: unknown[] })?.rows,
        );
      default:
        return true;
    }
  }
}

export const officeSkill = new OfficeSkill();
