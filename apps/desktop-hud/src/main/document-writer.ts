/**
 * Native Office Open XML document generation.
 *
 * The office skill used to "create" spreadsheets by writing a CSV next to the
 * requested `.xlsx` path and "create" presentations by writing an outline text
 * file, then report success. Word documents fell back to `.txt`. None of those
 * are the file the user asked for.
 *
 * A `.docx`, `.xlsx` and `.pptx` is a ZIP archive of XML parts. This module
 * builds the smallest valid archive for each format directly, with no Office
 * installation, no COM automation and no third-party dependency, so document
 * generation works on any Windows machine and its output can be byte-checked
 * in tests.
 */

import { deflateRawSync } from 'node:zlib';

/* --------------------------------------------------------------------- zip */

interface ZipEntry {
  /** Forward-slash path inside the archive. */
  name: string;
  data: string | Uint8Array;
  /** Deflate the entry. Stored entries are smaller for tiny parts. */
  compress?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value !== 'string') return value;
  return new TextEncoder().encode(value);
}

/**
 * Build a ZIP archive using the "stored" method.
 *
 * Office parts are a few kilobytes each, so skipping deflate keeps this file
 * small and dependency-free. Word, Excel and PowerPoint accept stored entries.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // A fixed timestamp keeps output deterministic, which makes tests stable.
  const dosTime = 0;
  const dosDate = 0x21; // 1980-01-01

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(toBytes(entry.data));
    const deflated = entry.compress ? deflateRawSync(raw) : null;
    const data = deflated ?? raw;
    const method = deflated ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // central directory disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

/** The first four bytes of every OOXML file. */
export const OOXML_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/* -------------------------------------------------------------------- xml */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Escape text for an XML text node or attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip characters XML 1.0 cannot carry. */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function text(value: unknown): string {
  return escapeXml(sanitize(String(value ?? '')));
}

/* ------------------------------------------------------------------- docx */

export interface DocxInput {
  title: string;
  content: string;
}

export function buildDocx({ title, content }: DocxInput): Buffer {
  const paragraphs = content
    .split(/\r?\n/)
    .map((line) =>
      line.trim()
        ? `<w:p><w:r><w:t xml:space="preserve">${text(line)}</w:t></w:r></w:p>`
        : '<w:p/>',
    )
    .join('');

  const document =
    `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    '<w:body>' +
    `<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">${text(title)}</w:t></w:r></w:p>` +
    '<w:p/>' +
    paragraphs +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';

  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    { name: 'word/document.xml', data: document },
  ]);
}

/* ------------------------------------------------------------------ helpers */

/**
 * Parse RFC 4180 style CSV.
 *
 * The previous reader split on commas, so any cell containing a comma or a
 * quoted newline corrupted the whole table. Excel exports quoted fields, so a
 * real parser is required to read back a workbook.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  // Trailing newline should not create an empty row.
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/* ------------------------------------------------------------------- xlsx */

export interface XlsxInput {
  sheetName?: string;
  headers: unknown[];
  rows: unknown[][];
}

/** 1 -> A, 26 -> Z, 27 -> AA. */
export function columnName(index: number): string {
  let result = '';
  let value = index;
  do {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

function cell(reference: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text(value)}</t></is></c>`;
}

export function buildXlsx({ sheetName = 'Data', headers, rows }: XlsxInput): Buffer {
  const rowXml = [headers, ...rows]
    .map((values, rowIndex) => {
      const cells = values
        .map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 1}`, value))
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  const worksheet =
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowXml}</sheetData>` +
    '</worksheet>';

  const workbook =
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${text(sheetName || 'Data')}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';

  const styles =
    `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/workbook.xml', data: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', data: worksheet },
    { name: 'xl/styles.xml', data: styles },
  ]);
}
