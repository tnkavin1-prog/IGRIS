/**
 * Element registry: maps stable, model-friendly identifiers ("element_012")
 * to live DOM nodes. References are validated on every use, so a ref that
 * outlived its element fails loudly instead of clicking the wrong thing.
 */
import { ERROR_CODES, ToolError } from '@gbl/shared';
import { isVisible } from './dom.js';

const MAX_ENTRIES = 2_500;

export class ElementRegistry {
  private readonly byRef = new Map<string, Element>();
  private readonly byElement = new WeakMap<Element, string>();
  private counter = 0;
  /** Increments on navigation and on registry resets. */
  private version = 1;

  get generation(): number {
    return this.version;
  }

  get size(): number {
    return this.byRef.size;
  }

  refFor(element: Element): string {
    const existing = this.byElement.get(element);
    if (existing && this.byRef.get(existing) === element) return existing;

    if (this.byRef.size >= MAX_ENTRIES) this.reset();

    const ref = `element_${String(++this.counter).padStart(3, '0')}`;
    this.byRef.set(ref, element);
    this.byElement.set(element, ref);
    return ref;
  }

  /**
   * Resolve a reference and assert the element is still usable.
   * Throws ELEMENT_STALE / ELEMENT_NOT_VISIBLE with recovery guidance.
   */
  resolve(ref: string): Element {
    const element = this.byRef.get(ref);
    if (!element) {
      throw new ToolError(
        ERROR_CODES.ELEMENT_STALE,
        `Element reference "${ref}" is not registered. The page may have navigated or reloaded.`,
        { hint: 'Call get_page_snapshot to obtain current element references.', retryable: true },
      );
    }
    if (!element.isConnected) {
      this.byRef.delete(ref);
      throw new ToolError(
        ERROR_CODES.ELEMENT_STALE,
        `Element "${ref}" was removed from the page.`,
        { hint: 'Call get_page_snapshot again before acting.', retryable: true },
      );
    }
    if (!isVisible(element)) {
      throw new ToolError(
        ERROR_CODES.ELEMENT_NOT_VISIBLE,
        `Element "${ref}" is not visible right now.`,
        {
          hint: 'Scroll it into view or dismiss any overlay, then re-read the page.',
          retryable: true,
        },
      );
    }
    return element;
  }

  has(ref: string): boolean {
    return this.byRef.has(ref);
  }

  /** Drop all references and start a new generation. */
  reset(): void {
    this.byRef.clear();
    this.counter = 0;
    this.version += 1;
  }

  /** Record a page change without invalidating still-connected elements. */
  bump(): void {
    this.version += 1;
  }

  /** Remove references whose elements have been detached. */
  prune(): void {
    for (const [ref, element] of this.byRef) {
      if (!element.isConnected) this.byRef.delete(ref);
    }
  }
}

export const registry = new ElementRegistry();
