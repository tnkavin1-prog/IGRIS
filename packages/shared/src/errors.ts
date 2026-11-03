/**
 * Shared error taxonomy. Codes are stable and machine-readable so the agent
 * can choose a recovery strategy (re-observe, re-ground, ask the user) rather
 * than retrying blindly.
 */

export const ERROR_CODES = {
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  ELEMENT_STALE: 'ELEMENT_STALE',
  ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
  ELEMENT_DISABLED: 'ELEMENT_DISABLED',
  SENSITIVE_FIELD: 'SENSITIVE_FIELD',
  URL_BLOCKED: 'URL_BLOCKED',
  INVALID_ARGS: 'INVALID_ARGS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PERMISSION_MISSING: 'PERMISSION_MISSING',
  PAGE_NOT_SCRIPTABLE: 'PAGE_NOT_SCRIPTABLE',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT',
  TIMEOUT: 'TIMEOUT',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  USER_DENIED: 'USER_DENIED',
  CANCELLED: 'CANCELLED',
  TAB_GONE: 'TAB_GONE',
  NO_ACTIVE_TAB: 'NO_ACTIVE_TAB',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  BRIDGE_UNAVAILABLE: 'BRIDGE_UNAVAILABLE',
  BRIDGE_UNAUTHORIZED: 'BRIDGE_UNAUTHORIZED',
  SESSION_CLOSED: 'SESSION_CLOSED',
  UNSUPPORTED_MODEL: 'UNSUPPORTED_MODEL',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class ToolError extends Error {
  readonly code: ErrorCode;
  /** Actionable next step for the model. */
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { hint?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
  }

  toResponse(): { error: { code: ErrorCode; message: string; hint?: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

/**
 * Recovery guidance returned to the model with failures. This is what turns a
 * dead end into a re-observation step.
 */
export const RECOVERY_HINTS: Partial<Record<ErrorCode, string>> = {
  ELEMENT_NOT_FOUND:
    'Call get_page_snapshot to refresh the page and use a current element reference.',
  ELEMENT_STALE:
    'The page changed and the reference expired. Call get_page_snapshot again before acting.',
  ELEMENT_NOT_VISIBLE:
    'Scroll the element into view with scroll_to_element, or re-read the page; the element may be behind a dialog.',
  ELEMENT_DISABLED:
    'The control is disabled. Look for a prerequisite field, a consent checkbox, or a loading state.',
  SENSITIVE_FIELD:
    'Password, one-time-code, and payment fields are blocked by policy. Ask the user to complete it themselves.',
  URL_BLOCKED: 'Only http and https destinations are allowed. Use a normal web URL.',
  PAGE_NOT_SCRIPTABLE:
    'Chrome does not allow extensions to script this page (chrome://, the Web Store, or a protected surface). Open a normal website instead.',
  PERMISSION_MISSING:
    'The user must grant site access from the side panel before this page can be inspected.',
  NAVIGATION_TIMEOUT:
    'The page did not finish loading. It may still be loading; inspect the URL and try a shorter wait.',
  TIMEOUT:
    'The condition never became true. Re-read the page and confirm the expected text or element exists.',
  TOOL_TIMEOUT: 'The browser operation exceeded its deadline. Re-observe before retrying.',
  TAB_GONE: 'The target tab was closed. List tabs and pick another.',
  QUOTA_EXCEEDED:
    'The Gemini free-tier quota is exhausted. Wait for the retry window or change the model; do not retry immediately.',
  BRIDGE_UNAVAILABLE:
    'The local bridge is not running. The user must start it; do not repeat browser actions.',
};
