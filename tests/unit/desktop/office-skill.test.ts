import { afterAll, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OfficeSkill } from '../../../apps/desktop-hud/src/main/skills/office.skill.js';

// Keep scratch documents on the repository drive, never on the system drive.
const artifacts = join(process.cwd(), 'tests', '.artifacts');
mkdirSync(artifacts, { recursive: true });
const root = mkdtempSync(join(artifacts, 'office-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const skill = new OfficeSkill({ mockMode: false });
const OOXML_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('OfficeSkill.createWordDoc', () => {
  it('writes a real .docx and verifies its signature', async () => {
    const filePath = join(root, 'nested', 'report.docx');
    const result = await skill.execute('createWordDoc', {
      filePath,
      title: 'Quarterly report',
      content: 'Revenue grew.\nCosts fell.',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ created: true, verified: true, engine: 'ooxml' });
    const bytes = readFileSync(filePath);
    expect(bytes.subarray(0, 4).equals(OOXML_MAGIC)).toBe(true);
    expect(bytes.toString('latin1')).toContain('Quarterly report');
    expect(statSync(filePath).size).toBeGreaterThan(100);
  });

  it('refuses to pretend a .txt is a Word document', async () => {
    const result = await skill.execute('createWordDoc', {
      filePath: join(root, 'note.txt'),
      title: 'T',
      content: 'C',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\.docx/);
  });

  it('requires a file path', async () => {
    const result = await skill.execute('createWordDoc', { title: 'T', content: 'C' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/filePath is required/);
  });
});

describe('OfficeSkill.createExcelSheet', () => {
  it('writes a real .xlsx instead of a CSV', async () => {
    const filePath = join(root, 'sales.xlsx');
    const result = await skill.execute('createExcelSheet', {
      filePath,
      sheetName: 'Sales',
      headers: ['Item', 'Qty'],
      rows: [['Widget', 3]],
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      created: true,
      verified: true,
      rowsCount: 1,
      engine: 'ooxml',
    });
    const bytes = readFileSync(filePath);
    expect(bytes.subarray(0, 4).equals(OOXML_MAGIC)).toBe(true);
    const text = bytes.toString('latin1');
    expect(text).toContain('Sales');
    expect(text).toContain('Widget');
  });

  it('refuses a .csv target', async () => {
    const result = await skill.execute('createExcelSheet', {
      filePath: join(root, 'sales.csv'),
      headers: ['a'],
      rows: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\.xlsx/);
  });

  it('reads a generated workbook back without Excel installed', async () => {
    const filePath = join(root, 'read-back.xlsx');
    await skill.execute('createExcelSheet', {
      filePath,
      sheetName: 'Inventory',
      headers: ['Item', 'Qty'],
      rows: [
        ['Widget', 3],
        ['Gadget, large', 2],
      ],
    });

    const result = await skill.execute('readExcelSheet', { filePath });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ engine: 'ooxml', rowsCount: 2 });
    expect(result.data).toMatchObject({
      headers: ['Item', 'Qty'],
      rows: [
        ['Widget', '3'],
        ['Gadget, large', '2'],
      ],
    });
  });
});

describe('OfficeSkill verification', () => {
  it('only verifies file-producing actions when the file was checked', async () => {
    await expect(
      skill.verify('createWordDoc', { success: true, data: { created: true } }),
    ).resolves.toBe(true);
    await expect(
      skill.verify('createWordDoc', { success: true, data: { created: true, verified: true } }),
    ).resolves.toBe(true);
    await expect(skill.verify('createWordDoc', { success: false })).resolves.toBe(false);
    await expect(skill.verify('createWordDoc', { success: true, data: {} })).resolves.toBe(false);
  });

  it('reports the generated files as available skills', async () => {
    const actions = skill.getActions().map((action) => action.name);
    expect(actions).toContain('createWordDoc');
    expect(actions).toContain('createExcelSheet');
    expect(actions).toContain('createPdf');
    expect(actions).toContain('createPowerPoint');
  });
});
