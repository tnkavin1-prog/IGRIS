/**
 * 'Ask Gemini' 1-click tool.
 *
 * Implements context capture (selected text or active page title & URL) and
 * sends an HTTP POST request to summon the Gemini Desktop HUD via its local
 * ControlServer at http://127.0.0.1:9228/summon.
 */

export const CONTROL_SERVER_SUMMON_URL = 'http://127.0.0.1:9228/summon';
export const ASK_GEMINI_MENU_ID = 'ask-gemini';
export const ASK_GEMINI_MENU_TITLE = 'Ask Gemini';
export const ASK_GEMINI_CONTEXTS: chrome.contextMenus.ContextType[] = [
  'all',
  'page',
  'selection',
  'link',
  'editable',
  'image',
  'video',
  'audio',
  'frame',
];

export interface PageContextOptions {
  selectedText?: string | null;
  title?: string | null;
  url?: string | null;
}

/**
 * Format page context when no text is selected.
 * Includes both page title and page URL if present.
 * Avoids duplicate output if title is identical to the URL.
 */
export function formatPageContext(title?: string | null, url?: string | null): string {
  const cleanTitle = title?.trim() ?? '';
  const cleanUrl = url?.trim() ?? '';
  if (cleanTitle && cleanUrl) {
    if (
      cleanTitle === cleanUrl ||
      cleanTitle.replace(/\/+$/, '') === cleanUrl.replace(/\/+$/, '')
    ) {
      return cleanUrl;
    }
    return `${cleanTitle}\n${cleanUrl}`;
  }
  return cleanTitle || cleanUrl;
}

/**
 * Extract prompt payload:
 * If text is selected, the selected text is returned.
 * Otherwise, the page title and page URL are combined.
 */
export function extractPageContext(options?: PageContextOptions): string {
  const selection = options?.selectedText?.trim();
  if (selection) {
    return selection;
  }
  return formatPageContext(options?.title, options?.url);
}

/**
 * Self-contained DOM extraction function evaluated inside the tab context.
 * Must not reference any closures or service-worker variables.
 */
export function extractDomSelection(): string {
  try {
    // 1. Regular DOM selection
    const sel = window.getSelection()?.toString();
    if (sel && sel.trim()) {
      return sel.trim();
    }

    // 2. Active element traversal across Shadow DOM boundaries
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot) {
      try {
        const shadowWithSelection = active.shadowRoot as unknown as {
          getSelection?: () => Selection | null;
        };
        const shadowSel = shadowWithSelection.getSelection?.()?.toString();
        if (shadowSel && shadowSel.trim()) {
          return shadowSel.trim();
        }
      } catch {
        /* ignore shadow getSelection errors */
      }
      if (!active.shadowRoot.activeElement) break;
      active = active.shadowRoot.activeElement;
    }

    // 3. Selection inside input or textarea elements
    if (active) {
      const tag = active.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        try {
          const input = active as HTMLInputElement | HTMLTextAreaElement;
          const start = input.selectionStart;
          const end = input.selectionEnd;
          if (typeof start === 'number' && typeof end === 'number' && start !== end) {
            const slice = (input.value ?? '')
              .slice(Math.min(start, end), Math.max(start, end))
              .trim();
            if (slice) return slice;
          }
        } catch {
          /* ignore InvalidStateError on non-text input types like number or checkbox */
        }
      }
    }

    // 4. Scan open Shadow DOM roots in the document for selections or focused input/textarea
    try {
      const allElements = document.querySelectorAll('*');
      for (let i = 0; i < allElements.length; i++) {
        const root = allElements[i]?.shadowRoot;
        if (root) {
          try {
            const shadowWithSelection = root as unknown as {
              getSelection?: () => Selection | null;
            };
            const shadowSel = shadowWithSelection.getSelection?.()?.toString();
            if (shadowSel && shadowSel.trim()) {
              return shadowSel.trim();
            }
          } catch {
            /* ignore */
          }
          if (root.activeElement) {
            const inner = root.activeElement;
            const tag = inner.tagName?.toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
              try {
                const inp = inner as HTMLInputElement | HTMLTextAreaElement;
                const s = inp.selectionStart;
                const e = inp.selectionEnd;
                if (typeof s === 'number' && typeof e === 'number' && s !== e) {
                  const sl = (inp.value ?? '').slice(Math.min(s, e), Math.max(s, e)).trim();
                  if (sl) return sl;
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore DOM errors */
  }
  return '';
}

/**
 * Safely retrieve currently selected text from a Chrome tab's DOM.
 * Handles:
 * 1. Standard DOM selection (window.getSelection()).
 * 2. Text selected inside <input> and <textarea> elements (which return empty from window.getSelection()).
 * 3. Selections across main frame and nested subframes/iframes with main frame (0) prioritization.
 * 4. Text inside open Shadow DOM components.
 */
export async function getSelectionFromTab(tabId?: number): Promise<string> {
  if (
    typeof tabId !== 'number' ||
    typeof globalThis.chrome?.scripting?.executeScript !== 'function'
  ) {
    return '';
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: extractDomSelection,
    });
    // Prioritize main frame (frameId: 0) if present
    const frameResults = [...(results || [])].sort((a, b) => {
      if (a.frameId === 0) return -1;
      if (b.frameId === 0) return 1;
      return 0;
    });
    for (const res of frameResults) {
      if (typeof res?.result === 'string' && res.result.trim()) {
        return res.result.trim();
      }
    }
  } catch {
    // Fallback to top frame if allFrames is restricted
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractDomSelection,
      });
      const selected = results?.[0]?.result;
      return typeof selected === 'string' ? selected.trim() : '';
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Send HTTP POST request to ControlServer /summon endpoint.
 */
export async function sendSummonRequest(
  prompt: string,
  endpoint = CONTROL_SERVER_SUMMON_URL,
): Promise<boolean> {
  try {
    const targetUrl = endpoint || CONTROL_SERVER_SUMMON_URL;
    // Defense in depth: attach the persistent control token when the user
    // stored it via the extension options. The chrome-extension:// origin
    // alone already passes the control API's first-party allowlist.
    let controlToken: string | undefined;
    try {
      const stored = await chrome.storage.local.get(['gematronControlToken']);
      if (typeof stored?.gematronControlToken === 'string' && stored.gematronControlToken) {
        controlToken = stored.gematronControlToken;
      }
    } catch {
      /* storage unavailable — proceed with origin-based identity */
    }
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(controlToken ? { 'X-Gematron-Control-Token': controlToken } : {}),
      },
      body: JSON.stringify({ prompt: prompt ?? '' }),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch (error) {
    console.warn(`[AskGemini] Failed to reach ControlServer at ${endpoint}:`, error);
    return false;
  }
}

/**
 * Register the 'Ask Gemini' context menu option in Chrome.
 * Uses idempotent create-with-update fallback to eliminate removeAll race conditions.
 */
export function setupContextMenu(): void {
  if (typeof globalThis.chrome?.contextMenus?.create !== 'function') return;
  try {
    chrome.contextMenus.create(
      {
        id: ASK_GEMINI_MENU_ID,
        title: ASK_GEMINI_MENU_TITLE,
        contexts: ASK_GEMINI_CONTEXTS,
      },
      () => {
        if (globalThis.chrome?.runtime?.lastError) {
          // If already created, update properties to ensure contexts and title match
          if (typeof chrome.contextMenus.update === 'function') {
            chrome.contextMenus.update(
              ASK_GEMINI_MENU_ID,
              {
                title: ASK_GEMINI_MENU_TITLE,
                contexts: ASK_GEMINI_CONTEXTS,
              },
              () => {
                if (globalThis.chrome?.runtime?.lastError) {
                  /* ignore */
                }
              },
            );
          }
        }
      },
    );
  } catch (error) {
    console.warn('[AskGemini] Error registering context menu:', error);
  }
}

export interface HandleAskGeminiOptions {
  tab?: chrome.tabs.Tab;
  info?: chrome.contextMenus.OnClickData;
  endpoint?: string;
  getActiveTab?: () => Promise<chrome.tabs.Tab | undefined>;
  fallbackSummon?: (prompt: string) => Promise<boolean>;
}

/**
 * Central handler for the 'Ask Gemini' tool entry points.
 * Captures active page context (selected text if present; otherwise page title and URL)
 * and sends an HTTP POST request to http://127.0.0.1:9228/summon with { prompt }.
 */
export async function handleAskGemini(
  options?: HandleAskGeminiOptions,
): Promise<{ success: boolean; prompt: string }> {
  let targetTab = options?.tab;
  if (!targetTab && options?.getActiveTab) {
    targetTab = await options.getActiveTab();
  }

  // 1. Check if selected text was provided via context menu click data
  let selectedText = (options?.info?.selectionText || '').trim();

  // 2. If not in context menu data, extract selected text from the tab's DOM
  if (!selectedText && targetTab?.id) {
    selectedText = await getSelectionFromTab(targetTab.id);
  }

  // 3. If tab has no title or url, attempt to retrieve updated tab data
  if (
    targetTab?.id &&
    (!targetTab.title || (!targetTab.url && !targetTab.pendingUrl)) &&
    typeof globalThis.chrome?.tabs?.get === 'function'
  ) {
    try {
      const refreshed = await chrome.tabs.get(targetTab.id);
      if (refreshed) {
        targetTab = refreshed;
      }
    } catch {
      /* ignore */
    }
  }

  // 4. Compute prompt payload (with pendingUrl & info.pageUrl fallback)
  const prompt = extractPageContext({
    selectedText,
    title: targetTab?.title,
    url: targetTab?.url || targetTab?.pendingUrl || options?.info?.pageUrl,
  });

  // 5. Send POST to ControlServer /summon
  const endpoint = options?.endpoint || CONTROL_SERVER_SUMMON_URL;
  const success = await sendSummonRequest(prompt, endpoint);

  // 6. If ControlServer was not reached and fallback provided, execute fallback
  if (!success && options?.fallbackSummon) {
    await options.fallbackSummon(prompt);
  }

  return { success, prompt };
}
