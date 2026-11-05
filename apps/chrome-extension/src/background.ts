/**
 * MV3 service worker.
 *
 * It deliberately owns almost no state: the overlay (or the side panel) runs the
 * Live session and all tool execution, so the worker can be suspended at any
 * moment without dropping audio or an approval. Its jobs are:
 *
 *   1. pin the overlay into the active tab on demand (the default surface),
 *   2. fall back to the side panel where injection is not allowed,
 *   3. forward keyboard commands to whichever surface is running.
 */
const PANEL_PATH = 'sidepanel.html';
const OVERLAY_HOST_FILE = 'overlay-host.js';
const OVERLAY_HOST_ID = 'gbl-overlay-host';

const COMMAND_MESSAGES: Record<string, string> = {
  'start-session': 'GBL_COMMAND_START',
  'stop-session': 'GBL_COMMAND_STOP',
  'toggle-mic': 'GBL_COMMAND_TOGGLE_MIC',
  'open-settings': 'GBL_COMMAND_SETTINGS',
};

/** Pages where content scripts cannot run, so the panel is the only option. */
const RESTRICTED = /^(chrome|edge|about|devtools|view-source|chrome-extension):/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configurePanel(): Promise<void> {
  try {
    // The action now opens the overlay; the panel is the fallback surface.
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    /* Older Chrome builds expose sidePanel without this method. */
  }
  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  } catch {
    /* A missing panel path is reported when the panel is opened. */
  }
}

async function openPanel(windowId?: number): Promise<boolean> {
  try {
    await chrome.sidePanel.open(
      typeof windowId === 'number' ? { windowId } : { windowId: chrome.windows.WINDOW_ID_CURRENT },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A freshly opened surface needs a moment to mount its React tree and register
 * the runtime listener. Retry briefly instead of racing it.
 */
async function sendToSurface(type: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await chrome.runtime.sendMessage({ type });
      return true;
    } catch {
      await delay(150);
    }
  }
  return false;
}

async function overlayMounted(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (id: string) => Boolean(document.getElementById(id)),
      args: [OVERLAY_HOST_ID],
    });
    return result?.result === true;
  } catch {
    return false;
  }
}

/**
 * Inject (or re-focus) the overlay. Returns false when the tab cannot host a
 * content script, so the caller can fall back to the side panel.
 */
async function showOverlay(tab: chrome.tabs.Tab | undefined): Promise<boolean> {
  const tabId = tab?.id;
  if (typeof tabId !== 'number') return false;
  if (tab?.url && RESTRICTED.test(tab.url)) return false;

  try {
    if (await overlayMounted(tabId)) {
      // Re-running the host script focuses an existing frame.
      await chrome.scripting.executeScript({ target: { tabId }, files: [OVERLAY_HOST_FILE] });
      return true;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: [OVERLAY_HOST_FILE] });
    return true;
  } catch {
    return false;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function openSurface(tab?: chrome.tabs.Tab): Promise<void> {
  const target = tab ?? (await activeTab());
  if (await showOverlay(target)) return;
  await openPanel(target?.windowId);
}

chrome.runtime.onInstalled.addListener(() => {
  void configurePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configurePanel();
});

void configurePanel();

chrome.action.onClicked.addListener((tab) => {
  void openSurface(tab);
});

chrome.commands.onCommand.addListener((command) => {
  const type = COMMAND_MESSAGES[command];
  if (!type) return;
  void (async () => {
    const tab = await activeTab();
    await openSurface(tab);
    await sendToSurface(type);
  })();
});
