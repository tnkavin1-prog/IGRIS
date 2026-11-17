/**
 * Fail-closed trust checks for privileged IPC originating in the HUD renderer.
 *
 * The application loads a local file URL into one BrowserWindow. A trusted
 * invocation must come from that exact WebContents, its top-level frame, and
 * the same local file URL currently displayed by that WebContents.
 */
export interface HudIpcFrameLike {
  readonly url: string;
}

export interface HudIpcWebContentsLike {
  readonly mainFrame: HudIpcFrameLike;
  getURL(): string;
}

export interface HudIpcEventLike {
  readonly sender: HudIpcWebContentsLike | null;
  readonly senderFrame: HudIpcFrameLike | null;
}

function isTrustedLocalFileUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'file:' &&
      url.hostname.length === 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

/** True only for the active HUD's top-level local-file document. */
export function isTrustedHudIpcEvent(
  event: HudIpcEventLike | null | undefined,
  trustedWebContents: HudIpcWebContentsLike | null | undefined,
): boolean {
  if (!event || !trustedWebContents || !event.sender || !event.senderFrame) return false;
  if (event.sender !== trustedWebContents) return false;

  const mainFrame = trustedWebContents.mainFrame;
  if (!mainFrame || event.senderFrame !== mainFrame) return false;

  let currentUrl: string;
  try {
    currentUrl = trustedWebContents.getURL();
  } catch {
    return false;
  }

  return (
    isTrustedLocalFileUrl(currentUrl) &&
    isTrustedLocalFileUrl(event.senderFrame.url) &&
    event.senderFrame.url === currentUrl &&
    mainFrame.url === currentUrl
  );
}
