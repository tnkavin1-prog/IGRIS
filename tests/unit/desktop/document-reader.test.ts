import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  ZipFormatError,
  decodeXmlEntities,
  extractDocxText,
  readZipEntries,
} from '../../../apps/desktop-hud/src/main/document-reader.js';
import {
  buildDocx,
  buildXlsx,
  createZip,
} from '../../../apps/desktop-hud/src/main/document-writer.js';

describe('readZipEntries', () => {
  it('round trips stored entries', () => {
    const archive = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.txt', data: 'world' },
    ]);
    const entries = readZipEntries(archive);
    expect(entries.get('a.txt')?.toString('utf8')).toBe('hello');
    expect(entries.get('dir/b.txt')?.toString('utf8')).toBe('world');
  });

  it('reads deflated entries', () => {
    const archive = createZip([{ name: 'big.txt', data: 'x'.repeat(4000), compress: true }]);
    const entries = readZipEntries(archive);
    expect(entries.get('big.txt')?.toString('utf8')).toBe('x'.repeat(4000));
    // The stored data really is smaller than the payload.
    expect(archive.length).toBeLessThan(4000);
  });

  it('reads archives written by other tools', () => {
    // A minimal archive built by hand with deflate, as Word/Excel produce it.
    const payload = deflateRawSync(Buffer.from('external', 'utf8'));
    const name = Buffer.from('part.txt', 'utf8');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(7, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(7, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    name.copy(central, 46);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length + payload.length, 16);

    const archive = Buffer.concat([local, payload, central, end]);
    expect(readZipEntries(archive).get('part.txt')?.toString('utf8')).toBe('external');
  });

  it('rejects a file that is not a ZIP archive', () => {
    expect(() => readZipEntries(Buffer.from('not a zip'))).toThrow(ZipFormatError);
  });

  it('rejects a truncated central directory', () => {
    const archive = createZip([{ name: 'a', data: 'b' }]);
    expect(() => readZipEntries(archive.subarray(0, archive.length - 30))).toThrow(ZipFormatError);
  });
});

describe('decodeXmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXmlEntities('&lt;a&gt; &amp; &#65; &#x42; &quot;q&quot; &apos;s&apos;')).toBe(
      '<a> & A B "q" \'s\'',
    );
  });

  it('leaves unknown entities alone', () => {
    expect(decodeXmlEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('extractDocxText', () => {
  it('returns the title and body of a generated document', () => {
    const docx = buildDocx({
      title: 'Quarterly report',
      content: 'Revenue grew.\nCosts fell.',
    });
    const text = extractDocxText(docx);
    expect(text).toContain('Quarterly report');
    expect(text).toContain('Revenue grew.');
    expect(text).toContain('Costs fell.');
    // Paragraphs are separate lines.
    expect(text.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it('restores escaped characters exactly', () => {
    const docx = buildDocx({ title: 'A & B', content: '<tag> "quoted" & \'single\'' });
    const text = extractDocxText(docx);
    expect(text).toContain('A & B');
    expect(text).toContain('<tag> "quoted" & \'single\'');
  });

  it('keeps multiple blank-line-separated paragraphs readable', () => {
    const docx = buildDocx({ title: 'T', content: 'one\n\ntwo\n\n\nthree' });
    const text = extractDocxText(docx);
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).toContain('three');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('rejects an archive without a document part', () => {
    const archive = createZip([{ name: 'other.xml', data: '<x/>' }]);
    expect(() => extractDocxText(archive)).toThrow(/word\/document\.xml/);
  });

  it('rejects a real .xlsx since it is not a Word document', () => {
    const workbook = buildXlsx({ headers: ['a'], rows: [] });
    expect(() => extractDocxText(workbook)).toThrow(/word\/document\.xml/);
  });
});
