import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfReader } from '../../../apps/desktop-hud/src/main/pdf-reader.js';

/**
 * The PDF reader turns a document into text the model can reason about.
 * Without it the only way to "read" a PDF was to photograph it.
 */

/** Build a small but valid PDF with a single text object. */
function writeSamplePdf(path: string, text: string): void {
  const content = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
  writeFileSync(path, pdf, 'latin1');
}

describe('PdfReader', () => {
  it('extracts the text layer of a PDF', async () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'pdf-reader-'));
    const file = join(dir, 'sample.pdf');
    writeSamplePdf(file, 'Gemetron PDF text layer check');
    try {
      const result = await new PdfReader().read(file);
      expect(result.ok).toBe(true);
      expect(result.pageCount).toBe(1);
      expect(result.text).toContain('Gemetron PDF text layer check');
      expect(result.pages[0]?.page).toBe(1);
      expect(result.scanned).toBe(false);
      expect(result.truncated).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing file instead of throwing', async () => {
    const result = await new PdfReader().read('E:\\definitely\\missing\\file.pdf');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not read');
    expect(result.text).toBe('');
  });

  it('reports a file that is not a PDF instead of throwing', async () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'pdf-reader-'));
    const file = join(dir, 'broken.pdf');
    writeFileSync(file, 'this is not a pdf', 'utf8');
    try {
      const result = await new PdfReader().read(file);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours the page and character limits', async () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'pdf-reader-'));
    const file = join(dir, 'sample.pdf');
    writeSamplePdf(file, 'Gemetron PDF text layer check');
    try {
      const result = await new PdfReader().read(file, { maxPages: 1, maxChars: 500 });
      expect(result.ok).toBe(true);
      expect(result.pages.length).toBeLessThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
