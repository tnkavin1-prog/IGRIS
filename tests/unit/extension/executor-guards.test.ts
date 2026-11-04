import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ToolError } from '@gbl/shared';
import { assertPreparedPage } from '../../../apps/chrome-extension/src/tools/executor.js';

function thrown(fn: () => void): ToolError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('Expected the guard to throw.');
}

const PREP = {
  tabId: 12,
  pageUrl: 'https://example.com/checkout',
  documentId: 'doc-abc',
};

describe('assertPreparedPage', () => {
  it('accepts the exact tab, URL, and document that was approved', () => {
    expect(() =>
      assertPreparedPage(PREP, { id: 12, url: 'https://example.com/checkout' }, 'doc-abc'),
    ).not.toThrow();
  });

  it('does nothing when the tool was never prepared against a tab', () => {
    expect(() =>
      assertPreparedPage(undefined, { id: 1, url: 'https://other.test/' }, 'x'),
    ).not.toThrow();
    expect(() =>
      assertPreparedPage({ tabId: undefined }, { id: 1, url: 'https://other.test/' }),
    ).not.toThrow();
  });

  it('rejects a different tab id with TAB_GONE', () => {
    const error = thrown(() =>
      assertPreparedPage(PREP, { id: 99, url: 'https://example.com/checkout' }, 'doc-abc'),
    );
    expect(error.code).toBe(ERROR_CODES.TAB_GONE);
    expect(error.retryable).toBe(true);
  });

  it('rejects a different URL with ELEMENT_STALE', () => {
    const error = thrown(() =>
      assertPreparedPage(PREP, { id: 12, url: 'https://example.com/other' }, 'doc-abc'),
    );
    expect(error.code).toBe(ERROR_CODES.ELEMENT_STALE);
  });

  it('rejects a same-URL reload because the document id changed', () => {
    const error = thrown(() =>
      assertPreparedPage(PREP, { id: 12, url: 'https://example.com/checkout' }, 'doc-new'),
    );
    expect(error.code).toBe(ERROR_CODES.ELEMENT_STALE);
    expect(error.hint).toContain('previous document');
  });

  it('skips the document check when the caller cannot read a live DOM', () => {
    expect(() =>
      assertPreparedPage(PREP, { id: 12, url: 'https://example.com/checkout' }),
    ).not.toThrow();
  });

  it('treats a missing tab URL as a mismatch when a URL was approved', () => {
    const error = thrown(() => assertPreparedPage(PREP, { id: 12, url: undefined }, 'doc-abc'));
    expect(error.code).toBe(ERROR_CODES.ELEMENT_STALE);
  });
});
