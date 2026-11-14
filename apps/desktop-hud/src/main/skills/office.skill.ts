import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, promises as fs, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TEMP_DIR } from '../runtime-paths.js';
import os from 'node:os';
import type { ApplicationSkill, SkillActionDefinition, SkillResult } from '../skill-framework.js';
import { OOXML_MAGIC, buildDocx, buildXlsx, parseCsv } from '../document-writer.js';
import { extractXlsxRows } from '../document-reader.js';

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

/** PowerShell single-quoted literal: only `'` needs escaping. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

/**
 * An OOXML file is a ZIP archive, so it must start with `PK\x03\x04`. Checking
 * the signature catches the old failure mode where the skill wrote a `.txt`
 * or a `.csv` and still reported success.
 */
async function assertOoxml(filePath: string): Promise<number> {
  const info = await fs.stat(filePath).catch(() => null);
  if (!info || info.size < OOXML_MAGIC.length) {
    throw new Error('the file was not written');
  }
  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(OOXML_MAGIC.length);
    await handle.read(header, 0, OOXML_MAGIC.length, 0);
    if (!header.equals(OOXML_MAGIC)) {
      throw new Error('the file is not a valid Office Open XML archive');
    }
  } finally {
    await handle.close();
  }
  return info.size;
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
          'Creates a real Microsoft Word document (.docx) with a bold title and body text. Built natively, so Word does not need to be installed; the file signature is verified before success is reported.',
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
        description:
          'Generates a real Excel workbook (.xlsx) with headers and tabular data. Built natively, so Excel does not need to be installed; the file signature is verified before success is reported.',
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
        description:
          'Creates a PowerPoint presentation (.pptx) with structured slides. Requires PowerPoint, and only reports success after verifying the saved file is a valid OOXML archive.',
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
        if (!/\.docx$/i.test(filePath)) {
          return { success: false, error: 'filePath must end in .docx.' };
        }

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, title } };
        }

        try {
          // Build the .docx natively: no Word installation required, and the
          // saved file is always a real OOXML document.
          const buffer = buildDocx({ title, content });
          await ensureParent(filePath);
          await fs.writeFile(filePath, buffer);
          const bytes = await assertOoxml(filePath);
          return {
            success: true,
            data: { created: true, filePath, title, bytes, verified: true, engine: 'ooxml' },
          };
        } catch (error) {
          return {
            success: false,
            error: `Could not create the Word document: ${(error as Error).message}`,
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
          // Every dynamic value goes through a single-quoted PowerShell
          // literal so quotes, `$` and backticks in the text cannot execute.
          const script = `
            $ErrorActionPreference = 'Stop'
            $word = New-Object -ComObject Word.Application
            $word.Visible = $false
            try {
              $doc = $word.Documents.Add()
              $selection = $word.Selection
              $selection.Style = "Heading 1"
              $selection.TypeText(${psLiteral(title)})
              $selection.TypeParagraph()
              $selection.Style = "Normal"
              $selection.TypeText(${psLiteral(content)})
              $doc.SaveAs2(${psLiteral(filePath)}, 17)
              $doc.Close()
              Write-Output "OK"
            } finally {
              $word.Quit()
              [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
            }
          `;
          await runPowerShellScript(script, 120_000);

          const info = await fs.stat(filePath).catch(() => null);
          if (!info || info.size < 5) {
            throw new Error('Word reported success but the PDF file is missing or empty.');
          }
          const handle = await fs.open(filePath, 'r');
          try {
            const header = Buffer.alloc(5);
            await handle.read(header, 0, 5, 0);
            if (header.toString('latin1') !== '%PDF-') {
              throw new Error('the file does not start with the PDF signature');
            }
          } finally {
            await handle.close();
          }
          return {
            success: true,
            data: { created: true, filePath, title, bytes: info.size, verified: true },
          };
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
        const sheetName = String(params.sheetName || 'Data').trim() || 'Data';
        const headers = Array.isArray(params.headers) ? (params.headers as unknown[]) : [];
        const rows = Array.isArray(params.rows) ? (params.rows as unknown[][]) : [];
        if (!filePath) return { success: false, error: 'filePath is required.' };
        if (!/\.xlsx$/i.test(filePath)) {
          return { success: false, error: 'filePath must end in .xlsx.' };
        }

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, rowsCount: rows.length } };
        }

        try {
          // A real workbook, not a CSV renamed to .xlsx.
          const buffer = buildXlsx({ sheetName, headers, rows });
          await ensureParent(filePath);
          await fs.writeFile(filePath, buffer);
          const bytes = await assertOoxml(filePath);
          return {
            success: true,
            data: {
              created: true,
              filePath,
              sheetName,
              headersCount: headers.length,
              rowsCount: rows.length,
              bytes,
              verified: true,
              engine: 'ooxml',
            },
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
          // Prefer a native read: it needs no Excel installation and keeps the
          // raw cell values.
          if (/\.xls[xm]$/i.test(filePath)) {
            try {
              const table = extractXlsxRows(await fs.readFile(filePath));
              const cleaned = table.filter((row) => row.some((cell) => cell.trim().length > 0));
              const headers = cleaned[0] ?? [];
              const rows = cleaned.slice(1);
              return {
                success: true,
                data: {
                  filePath,
                  headers,
                  rows,
                  rowsCount: rows.length,
                  engine: 'ooxml',
                },
              };
            } catch {
              /* fall back to Excel below */
            }
          }

          const isWorkbook = /\.xls[xm]?$/i.test(filePath);
          let csvText: string;
          if (isWorkbook) {
            // Reading an .xlsx as UTF-8 yields binary noise, so let Excel
            // export the first worksheet to a temporary CSV and parse that.
            mkdirSync(TEMP_DIR, { recursive: true });
            const csvPath = join(TEMP_DIR, `excel-read-${Date.now()}.csv`);
            try {
              const script = `
                $ErrorActionPreference = 'Stop'
                $excel = New-Object -ComObject Excel.Application
                $excel.Visible = $false
                $excel.DisplayAlerts = $false
                try {
                  $book = $excel.Workbooks.Open(${psLiteral(filePath)})
                  $book.SaveAs(${psLiteral(csvPath)}, 6)
                  $book.Close($false)
                  Write-Output "OK"
                } finally {
                  $excel.Quit()
                  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
                }
              `;
              await runPowerShellScript(script, 120_000);
              csvText = await fs.readFile(csvPath, 'utf8');
            } finally {
              await fs.rm(csvPath, { force: true }).catch(() => undefined);
            }
          } else {
            csvText = await fs.readFile(filePath, 'utf8');
          }

          const table = parseCsv(csvText).filter((line) =>
            line.some((cell) => cell.trim().length > 0),
          );
          const headers = table[0] ?? [];
          const rows = table.slice(1);
          return { success: true, data: { filePath, headers, rows, rowsCount: rows.length } };
        } catch (err) {
          return {
            success: false,
            error: `Could not read the spreadsheet: ${(err as Error).message}`,
          };
        }
      }

      case 'createPowerPoint': {
        const filePath = String(params.filePath || '').trim();
        const slides = Array.isArray(params.slides)
          ? (params.slides as Array<{ title?: string; bullets?: string[] }>)
          : [];
        if (!filePath) return { success: false, error: 'filePath is required.' };
        if (!/\.pptx$/i.test(filePath)) {
          return { success: false, error: 'filePath must end in .pptx.' };
        }

        if (this.mockMode) {
          return { success: true, data: { created: true, filePath, slidesCount: slides.length } };
        }

        try {
          // Slides travel as base64 JSON so no text from the caller is ever
          // interpolated into PowerShell source.
          const payload = Buffer.from(JSON.stringify(slides), 'utf8').toString('base64');
          const script = `
            $ErrorActionPreference = 'Stop'
            $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}'))
            $slides = $json | ConvertFrom-Json
            $powerPoint = New-Object -ComObject PowerPoint.Application
            try {
              $presentation = $powerPoint.Presentations.Add()
              $index = 1
              foreach ($slide in @($slides)) {
                $created = $presentation.Slides.Add($index, 2)
                $title = [string]$slide.title
                $bullets = @($slide.bullets) -join "\`r"
                $created.Shapes.Placeholders.Item(1).TextFrame.TextRange.Text = $title
                if ($bullets) {
                  $created.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $bullets
                }
                $index++
              }
              $presentation.SaveAs(${psLiteral(filePath)})
              $presentation.Close()
              Write-Output "OK"
            } finally {
              $powerPoint.Quit()
              [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
            }
          `;
          await runPowerShellScript(script, 180_000);
          const bytes = await assertOoxml(filePath);
          return {
            success: true,
            data: { created: true, filePath, slidesCount: slides.length, bytes, verified: true },
          };
        } catch (err) {
          return {
            success: false,
            error: `Could not create the presentation: ${(err as Error).message}. PowerPoint must be installed for .pptx output.`,
          };
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
        // The skill only reports success after checking the file signature,
        // so `verified` is the honest signal. Accept plain `created` from the
        // mock path, which does not write a file.
        return Boolean(
          (result.data as { verified?: boolean; created?: boolean })?.verified ||
          (result.data as { created?: boolean })?.created,
        );
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
