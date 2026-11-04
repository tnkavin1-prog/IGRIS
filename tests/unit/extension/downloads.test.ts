import { describe, expect, it } from 'vitest';
import { assessDownload } from '../../../apps/chrome-extension/src/tools/downloads.js';

const PDF = 'https://example.com/files/report.pdf';

describe('assessDownload', () => {
  it('allows a normal document download', () => {
    const result = assessDownload({ requestedUrl: PDF });
    expect(result.blocked).toBe(false);
    expect(result.redirect).toBe(false);
    expect(result.resolvedUrl).toBe(PDF);
  });

  it('blocks an executable requested directly', () => {
    const result = assessDownload({ requestedUrl: 'https://example.com/setup.EXE?download=1' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('executable');
  });

  it('blocks a redirect from a document URL to an executable', () => {
    const result = assessDownload({
      requestedUrl: PDF,
      finalUrl: 'https://cdn.evil.test/payload.msi',
    });
    expect(result.blocked).toBe(true);
    expect(result.redirect).toBe(true);
  });

  it('blocks an executable filename served under a document URL', () => {
    const result = assessDownload({
      requestedUrl: PDF,
      finalUrl: PDF,
      filename: 'C:\\Users\\me\\Downloads\\invoice.pdf.exe',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('different name');
  });

  it('blocks every dangerous Chrome classification', () => {
    for (const danger of [
      'dangerous',
      'file',
      'url',
      'content',
      'unwanted',
      'safe_browsing_violation',
      'blocked_by_policy',
    ]) {
      const result = assessDownload({ requestedUrl: PDF, danger });
      expect(result.blocked, danger).toBe(true);
    }
  });

  it('does not block a merely uncommon file or a safe verdict', () => {
    expect(assessDownload({ requestedUrl: PDF, danger: 'uncommon' }).blocked).toBe(false);
    expect(assessDownload({ requestedUrl: PDF, danger: 'safe' }).blocked).toBe(false);
  });

  it('blocks a redirect to a non-web scheme', () => {
    const result = assessDownload({
      requestedUrl: PDF,
      finalUrl: 'file:///C:/Windows/System32/calc.exe',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('non-web');
  });

  it('treats a URL with a different query as a redirect', () => {
    const result = assessDownload({
      requestedUrl: PDF,
      finalUrl: `${PDF}?token=abc`,
    });
    expect(result.blocked).toBe(false);
    expect(result.redirect).toBe(true);
  });

  it('blocks dangerous extensions case-insensitively in the path', () => {
    expect(assessDownload({ requestedUrl: 'https://example.com/A.Ps1' }).blocked).toBe(true);
    expect(assessDownload({ requestedUrl: 'https://example.com/a.jar#x' }).blocked).toBe(true);
  });

  it('allows a document name that merely contains a dangerous word', () => {
    const result = assessDownload({
      requestedUrl: 'https://example.com/executive-summary.pdf',
      filename: 'executive-summary.pdf',
    });
    expect(result.blocked).toBe(false);
  });
});
