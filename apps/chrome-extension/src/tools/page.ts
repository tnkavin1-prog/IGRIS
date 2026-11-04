/**
 * Messaging with the on-demand content script.
 *
 * The side panel injects `content-script.js` only when needed. If the tab
 * navigates, the old content world is destroyed; the next operation re-injects
 * automatically, which is why a stale reference fails loudly instead of
 * clicking something unrelated.
 */
import {
  ERROR_CODES,
  ToolError,
  escapeUntrustedStrings,
  isScriptableUrl,
  type ContentResult,
  type PageOp,
  type PageOpRequest,
  type PingResult,
} from '@gbl/shared';

const OP_TIMEOUT_MS = 22_000;
const INJECT_FILES = ['content-script.js'];

/**
 * Content-script replies are page data. Escape every string before the
 * executor sees it so a hostile DOM cannot forge prompt tags in fields that
 * never pass through `frameUntrustedPageText` — element names, table cells,
 * link text, form labels. Escaping is idempotent, so the later text frame
 * still surrounds the data rather than being escaped itself.
 */
export function sanitizePageResult<T>(value: T): T {
  return escapeUntrustedStrings(value);
}

export class PageBridge {
  constructor(readonly tabId: number) {}

  async ensure(tabUrl?: string): Promise<PingResult> {
    if (tabUrl && !isScriptableUrl(tabUrl)) {
      throw new ToolError(
        ERROR_CODES.PAGE_NOT_SCRIPTABLE,
        'Chrome does not allow extensions to script this page.',
        {
          hint: 'Open a normal http(s) website instead of chrome://, the Web Store, or a protected page.',
          retryable: false,
        },
      );
    }
    try {
      const ping = await this.send<PingResult>({ type: 'GBL_CONTENT_OP', op: 'ping' });
      if (ping?.alive) return ping;
    } catch {
      /* inject below */
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        files: INJECT_FILES,
        injectImmediately: true,
      });
    } catch (error) {
      const message = (error as Error).message || '';
      if (/cannot access|permission|not allowed|chrome:\/\//i.test(message)) {
        throw new ToolError(
          ERROR_CODES.PAGE_NOT_SCRIPTABLE,
          'The extension cannot access this tab. Chrome protects this page or site access was not granted.',
          {
            hint: 'Open a normal website, or reload the extension and try again.',
            retryable: false,
          },
        );
      }
      if (/no tab|tab was closed/i.test(message)) {
        throw new ToolError(ERROR_CODES.TAB_GONE, 'The target tab no longer exists.', {
          hint: 'List the open tabs and choose another.',
          retryable: false,
        });
      }
      throw new ToolError(ERROR_CODES.INTERNAL, `Could not inject the page agent: ${message}`, {
        retryable: true,
      });
    }

    try {
      return await this.send<PingResult>({ type: 'GBL_CONTENT_OP', op: 'ping' });
    } catch {
      throw new ToolError(
        ERROR_CODES.PAGE_NOT_SCRIPTABLE,
        'The page agent did not start. The page may be loading or protected.',
        { hint: 'Wait for the page to finish loading, then retry.', retryable: true },
      );
    }
  }

  async op<T>(op: PageOp, args: Record<string, unknown> = {}): Promise<T> {
    const request: PageOpRequest = { type: 'GBL_CONTENT_OP', op, args };
    let result: ContentResult;
    try {
      result = await this.send<ContentResult>(request);
    } catch (error) {
      // A navigation can tear down the message channel mid-response. Retry
      // once after re-injection; if the new document is ready, the operation
      // will fail on its own terms (usually a stale ref), which is honest.
      if (!isChannelError(error)) throw error;
      await this.ensure();
      result = await this.send<ContentResult>(request);
    }

    if (!result || result.ok !== true) {
      const detail = result?.error;
      throw new ToolError(
        (detail?.code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES]) ?? ERROR_CODES.INTERNAL,
        detail?.message ?? 'The page operation failed.',
        {
          ...(detail?.hint ? { hint: detail.hint } : {}),
          retryable: true,
        },
      );
    }
    return sanitizePageResult(result.data as T);
  }

  private async send<T>(
    message: PageOpRequest | { type: 'GBL_CONTENT_OP'; op: PageOp },
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new ToolError(ERROR_CODES.TOOL_TIMEOUT, 'The page did not respond in time.', {
            hint: 'Re-observe the page before retrying.',
            retryable: true,
          }),
        );
      }, OP_TIMEOUT_MS);
    });
    const request = chrome.tabs.sendMessage(this.tabId, message) as Promise<T>;
    return Promise.race([request, timeout]);
  }
}

export function isChannelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /message port closed|receiving end does not exist|could not establish connection|context invalidated|extension context/i.test(
    message,
  );
}

export function isNavigationError(error: unknown): boolean {
  if (isChannelError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /navigat|document was unloaded|frame was removed/i.test(message);
}
