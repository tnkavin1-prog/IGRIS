/**
 * Reader for ZIP-based Office documents.
 *
 * `read_document` used to open a `.docx` as UTF-8 text, which returns binary
 * noise. A Word document is a ZIP archive, so the archive can be parsed and the
 * document text extracted without Word installed.
 */
import { inflateRawSync } from 'node:zlib';

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_COMMENT = 0xffff;

/** Parse every entry out of a ZIP archive, supporting stored and deflated data. */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  let end = -1;
  const firstPossible = Math.max(0, buffer.length - 22 - MAX_COMMENT);
  for (let offset = buffer.length - 22; offset >= firstPossible; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new ZipFormatError('Not a ZIP archive: the end record is missing.');

  const entryCount = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (directoryOffset + directorySize > buffer.length) {
    throw new ZipFormatError('The central directory points past the end of the file.');
  }

  const entries = new Map<string, Buffer>();
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new ZipFormatError('The central directory is truncated or corrupt.');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER
    ) {
      throw new ZipFormatError(`Entry "${name}" has no local header.`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new ZipFormatError(`Entry "${name}" is truncated.`);
    }
    const payload = buffer.subarray(dataStart, dataEnd);
    if (method === 0) {
      entries.set(name, Buffer.from(payload));
    } else if (method === 8) {
      entries.set(name, inflateRawSync(payload));
    } else {
      throw new ZipFormatError(`Entry "${name}" uses unsupported compression method ${method}.`);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, entity: string) => {
    const named = NAMED_ENTITIES[`&${entity};`];
    if (named !== undefined) return named;
    try {
      if (entity.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    } catch {
      /* fall through to the raw match */
    }
    return match;
  });
}

/**
 * Extract the visible text of a Word document.
 *
 * Paragraph ends become newlines, tabs and manual breaks are preserved, and
 * every remaining tag is dropped. Field codes (`w:instrText`) are excluded
 * because they are instructions, not content.
 */
export function extractDocxText(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) throw new ZipFormatError('The .docx archive has no word/document.xml part.');

  const xml = documentXml.toString('utf8');
  const text = xml
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');

  return decodeXmlEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------- xlsx */

/** A1 -> 0, B1 -> 1, AA1 -> 26. */
export function columnIndexFromName(name: string): number {
  let index = 0;
  for (const char of name.toUpperCase()) {
    const value = char.charCodeAt(0) - 64;
    if (value < 1 || value > 26) continue;
    index = index * 26 + value;
  }
  return index - 1;
}

/** Collect the text of every rich-text run in a shared string. */
function sharedStringText(xml: string): string {
  const parts = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1] ?? '');
  return decodeXmlEntities(parts.join(''));
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    sharedStringText(match[1] ?? ''),
  );
}

function cellValue(inner: string, type: string | undefined, shared: string[]): string {
  if (type === 'inlineStr') {
    return sharedStringText(inner);
  }
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (raw === undefined) return '';
  const value = decodeXmlEntities(raw);
  if (type === 's') {
    const index = Number.parseInt(value, 10);
    return Number.isFinite(index) ? (shared[index] ?? '') : '';
  }
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return value;
}

/**
 * Read the first worksheet of an `.xlsx` workbook as a rectangular table.
 *
 * Excel usually stores strings in `sharedStrings.xml`, so both that table and
 * inline strings are resolved. Cells that are missing keep their column
 * position so rows stay aligned with the header.
 */
export function extractXlsxRows(buffer: Buffer): string[][] {
  const entries = readZipEntries(buffer);
  const worksheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const worksheetName = worksheetNames[0];
  if (!worksheetName) throw new ZipFormatError('The .xlsx archive has no worksheet part.');

  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(sharedEntry.toString('utf8')) : [];
  const xml = entries.get(worksheetName)!.toString('utf8');

  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(
      /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g,
    )) {
      const attributes = cellMatch[1] ?? cellMatch[2] ?? '';
      const inner = cellMatch[3] ?? '';
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const column = reference ? columnIndexFromName(reference) : nextColumn;
      while (cells.length < column) cells.push('');
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      cells[column] = cellValue(inner, type, shared);
      nextColumn = column + 1;
    }
    rows.push(cells);
  }
  // Pad short rows so the result is rectangular and columns stay aligned.
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
}
