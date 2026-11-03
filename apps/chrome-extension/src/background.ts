/**
 * MV3 service worker.
 *
 * It deliberately owns almost no state: the side panel runs the Live session
 * and all tool execution, so the worker can be suspended at any moment without
 * dropping audio or an approval. Its only jobs are opening the panel and
 * forwarding keyboard commands.
 */
const PANEL_PATH = 'sidepanel.html';

const COMMAND_MESSAGES: Record<string, string> = {
  'start-session': 'GBL_COMMAND_START',
  'stop-session': 'GBL_COMMAND_STOP',
  'toggle-mic': 'GBL_COMMAND_TOGGLE_MIC',
  'open-settings': 'GBL_COMMAND_SETTINGS',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configurePanel(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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
 * A freshly opened side panel needs a moment to mount its React tree and
 * register the runtime listener. Retry briefly instead of racing it.
 */
async function sendToPanel(type: string): Promise<boolean> {
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

chrome.runtime.onInstalled.addListener(() => {
  void configurePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configurePanel();
});

void configurePanel();

chrome.action.onClicked.addListener((tab) => {
  void openPanel(tab.windowId);
});

chrome.commands.onCommand.addListener((command) => {
  const type = COMMAND_MESSAGES[command];
  if (!type) return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await openPanel(tab?.windowId);
    await sendToPanel(type);
  })();
});
