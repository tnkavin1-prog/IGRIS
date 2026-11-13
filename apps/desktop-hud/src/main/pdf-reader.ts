/**
 * PDF text extraction.
 *
 * A PDF is the one document type the assistant could not read at all: the
 * only path was a screenshot, so a forty page report became a stream of
 * images for the vision model. This reader pulls the text layer out of the
 * file with a pure-JavaScript engine, so no native build and no extra
 * runtime is required.
 *
 * Scanned documents have no text layer; those are reported as such and the
 * caller can fall back to local OCR on a rendered page.
 */
import { readFile } from 'node:fs/promises';

export interface PdfPageText {
  /** 1-based page number. */
  page: number;
  text: string;
}

export interface PdfDocumentText {
  ok: boolean;
  filePath: string;
  pageCount: number;
  /** Pages that were actually extracted (the reader can stop early). */
  pages: PdfPageText[];
  text: string;
  /** True when the reader stopped before the last page or the text was cut. */
  truncated: boolean;
  /** True when the document has no extractable text (a scanned document). */
  scanned: boolean;
  error?: string;
}

export interface PdfReadOptions {
  /** Maximum number of pages to read. Defaults to 20. */
  maxPages?: number;
  /** Maximum number of characters to return. Defaults to 40 000. */
  maxChars?: number;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_CHARS = 40_000;

/** The part of the pdf.js API this reader uses. */
interface PdfJsLike {
  getDocument: (params: Record<string, unknown>) => { promise: Promise<any> };
}

/**
 * Load the pdf.js engine lazily.
 *
 * The engine is ESM and pulls in a large dependency tree; importing it only
 * when a PDF is actually read keeps the HUD start-up fast.
 */
async function loadPdfjs(): Promise<PdfJsLike> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;
}

export class PdfReader {
  /**
   * Extract the text of a PDF.
   *
   * Never throws: a document that cannot be parsed comes back with `ok:
   * false` and an explanation, because the caller has to report the failure
   * honestly rather than crash the agent.
   */
  async read(filePath: string, options: PdfReadOptions = {}): Promise<PdfDocumentText> {
    const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 500));
    const maxChars = Math.max(500, Math.min(options.maxChars ?? DEFAULT_MAX_CHARS, 500_000));

    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      return {
        ok: false,
        filePath,
        pageCount: 0,
        pages: [],
        text: '',
        truncated: false,
        scanned: false,
        error: `Could not read "${filePath}": ${(error as Error).message}`,
      };
    }

    let pdfjs: Awaited<ReturnType<typeof loadPdfjs>>;
    try {
      pdfjs = await loadPdfjs();
    } catch (error) {
      return {
        ok: false,
        filePath,
        pageCount: 0,
        pages: [],
        text: '',
        truncated: false,
        scanned: false,
        error: `The PDF engine could not be loaded: ${(error as Error).message}`,
      };
    }

    let document: {
      numPages: number;
      getPage: (n: number) => Promise<any> | any;
      destroy?: () => void;
    };
    try {
      const task = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: false,
        disableFontFace: true,
        // Errors are surfaced by this reader; the engine's own warnings (for
        // example a missing standard font) would only pollute the log.
        verbosity: 0,
      });
      document = (await task.promise) as typeof document;
    } catch (error) {
      return {
        ok: false,
        filePath,
        pageCount: 0,
        pages: [],
        text: '',
        truncated: false,
        scanned: false,
        error: `Could not parse "${filePath}": ${(error as Error).message}`,
      };
    }

    const pageCount = document.numPages ?? 0;
    const pages: PdfPageText[] = [];
    let text = '';
    let truncated = pageCount > maxPages;

    try {
      for (let pageNumber = 1; pageNumber <= Math.min(pageCount, maxPages); pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = joinTextItems(content?.items ?? []);
        pages.push({ page: pageNumber, text: pageText });
        if (text.length + pageText.length > maxChars) {
          text += pageText.slice(0, Math.max(0, maxChars - text.length));
          truncated = true;
          break;
        }
        text += pageText;
        page.cleanup?.();
      }
    } catch (error) {
      return {
        ok: false,
        filePath,
        pageCount,
        pages,
        text,
        truncated,
        scanned: false,
        error: `Could not read the text of "${filePath}": ${(error as Error).message}`,
      };
    } finally {
      try {
        document.destroy?.();
      } catch {
        /* the document is already closed */
      }
    }

    const clean = text.trim();
    return {
      ok: true,
      filePath,
      pageCount,
      pages,
      text: clean,
      truncated,
      // A document with pages but no characters is a scan: OCR is the fallback.
      scanned: clean.length === 0 && pageCount > 0,
    };
  }
}

/** Turn the text items of a page into readable text. */
function joinTextItems(
  items: Array<{ str?: string; hasEOL?: boolean; transform?: unknown }>,
): string {
  const parts: string[] = [];
  for (const item of items) {
    const value = typeof item?.str === 'string' ? item.str : '';
    if (!value) continue;
    parts.push(value);
    if (item?.hasEOL) parts.push('\n');
  }
  return parts
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}
