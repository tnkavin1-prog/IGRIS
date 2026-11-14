import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDocx, buildXlsx } from '../../../apps/desktop-hud/src/main/document-writer.js';
import { extractDocxText } from '../../../apps/desktop-hud/src/main/document-reader.js';
import { OfficeSkill } from '../../../apps/desktop-hud/src/main/skills/office.skill.js';

/**
 * Optional round trip against a real Office installation.
 *
 * These tests open the generated files with Word and Excel through COM to
 * prove the archives are not merely well-formed but readable by the
 * applications that will open them. Office is not required for development,
 * so the suite is skipped unless GEMETRON_OFFICE_ROUNDTRIP=1 is set.
 *
 *   $env:GEMETRON_OFFICE_ROUNDTRIP=1; npx vitest run tests/unit/desktop/office-roundtrip.test.ts
 */

const enabled = process.env.GEMETRON_OFFICE_ROUNDTRIP === '1';
const run = enabled ? it : it.skip;
const dir = join(process.cwd(), 'tests', '.artifacts', 'office-roundtrip');

function ps(script: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `run-${Date.now()}.ps1`);
  writeFileSync(path, script, 'utf8');
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path],
      {
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
  } finally {
    rmSync(path, { force: true });
  }
}

describe('real Office round trip', () => {
  run('Word opens the generated .docx and reads the text back', { timeout: 120_000 }, () => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'roundtrip.docx');
    writeFileSync(file, buildDocx({ title: 'Round trip', content: 'Body text works.' }));

    const out = ps(`
      $ErrorActionPreference = 'Stop'
      $word = New-Object -ComObject Word.Application
      $word.Visible = $false
      try {
        $doc = $word.Documents.Open('${file}')
        Write-Output $doc.Content.Text
        $doc.Close()
      } finally {
        $word.Quit()
      }
    `);
    expect(out).toContain('Round trip');
    expect(out).toContain('Body text works.');
  });

  run('Excel opens the generated .xlsx and reads cells back', { timeout: 120_000 }, () => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'roundtrip.xlsx');
    writeFileSync(
      file,
      buildXlsx({ sheetName: 'Sales', headers: ['Item', 'Qty'], rows: [['Widget', 3]] }),
    );

    const out = ps(`
      $ErrorActionPreference = 'Stop'
      $excel = New-Object -ComObject Excel.Application
      $excel.Visible = $false
      $excel.DisplayAlerts = $false
      try {
        $book = $excel.Workbooks.Open('${file}')
        $sheet = $book.Worksheets.Item(1)
        Write-Output ("SHEET=" + $sheet.Name)
        Write-Output ("A1=" + $sheet.Cells.Item(1,1).Text)
        Write-Output ("B2=" + $sheet.Cells.Item(2,2).Text)
        $book.Close($false)
      } finally {
        $excel.Quit()
      }
    `);
    expect(out).toContain('SHEET=Sales');
    expect(out).toContain('A1=Item');
    expect(out).toContain('B2=3');
  });

  run(
    'readExcelSheet reads a generated workbook back as a table',
    { timeout: 180_000 },
    async () => {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'read-back.xlsx');
      writeFileSync(
        file,
        buildXlsx({
          sheetName: 'Inventory',
          headers: ['Item', 'Qty'],
          rows: [
            ['Widget', 3],
            ['Gadget, large', 2],
          ],
        }),
      );

      const skill = new OfficeSkill({ mockMode: false });
      const result = await skill.execute('readExcelSheet', { filePath: file });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        headers: ['Item', 'Qty'],
        rows: [
          ['Widget', '3'],
          ['Gadget, large', '2'],
        ],
      });
    },
  );

  run('reads a .docx written by Word itself', { timeout: 120_000 }, () => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'word-written.docx');
    ps(`
      $ErrorActionPreference = 'Stop'
      $word = New-Object -ComObject Word.Application
      $word.Visible = $false
      try {
        $doc = $word.Documents.Add()
        $doc.Content.Text = 'Written by Word. Second sentence.'
        $doc.SaveAs2('${file}', 16)
        $doc.Close()
      } finally {
        $word.Quit()
      }
    `);

    const text = extractDocxText(readFileSync(file));
    expect(text).toContain('Written by Word.');
    expect(text).toContain('Second sentence.');
  });
});
