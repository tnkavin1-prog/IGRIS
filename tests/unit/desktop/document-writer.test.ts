import { describe, it, expect } from 'vitest';
import {
  OOXML_MAGIC,
  buildDocx,
  buildXlsx,
  columnName,
  crc32,
  createZip,
  escapeXml,
} from '../../../apps/desktop-hud/src/main/document-writer.js';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

function asText(buffer: Buffer): string {
  return buffer.toString('latin1');
}

/** Count the entries recorded in the EOCD record. */
function entryCount(buffer: Buffer): number {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return buffer.readUInt16LE(eocd + 10);
}

describe('crc32', () => {
  it('matches the canonical check value', () => {
    expect(crc32(Buffer.from('123456789', 'utf8'))).toBe(0xcbf43926);
  });

  it('is stable for repeated input', () => {
    const data = Buffer.from('hello world', 'utf8');
    expect(crc32(data)).toBe(crc32(data));
  });
});

describe('createZip', () => {
  it('writes a local header, the stored payload and an end record', () => {
    const archive = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.txt', data: 'world' },
    ]);

    expect(archive.subarray(0, 4).equals(OOXML_MAGIC)).toBe(true);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(END_OF_CENTRAL_DIRECTORY);
    expect(entryCount(archive)).toBe(2);
    // The stored payload is present verbatim.
    expect(asText(archive)).toContain('hello');
    expect(asText(archive)).toContain('world');
    // Both names appear in the local and central directory records.
    expect(asText(archive).match(/a\.txt/g)).toHaveLength(2);
  });

  it('accepts bytes as well as strings', () => {
    const archive = createZip([{ name: 'bin', data: Buffer.from([1, 2, 3]) }]);
    expect(entryCount(archive)).toBe(1);
  });

  it('records the real payload length in the local header', () => {
    const archive = createZip([{ name: 'x', data: 'abcd' }]);
    // local header: 30 bytes of metadata, then name length
    const nameLength = archive.readUInt16LE(26);
    expect(nameLength).toBe(1);
    expect(archive.readUInt32LE(18)).toBe(4); // compressed size
    expect(archive.readUInt32LE(22)).toBe(4); // uncompressed size
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });
});

describe('buildDocx', () => {
  it('produces a valid-looking OOXML archive with the required parts', () => {
    const docx = buildDocx({ title: 'Quarterly report', content: 'First line\nSecond line' });
    const text = asText(docx);

    expect(docx.subarray(0, 4).equals(OOXML_MAGIC)).toBe(true);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('wordprocessingml/2006/main');
    expect(text).toContain('Quarterly report');
    expect(text).toContain('First line');
    expect(text).toContain('Second line');
  });

  it('escapes markup in the document text instead of injecting XML', () => {
    const docx = buildDocx({ title: 'A & B', content: '<script>alert(1)</script>' });
    const text = asText(docx);
    expect(text).toContain('A &amp; B');
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(text).not.toContain('<script>');
  });

  it('turns each non-empty line into its own paragraph and keeps blank lines', () => {
    const docx = buildDocx({ title: 'T', content: 'one\n\ntwo' });
    const text = asText(docx);
    expect(text.match(/<w:p>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('<w:p/>');
  });

  it('strips control characters that would make the XML invalid', () => {
    const docx = buildDocx({ title: 'T', content: 'bad\u0000byte' });
    expect(asText(docx)).toContain('badbyte');
  });
});

describe('columnName', () => {
  it('maps indexes to spreadsheet labels', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
  });
});

describe('buildXlsx', () => {
  const workbook = buildXlsx({
    sheetName: 'Sales',
    headers: ['Item', 'Qty', 'Price'],
    rows: [
      ['Widget', 3, 9.5],
      ['Gadget', 2, true],
    ],
  });
  const text = asText(workbook);

  it('produces a valid-looking OOXML archive with workbook parts', () => {
    expect(workbook.subarray(0, 4).equals(OOXML_MAGIC)).toBe(true);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('xl/workbook.xml');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('xl/styles.xml');
    expect(text).toContain('spreadsheetml/2006/main');
  });

  it('names the sheet and escapes it', () => {
    const escaped = buildXlsx({ sheetName: 'A&B', headers: ['h'], rows: [] });
    expect(asText(escaped)).toContain('A&amp;B');
    expect(text).toContain('name="Sales"');
  });

  it('writes headers and rows into the right cells', () => {
    expect(text).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Item</t></is></c>');
    expect(text).toContain('<c r="B1" t="inlineStr"><is><t xml:space="preserve">Qty</t></is></c>');
    expect(text).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">Widget</t></is></c>',
    );
    expect(text).toContain('<c r="B2"><v>3</v></c>');
    expect(text).toContain('<c r="C2"><v>9.5</v></c>');
    expect(text).toContain('<c r="C3" t="b"><v>1</v></c>');
  });

  it('omits empty cells but keeps column alignment', () => {
    const sparse = asText(buildXlsx({ headers: ['a', '', 'c'], rows: [] }));
    expect(sparse).toContain('r="A1"');
    expect(sparse).toContain('r="C1"');
    expect(sparse).not.toContain('r="B1"');
  });

  it('escapes string cell content', () => {
    const dangerous = asText(buildXlsx({ headers: ['<b>'], rows: [['&']] }));
    expect(dangerous).toContain('&lt;b&gt;');
    expect(dangerous).toContain('<t xml:space="preserve">&amp;</t>');
  });
});
