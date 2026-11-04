/**
 * Content-script entrypoint.
 *
 * The side panel injects this file on demand (chrome.scripting.executeScript)
 * and then speaks the small `GBL_CONTENT_OP` protocol. The script is idempotent:
 * re-injection after an SPA navigation reuses the existing listener.
 *
 * Only the top frame is injected. Same-origin iframes and open shadow roots are
 * traversed by the DOM collector; cross-origin frames are intentionally
 * inaccessible and the model is told about that limitation.
 */
import {
  ERROR_CODES,
  PRODUCT_VERSION,
  ToolError,
  type ContentResult,
  type PageOp,
  type PageOpRequest,
  type TargetLocator,
} from '@gbl/shared';
import {
  buildSnapshot,
  elementState,
  extractImages,
  extractLinks,
  findText,
  fullText,
  headings,
  pageStructure,
  tableData,
  visibleText,
} from './reader.js';
import {
  focusElement,
  inspectPoint,
  inspectTarget,
  openImageResult,
  performClick,
  performHover,
  pressKey,
  scrollPage,
  scrollToElement,
  selectDropdown,
  setCheckbox,
  submitForm,
  typeText,
  waitForElement,
  waitForText,
} from './interact.js';
import { findCandidates } from './locator.js';
import { describeElement } from './dom.js';
import { fingerprint } from './reader.js';
import { registry } from './registry.js';

declare global {
  interface Window {
    __GBL_CONTENT_SCRIPT__?: { version: string; startedAt: number };
  }
}

const OPS = new Set<PageOp>([
  'ping',
  'snapshot',
  'visibleText',
  'fullText',
  'headings',
  'links',
  'images',
  'findText',
  'findElement',
  'elementState',
  'structure',
  'table',
  'click',
  'hover',
  'scroll',
  'scrollTo',
  'type',
  'select',
  'checkbox',
  'pressKey',
  'focus',
  'waitForElement',
  'waitForText',
  'submit',
  'pickAt',
  'grabFingerprint',
  'inspectTarget',
  'inspectActive',
  'linkHref',
  'openImageResult',
]);

function argString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function argNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function argBoolean(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function locatorFrom(args: Record<string, unknown>): TargetLocator {
  const locator: TargetLocator = {};
  const ref = argString(args, 'ref');
  const text = argString(args, 'text') ?? argString(args, 'target');
  const role = argString(args, 'role');
  const label = argString(args, 'label');
  const name = argString(args, 'name');
  if (ref) locator.ref = ref;
  if (text) locator.text = text;
  if (role) locator.role = role;
  if (label) locator.label = label;
  if (name) locator.name = name;
  if (typeof args.index === 'number' && Number.isFinite(args.index)) {
    locator.index = Math.max(0, Math.trunc(args.index));
  }
  if (!locator.ref && !locator.text && !locator.role && !locator.label && !locator.name) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGS,
      'A target is required: pass a ref, text, label, or role.',
      { hint: 'Call get_page_snapshot to obtain element references.', retryable: true },
    );
  }
  return locator;
}

async function dispatch(op: PageOp, args: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case 'ping':
      return {
        alive: true,
        version: PRODUCT_VERSION,
        url: location.href,
        generation: registry.generation,
      };

    case 'snapshot':
      return buildSnapshot({
        maxTextChars: argNumber(args, 'maxTextChars', 6_000, 200, 12_000),
        maxElements: argNumber(args, 'maxElements', 80, 5, 150),
      });

    case 'visibleText':
      return visibleText(argNumber(args, 'maxChars', 8_000, 200, 20_000));

    case 'fullText':
      return fullText(argNumber(args, 'maxChars', 20_000, 500, 30_000));

    case 'headings':
      return headings();

    case 'links': {
      const query = argString(args, 'query');
      return extractLinks(query, argNumber(args, 'limit', 40, 1, 100));
    }

    case 'images':
      return extractImages(argNumber(args, 'limit', 30, 1, 60));

    case 'findText': {
      const query = argString(args, 'query');
      if (!query) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'A search query is required.', {
          retryable: false,
        });
      }
      return findText(query, 8);
    }

    case 'findElement': {
      const locator = locatorFrom(args);
      const matches = findCandidates(locator).slice(0, 10);
      return matches.map(({ element, score }) => ({
        ...describeElement(element, { ref: registry.refFor(element) }),
        score,
      }));
    }

    case 'elementState': {
      const ref = argString(args, 'ref');
      if (!ref) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'An element ref is required.', {
          retryable: false,
        });
      }
      return elementState(ref);
    }

    case 'structure':
      return pageStructure();

    case 'table':
      return tableData(
        argNumber(args, 'tableIndex', 0, 0, 50),
        argNumber(args, 'maxRows', 40, 1, 200),
      );

    case 'click':
      return performClick({ locator: locatorFrom(args) });

    case 'hover':
      return performHover(locatorFrom(args));

    case 'scroll': {
      const direction = argString(args, 'direction') ?? 'down';
      if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
        throw new ToolError(
          ERROR_CODES.INVALID_ARGS,
          'Direction must be up, down, top, or bottom.',
          {
            retryable: false,
          },
        );
      }
      return scrollPage(
        direction as 'up' | 'down' | 'top' | 'bottom',
        argNumber(args, 'amount', 700, 100, 5_000),
      );
    }

    case 'scrollTo':
      return scrollToElement(locatorFrom(args));

    case 'type': {
      const text = typeof args.text === 'string' ? args.text : '';
      return typeText({
        locator: locatorFrom(args),
        text,
        clearFirst: argBoolean(args, 'clearFirst', true),
      });
    }

    case 'select': {
      const option = argString(args, 'option');
      if (!option) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'An option is required.', {
          retryable: false,
        });
      }
      return selectDropdown(locatorFrom(args), option);
    }

    case 'checkbox':
      return setCheckbox(locatorFrom(args), argBoolean(args, 'checked', true));

    case 'pressKey': {
      const key = argString(args, 'key');
      if (!key) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'A key name is required.', {
          retryable: false,
        });
      }
      const hasLocator = Boolean(
        args.ref || args.text || args.target || args.label || args.role || args.name,
      );
      return pressKey(hasLocator ? locatorFrom(args) : undefined, key);
    }

    case 'focus':
      return focusElement(locatorFrom(args));

    case 'waitForElement': {
      const target = argString(args, 'target') ?? argString(args, 'text');
      if (!target) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'A target description is required.', {
          retryable: false,
        });
      }
      return waitForElement({ text: target }, argNumber(args, 'timeoutMs', 8_000, 500, 20_000));
    }

    case 'waitForText': {
      const text = argString(args, 'text');
      if (!text) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'Text to wait for is required.', {
          retryable: false,
        });
      }
      return waitForText(text, argNumber(args, 'timeoutMs', 8_000, 500, 20_000));
    }

    case 'submit':
      return submitForm(locatorFrom(args));

    case 'pickAt':
      return inspectPoint(argNumber(args, 'x', 0, 0, 100_000), argNumber(args, 'y', 0, 0, 100_000));

    case 'grabFingerprint':
      return fingerprint();

    case 'inspectTarget':
      return inspectTarget(locatorFrom(args));

    case 'inspectActive': {
      const active = document.activeElement;
      if (!active || active === document.body) {
        throw new ToolError(ERROR_CODES.ELEMENT_NOT_FOUND, 'No element is focused on the page.', {
          hint: 'Focus a field with focus_element, or pass a ref.',
          retryable: true,
        });
      }
      return inspectTarget({ ref: registry.refFor(active) });
    }

    case 'linkHref': {
      const element = inspectTarget(locatorFrom(args)).target;
      const raw = registry.resolve(element.ref);
      const anchor = raw.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) {
        throw new ToolError(ERROR_CODES.INVALID_ARGS, 'The target is not a link.', {
          hint: 'Pass the ref of an <a> element or use an explicit URL.',
          retryable: false,
        });
      }
      return { url: anchor.href };
    }

    case 'openImageResult':
      return openImageResult(argNumber(args, 'index', 0, 0, 60));

    default:
      throw new ToolError(ERROR_CODES.INVALID_ARGS, `Unknown page operation: ${String(op)}`, {
        retryable: false,
      });
  }
}

function errorResult(error: unknown): ContentResult {
  if (error instanceof ToolError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: { code: ERROR_CODES.INTERNAL, message: message.slice(0, 400) },
  };
}

async function handleRequest(message: PageOpRequest): Promise<ContentResult> {
  if (!message || message.type !== 'GBL_CONTENT_OP') {
    return errorResult(new ToolError(ERROR_CODES.INVALID_ARGS, 'Unsupported message.', {}));
  }
  if (!OPS.has(message.op)) {
    return errorResult(
      new ToolError(ERROR_CODES.INVALID_ARGS, `Unsupported page operation: ${message.op}`, {}),
    );
  }
  const args =
    message.args && typeof message.args === 'object' && !Array.isArray(message.args)
      ? message.args
      : {};
  try {
    const data = await dispatch(message.op, args);
    return { ok: true, data };
  } catch (error) {
    return errorResult(error);
  }
}

function install(): void {
  if (window.__GBL_CONTENT_SCRIPT__) return;
  window.__GBL_CONTENT_SCRIPT__ = { version: PRODUCT_VERSION, startedAt: Date.now() };

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    // Only this extension may drive the page agent. Chrome already blocks web
    // pages without `externally_connectable`; checking the sender id keeps the
    // boundary explicit if that ever changes.
    if (sender?.id && sender.id !== chrome.runtime.id) return false;
    const request = message as PageOpRequest;
    if (request.type !== 'GBL_CONTENT_OP') return false;
    void handleRequest(request)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse(errorResult(error)));
    return true; // async response
  });

  // SPA navigation: references from the previous document are meaningless.
  let lastUrl = location.href;
  window.setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    registry.reset();
  }, 500);

  window.addEventListener('popstate', () => {
    registry.reset();
  });
  window.addEventListener('hashchange', () => {
    registry.bump();
  });

  // Prune detached references in batches; do not invalidate live ones.
  let pruneTimer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(pruneTimer);
    pruneTimer = window.setTimeout(() => registry.prune(), 1_200);
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

install();
