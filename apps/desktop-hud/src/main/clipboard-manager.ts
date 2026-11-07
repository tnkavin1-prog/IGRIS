import { clipboard } from 'electron';
import { EventEmitter } from 'node:events';

export interface ClipboardServiceOptions {
  mockMode?: boolean;
}

/**
 * OS Native Clipboard Management Service
 * Wraps Electron clipboard with robust fallbacks and in-memory mock mode for headless testing.
 */
export class ClipboardService extends EventEmitter {
  private mockMode: boolean;
  private mockText = '';
  private mockHtml = '';

  constructor(options: ClipboardServiceOptions = {}) {
    super();
    // Default to mockMode if not in Electron environment
    this.mockMode =
      options.mockMode ??
      (typeof clipboard === 'undefined' || typeof clipboard.readText !== 'function');
  }

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  public get isMockMode(): boolean {
    return this.mockMode;
  }

  /**
   * Reads plain text from clipboard
   */
  public readText(): string {
    if (this.mockMode) {
      return this.mockText;
    }
    try {
      return clipboard.readText();
    } catch {
      return this.mockText;
    }
  }

  /**
   * Writes plain text to clipboard
   */
  public writeText(text: string): boolean {
    const val = String(text ?? '');
    this.mockText = val;
    if (!this.mockMode) {
      try {
        clipboard.writeText(val);
      } catch {
        // Fallback gracefully
      }
    }
    this.emit('text-changed', val);
    return true;
  }

  /**
   * Checks whether clipboard currently has non-empty text
   */
  public hasText(): boolean {
    const txt = this.readText();
    return Boolean(txt && txt.trim().length > 0);
  }

  /**
   * Reads HTML markup from clipboard
   */
  public readHtml(): string {
    if (this.mockMode) {
      return this.mockHtml;
    }
    try {
      return clipboard.readHTML();
    } catch {
      return this.mockHtml;
    }
  }

  /**
   * Writes HTML markup to clipboard
   */
  public writeHtml(html: string): boolean {
    const val = String(html ?? '');
    this.mockHtml = val;
    if (!this.mockMode) {
      try {
        clipboard.writeHTML(val);
      } catch {
        // Fallback gracefully
      }
    }
    this.emit('html-changed', val);
    return true;
  }

  /**
   * Clears all clipboard content
   */
  public clear(): void {
    this.mockText = '';
    this.mockHtml = '';
    if (!this.mockMode) {
      try {
        clipboard.clear();
      } catch {
        // Fallback gracefully
      }
    }
    this.emit('cleared');
  }

  /**
   * Direct inspection of in-memory mock buffer (for testing and verification)
   */
  public getMockBuffer(): { text: string; html: string } {
    return { text: this.mockText, html: this.mockHtml };
  }

  /**
   * Direct setter for mock buffer
   */
  public setMockBuffer(data: { text?: string; html?: string }): void {
    if (data.text !== undefined) this.mockText = data.text;
    if (data.html !== undefined) this.mockHtml = data.html;
  }
}
