import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClipboardService } from '../../../apps/desktop-hud/src/main/clipboard-manager.js';

describe('ClipboardService', () => {
  let clipboard: ClipboardService;

  beforeEach(() => {
    clipboard = new ClipboardService({ mockMode: true });
  });

  it('initializes with empty text and html in mock mode', () => {
    expect(clipboard.isMockMode).toBe(true);
    expect(clipboard.readText()).toBe('');
    expect(clipboard.readHtml()).toBe('');
    expect(clipboard.hasText()).toBe(false);
  });

  it('writes and reads plain text correctly', () => {
    const textListener = vi.fn();
    clipboard.on('text-changed', textListener);

    const ok = clipboard.writeText('Hello from JARVIS Assistant!');
    expect(ok).toBe(true);
    expect(clipboard.readText()).toBe('Hello from JARVIS Assistant!');
    expect(clipboard.hasText()).toBe(true);
    expect(textListener).toHaveBeenCalledWith('Hello from JARVIS Assistant!');
  });

  it('writes and reads HTML markup correctly', () => {
    const htmlListener = vi.fn();
    clipboard.on('html-changed', htmlListener);

    const markup = '<table><tr><td>Data Column</td></tr></table>';
    const ok = clipboard.writeHtml(markup);
    expect(ok).toBe(true);
    expect(clipboard.readHtml()).toBe(markup);
    expect(htmlListener).toHaveBeenCalledWith(markup);
  });

  it('clears clipboard content and emits cleared event', () => {
    const clearListener = vi.fn();
    clipboard.on('cleared', clearListener);

    clipboard.writeText('Temporary secret');
    clipboard.writeHtml('<b>Temporary</b>');
    expect(clipboard.hasText()).toBe(true);

    clipboard.clear();
    expect(clipboard.readText()).toBe('');
    expect(clipboard.readHtml()).toBe('');
    expect(clipboard.hasText()).toBe(false);
    expect(clearListener).toHaveBeenCalledTimes(1);
  });

  it('supports direct mock buffer manipulation for predictable testing', () => {
    clipboard.setMockBuffer({
      text: 'Pre-seeded clipboard text',
      html: '<span>Pre-seeded HTML</span>',
    });

    expect(clipboard.readText()).toBe('Pre-seeded clipboard text');
    expect(clipboard.readHtml()).toBe('<span>Pre-seeded HTML</span>');
    expect(clipboard.getMockBuffer()).toEqual({
      text: 'Pre-seeded clipboard text',
      html: '<span>Pre-seeded HTML</span>',
    });
  });

  it('allows toggling mockMode dynamically', () => {
    clipboard.setMockMode(false);
    expect(clipboard.isMockMode).toBe(false);

    clipboard.setMockMode(true);
    expect(clipboard.isMockMode).toBe(true);
  });
});
