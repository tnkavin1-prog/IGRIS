import { describe, expect, it } from 'vitest';
import { sanitizePageResult } from '../../../apps/chrome-extension/src/tools/page.js';

describe('sanitizePageResult', () => {
  it('escapes angle brackets in every string of a content-script reply', () => {
    const result = sanitizePageResult({
      name: '<img src=x>',
      nested: { text: '<script>evil()</script>' },
      list: ['<a>', 7],
    });
    expect(result.name).toBe('\\u003cimg src=x\\u003e');
    expect(result.nested.text).toBe('\\u003cscript\\u003eevil()\\u003c/script\\u003e');
    expect(result.list).toEqual(['\\u003ca\\u003e', 7]);
  });

  it('leaves non-string values untouched', () => {
    const result = sanitizePageResult({ count: 0, ok: false, value: null });
    expect(result).toEqual({ count: 0, ok: false, value: null });
  });
});
