/**
 * MV3 service worker.
 *
 * Implements Option 1 (Native Desktop Companion / Out-of-Browser Sidecar HUD)
 * matching Google's native "Ask Gemini" (GLIC / GlicFloatingUi) architecture:
 *
 *   1. Strictly ONE single floating companion window across the entire OS (singleton).
 *   2. No per-tab iframe injection: completely eliminates duplicate Gemini windows
 *      appearing when tabs are created or switched.
 *   3. Dynamic Active Tab Tracking: Monitors Chrome's active normal tab. When the user
 *      switches tabs or navigates (e.g. "open YouTube"), the single HUD window stays
 *      in place and shifts its context/vision pointer to the newly active tab.
 *   4. Seamless command forwarding to the single floating companion HUD.
 */

import {
  setupContextMenu,
  handleAskGemini,
  ASK_GEMINI_MENU_ID,
  CONTROL_SERVER_SUMMON_URL,
} from './tools/ask-gemini.js';

const OVERLAY_FILE = 'overlay.html';
const OVERLAY_HOST_ID = 'gbl-overlay-host';
const SESSION_ACTIVE_TAB_KEY = 'gbl_active_tab_id';
const SESSION_ACTIVE_WIN_KEY = 'gbl_active_window_id';
const SESSION_HUD_WIN_KEY = 'gbl_hud_window_id';
const LOCAL_HUD_POS_KEY = 'gbl_hud_pos';

const COMMAND_MESSAGES: Record<string, string> = {
  'start-session': 'GBL_COMMAND_START',
  'stop-session': 'GBL_COMMAND_STOP',
  'toggle-mic': 'GBL_COMMAND_TOGGLE_MIC',
  'open-settings': 'GBL_COMMAND_SETTINGS',
};

let desktopWindowId: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a tab is the HUD window itself or an internal overlay tab.
 */
function isHudTab(tab?: chrome.tabs.Tab | null): boolean {
  if (!tab) return false;
  const url = tab.url || tab.pendingUrl || '';
  if (url.includes(OVERLAY_FILE)) return true;
  if (typeof desktopWindowId === 'number' && tab.windowId === desktopWindowId) return true;
  return false;
}

/**
 * Finds any already-running desktop HUD window across Chrome (OS-wide singleton check).
 */
async function getExistingHudWindow(): Promise<chrome.windows.Window | null> {
  try {
    const isHudWin = async (winId: number): Promise<chrome.windows.Window | null> => {
      try {
        const win = await chrome.windows.get(winId, { populate: true });
        if (win && win.tabs?.some((t) => isHudTab(t))) {
          return win;
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    // 1. Check in-memory desktopWindowId
    if (desktopWindowId !== null) {
      const win = await isHudWin(desktopWindowId);
      if (win) return win;
      desktopWindowId = null;
    }

    // 2. Check session storage for persisted HUD window ID
    try {
      const stored = await chrome.storage.session.get([SESSION_HUD_WIN_KEY]);
      if (typeof stored?.[SESSION_HUD_WIN_KEY] === 'number') {
        const win = await isHudWin(stored[SESSION_HUD_WIN_KEY]);
        if (win) {
          desktopWindowId = win.id ?? null;
          return win;
        }
      }
    } catch {
      /* ignore */
    }

    // 3. Scan all open tabs for overlay.html
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (isHudTab(tab) && typeof tab.windowId === 'number') {
        try {
          const win = await chrome.windows.get(tab.windowId);
          if (win) {
            desktopWindowId = win.id ?? null;
            await chrome.storage.session.set({ [SESSION_HUD_WIN_KEY]: desktopWindowId });
            return win;
          }
        } catch {
          /* window query failed */
        }
      }
    }
  } catch {
    /* tab query failed */
  }
  return null;
}

/**
 * Resolve the current active normal Chrome tab (ignoring the HUD overlay itself).
 */
export async function activeNormalTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    // Check session stored active tab first
    const stored = await chrome.storage.session.get([SESSION_ACTIVE_TAB_KEY]);
    if (stored?.[SESSION_ACTIVE_TAB_KEY]) {
      try {
        const tab = await chrome.tabs.get(stored[SESSION_ACTIVE_TAB_KEY]);
        if (tab && !isHudTab(tab)) return tab;
      } catch {
        /* stale stored tab */
      }
    }

    const [focusedNormal] = await chrome.tabs.query({
      active: true,
      windowType: 'normal',
      lastFocusedWindow: true,
    });
    if (focusedNormal && !isHudTab(focusedNormal)) return focusedNormal;

    const [anyNormal] = await chrome.tabs.query({ active: true, windowType: 'normal' });
    if (anyNormal && !isHudTab(anyNormal)) return anyNormal;

    const allActive = await chrome.tabs.query({ active: true });
    return allActive.find((t) => !isHudTab(t));
  } catch {
    return undefined;
  }
}

/**
 * Open or restore the strictly singleton Native Desktop Companion HUD window.
 */
export async function openDesktopPopup(prompt?: string): Promise<boolean> {
  try {
    // 1. First, attempt to summon the Native Desktop HUD (Electron) via loopback port 9228
    try {
      // The desktop control API accepts a per-install token. The extension
      // origin is trusted on its own, but an installation that requires the
      // token still needs it attached.
      let controlToken: string | undefined;
      try {
        const stored = await chrome.storage.local.get(['gematronControlToken']);
        if (typeof stored?.gematronControlToken === 'string' && stored.gematronControlToken) {
          controlToken = stored.gematronControlToken;
        }
      } catch {
        /* storage unavailable - proceed with origin-based identity */
      }
      const res = await fetch(CONTROL_SERVER_SUMMON_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(controlToken ? { 'X-Gematron-Control-Token': controlToken } : {}),
        },
        body: JSON.stringify({ prompt: prompt ?? '' }),
        signal: AbortSignal.timeout(600),
      });
      if (res.ok) {
        return true;
      }
    } catch {
      // Desktop HUD port 9228 not responding, fall back directly to in-browser Companion HUD
    }

    // Ensure active normal tab is recorded so the HUD immediately binds to it
    const currentTab = await activeNormalTab();
    if (currentTab) void notifyActiveTab(currentTab);

    // 2. If an existing HUD window is already open, restore and focus it immediately
    const existing = await getExistingHudWindow();
    if (existing && typeof existing.id === 'number') {
      try {
        const updateInfo: chrome.windows.UpdateInfo = { focused: true, drawAttention: true };
        if (existing.state === 'minimized') {
          updateInfo.state = 'normal';
        }
        await chrome.windows.update(existing.id, updateInfo);
        desktopWindowId = existing.id;
        if (prompt) {
          void chrome.runtime
            .sendMessage({ type: 'GBL_SET_PROMPT', prompt })
            .catch(() => undefined);
        }
        return true;
      } catch {
        desktopWindowId = null;
      }
    }

    // 2. Compute default or saved position
    let top = 80;
    let left = 1000;
    let width = 440;
    let height = 680;

    try {
      const saved = await chrome.storage.local.get([LOCAL_HUD_POS_KEY]);
      if (saved?.[LOCAL_HUD_POS_KEY]) {
        const pos = saved[LOCAL_HUD_POS_KEY] as {
          left?: number;
          top?: number;
          width?: number;
          height?: number;
        };
        if (typeof pos.left === 'number' && typeof pos.top === 'number') {
          left = Math.max(10, pos.left);
          top = Math.max(10, pos.top);
        }
        if (typeof pos.width === 'number') width = pos.width;
        if (typeof pos.height === 'number') height = pos.height;
      } else {
        const currentWin = await chrome.windows.getLastFocused();
        if (currentWin?.left !== undefined && currentWin?.width !== undefined) {
          left = Math.max(20, currentWin.left + currentWin.width - 460);
          top = Math.max(20, (currentWin.top ?? 0) + 60);
        }
      }
    } catch {
      /* fallback */
    }

    const targetUrl = prompt
      ? `${chrome.runtime.getURL(OVERLAY_FILE)}?prompt=${encodeURIComponent(prompt)}`
      : chrome.runtime.getURL(OVERLAY_FILE);

    const win = await chrome.windows.create({
      url: targetUrl,
      type: 'popup',
      width,
      height,
      top,
      left,
      focused: true,
    });

    desktopWindowId = win.id ?? null;
    await chrome.storage.session.set({ [SESSION_HUD_WIN_KEY]: desktopWindowId });
    return true;
  } catch (error) {
    console.error('Failed to create Desktop HUD popup window:', error);
    try {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.windowId) {
        await chrome.sidePanel.open({ windowId: active.windowId });
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Remove any legacy or stray in-page iframe injection elements.
 */
async function cleanupInjectedHosts(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && !isHudTab(tab) && tab.url && !tab.url.startsWith('chrome:')) {
        void chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            func: (id: string) => document.getElementById(id)?.remove(),
            args: [OVERLAY_HOST_ID],
          })
          .catch(() => undefined);
      }
    }
  } catch {
    /* ignore */
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === desktopWindowId) {
    desktopWindowId = null;
    void chrome.storage.session.remove([SESSION_HUD_WIN_KEY]).catch(() => undefined);
  }
});

// Configure Side Panel behavior (fallback routing)
async function configurePanel(): Promise<void> {
  try {
    if (chrome.storage?.session?.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({
        accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
      });
    }
  } catch {
    /* ignore */
  }
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    /* Older Chrome builds expose sidePanel without this method */
  }
  try {
    await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  } catch {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void configurePanel();
  void cleanupInjectedHosts();
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void configurePanel();
  void cleanupInjectedHosts();
  setupContextMenu();
});

void configurePanel();
setupContextMenu();

// Action click: Strictly open or focus the Single Desktop Companion HUD with active page context
chrome.action.onClicked.addListener((tab) => {
  void handleAskGemini({
    tab,
    getActiveTab: activeNormalTab,
    fallbackSummon: (prompt) => summonInBrowser(prompt, tab),
  });
});

// Context Menu click: Trigger 'Ask Gemini' on right-click on page or selection
chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId === ASK_GEMINI_MENU_ID) {
    void handleAskGemini({
      tab,
      info,
      getActiveTab: activeNormalTab,
      fallbackSummon: (prompt) => summonInBrowser(prompt, tab),
    });
  }
});

/**
 * Open Gemini directly in Chrome (Side Panel) or fall back to companion popup window.
 */
async function summonInBrowser(prompt?: string, tab?: chrome.tabs.Tab): Promise<boolean> {
  const winId = tab?.windowId;
  if (typeof winId === 'number' && typeof chrome.sidePanel?.open === 'function') {
    try {
      await chrome.sidePanel.open({ windowId: winId });
      if (prompt) {
        void sendToSurface('GBL_SET_PROMPT', { prompt });
      }
      return true;
    } catch {
      /* fallback to popup window */
    }
  }
  return openDesktopPopup(prompt);
}

/**
 * Record and broadcast active tab changes so the HUD shifts its vision pointer immediately.
 */
async function notifyActiveTab(tab: chrome.tabs.Tab): Promise<void> {
  if (isHudTab(tab)) return;
  try {
    await chrome.storage.session.set({
      [SESSION_ACTIVE_TAB_KEY]: tab.id,
      [SESSION_ACTIVE_WIN_KEY]: tab.windowId,
    });
    chrome.runtime
      .sendMessage({
        type: 'GBL_ACTIVE_TAB_CHANGED',
        tab: { id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId },
      })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// Track active tab when user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && !isHudTab(tab)) {
      await notifyActiveTab(tab);
    }
  } catch {
    /* tab might be closed */
  }
});

// Track active tab when tab updates (title/url/navigation changes)
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active && !isHudTab(tab)) {
    if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) {
      await notifyActiveTab(tab);
    }
  }
});

// Track active tab when user shifts focus between Chrome windows
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || windowId === desktopWindowId) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && !isHudTab(tab)) {
      await notifyActiveTab(tab);
    }
  } catch {
    /* window query failed */
  }
});

async function sendToSurface(type: string, extra?: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await chrome.runtime.sendMessage({ type, ...extra });
      return true;
    } catch {
      await delay(150);
    }
  }
  return false;
}

// Handle runtime messages
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'GBL_CLOSE_OVERLAY') {
    if (desktopWindowId) {
      try {
        void chrome.windows.remove(desktopWindowId);
      } catch {
        /* ignore */
      }
      desktopWindowId = null;
    }
  } else if (message?.type === 'GBL_OPEN_OVERLAY' || message?.type === 'GBL_POP_OUT_DESKTOP') {
    void openDesktopPopup();
  }
});

// Keyboard shortcut commands routed directly to the single HUD
chrome.commands.onCommand.addListener((command) => {
  const type = COMMAND_MESSAGES[command];
  if (!type) return;
  void (async () => {
    await openDesktopPopup();
    await sendToSurface(type);
  })();
});
