import { describe, expect, it, vi } from 'vitest';
import {
  BrowserGateway,
  NEW_TAB_URL,
  normalizeBrowserUrl,
} from '../../../apps/desktop-hud/src/main/browser-gateway.js';
import type { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import type { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import type { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import type { WindowItem } from '../../../apps/desktop-hud/src/main/types.js';

const chromeWindow: WindowItem = {
  hwnd: 42,
  title: 'Existing tab - Google Chrome',
  processName: 'chrome',
  pid: 420,
  isVisible: true,
  isIconic: false,
};

function tabElements(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Tab ${index + 1}`,
    automationId: '',
    controlType: 'TabItem',
    x: index * 120,
    y: 0,
    width: 120,
    height: 32,
    isEnabled: true,
  }));
}

function harness(options: { debug?: boolean; windows?: WindowItem[]; tabCounts?: number[] } = {}) {
  const cdp = {
    listTabs: vi.fn(async () => []),
    createTab: vi.fn(async () => null),
    navigate: vi.fn(async () => ({ ok: true, url: '' })),
  };
  const apps = {
    listRunningWindows: vi.fn(async () => options.windows ?? [chromeWindow]),
    focusWindow: vi.fn(async () => true),
    runSystemCommand: vi.fn(async () => ({ ok: false, stdout: '', stderr: '' })),
  };
  const tabCounts = [...(options.tabCounts ?? [1, 2])];
  const input = {
    sendHotkey: vi.fn(async () => true),
    typeText: vi.fn(async () => true),
    findUIElements: vi.fn(async () =>
      tabElements(tabCounts.length > 1 ? (tabCounts.shift() ?? 0) : (tabCounts[0] ?? 0)),
    ),
  };
  const spawnImpl = vi.fn();
  const gateway = new BrowserGateway({
    cdpClient: cdp as unknown as CDPClient,
    appManager: apps as unknown as AppManagerService,
    nativeInput: input as unknown as NativeInputService,
    isDebugPortAlive: async () => options.debug ?? false,
    resolveChromeExe: async () => 'C:/Chrome/chrome.exe',
    spawnImpl,
    sleep: async () => undefined,
  });
  return { gateway, cdp, apps, input, spawnImpl };
}

describe('BrowserGateway', () => {
  it('normalizes an empty request to a blank new tab', () => {
    expect(normalizeBrowserUrl()).toBe(NEW_TAB_URL);
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
  });

  it('opens one tab through CDP for concurrent and immediate duplicate commands', async () => {
    const { gateway, cdp, input } = harness({ debug: true });
    cdp.createTab.mockResolvedValue({
      id: 'tab-1',
      title: 'New Tab',
      url: 'about:blank',
      type: 'page',
      webSocketDebuggerUrl: 'ws://tab-1',
    });

    const [first, second] = await Promise.all([gateway.openTab(), gateway.openTab()]);
    const third = await gateway.openTab();

    expect(first).toMatchObject({ success: true, strategy: 'cdp', tabId: 'tab-1' });
    expect(second).toMatchObject({ deduplicated: true, tabId: 'tab-1' });
    expect(third).toMatchObject({ deduplicated: true, tabId: 'tab-1' });
    expect(cdp.createTab).toHaveBeenCalledTimes(1);
    expect(input.sendHotkey).not.toHaveBeenCalled();
  });

  it('attaches to the existing Chrome window and sends Ctrl+T exactly once', async () => {
    const { gateway, apps, input, spawnImpl } = harness();

    const [first, second] = await Promise.all([gateway.openTab(), gateway.openTab()]);

    expect(first).toMatchObject({ success: true, strategy: 'ui-attach', verified: true });
    expect(second).toMatchObject({ deduplicated: true });
    expect(apps.focusWindow).toHaveBeenCalledWith(42);
    expect(input.sendHotkey).toHaveBeenCalledTimes(1);
    expect(input.sendHotkey).toHaveBeenCalledWith('Ctrl+T');
    expect(input.typeText).not.toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('reports acknowledged input without claiming verification when UI Automation is unavailable', async () => {
    const { gateway } = harness({ tabCounts: [0] });

    const result = await gateway.openTab();

    expect(result).toMatchObject({
      success: true,
      verified: false,
      verification: 'input-acknowledged',
    });
  });

  it('does not claim success or retry when Ctrl+T is not acknowledged', async () => {
    const { gateway, input } = harness();
    input.sendHotkey.mockResolvedValueOnce(false);

    const first = await gateway.openTab();
    const duplicate = await gateway.openTab();

    expect(first).toMatchObject({ success: false, verified: false });
    expect(duplicate).toMatchObject({ success: false, deduplicated: true });
    expect(input.sendHotkey).toHaveBeenCalledTimes(1);
    expect(input.typeText).not.toHaveBeenCalled();
  });

  it('preserves a partial new-tab failure without issuing another mutation', async () => {
    const { gateway, input } = harness();
    input.typeText.mockResolvedValueOnce(false);

    const first = await gateway.openTab('example.com');
    const duplicate = await gateway.openTab('example.com');

    expect(first).toMatchObject({ success: false, verified: false });
    expect(first.error).toContain('may already be open');
    expect(duplicate).toMatchObject({ success: false, deduplicated: true });
    expect(input.sendHotkey).toHaveBeenCalledTimes(1);
    expect(input.sendHotkey).toHaveBeenCalledWith('Ctrl+T');
    expect(input.typeText).toHaveBeenCalledTimes(1);
  });

  it('rejects an unexpected observed tab-count change instead of guessing success', async () => {
    const { gateway, input } = harness({ tabCounts: [2, 2] });

    const result = await gateway.openTab();

    expect(result).toMatchObject({
      success: false,
      verified: false,
      verification: 'tab-count',
    });
    expect(input.sendHotkey).toHaveBeenCalledTimes(1);
  });

  it('uses Ctrl+L rather than creating a tab for navigation', async () => {
    const { gateway, input } = harness();

    const result = await gateway.navigate('example.com');

    expect(result).toMatchObject({ success: true, strategy: 'ui-attach' });
    expect(input.sendHotkey.mock.calls.map((call) => call[0])).toEqual(['Ctrl+L', 'Enter']);
    expect(input.typeText).toHaveBeenCalledWith('https://example.com');
    expect(result).toMatchObject({
      verified: false,
      verification: 'input-acknowledged',
    });
  });

  it('reports partial navigation when Enter is not acknowledged', async () => {
    const { gateway, input } = harness();
    input.sendHotkey.mockImplementation(async (key) => key !== 'Enter');

    const result = await gateway.navigate('example.com');

    expect(result).toMatchObject({ success: false, verified: false });
    expect(result.error).toContain('Enter');
    expect(input.sendHotkey.mock.calls.map((call) => call[0])).toEqual(['Ctrl+L', 'Enter']);
    expect(input.typeText).toHaveBeenCalledTimes(1);
  });

  it('launches the normal Chrome profile only when no Chrome window exists', async () => {
    let windows: WindowItem[] = [];
    const { gateway, apps, input, spawnImpl } = harness({ windows });
    apps.listRunningWindows.mockImplementation(async () => windows);
    spawnImpl.mockImplementation(() => {
      windows = [chromeWindow];
    });

    const result = await gateway.openTab();

    expect(result).toMatchObject({ success: true, strategy: 'launch' });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl).toHaveBeenCalledWith('C:/Chrome/chrome.exe', []);
    expect(spawnImpl.mock.calls[0]?.[1]).not.toContain('--remote-debugging-port=9222');
    expect(input.sendHotkey).not.toHaveBeenCalled();
  });

  it('re-observes targets after an ambiguous CDP result instead of retrying', async () => {
    const { gateway, cdp } = harness({ debug: true });
    cdp.listTabs.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'created-despite-timeout',
        title: 'Example',
        url: 'https://example.com',
        type: 'page',
        webSocketDebuggerUrl: 'ws://created',
      },
    ]);

    const result = await gateway.openTab('example.com');

    expect(result).toMatchObject({ success: true, tabId: 'created-despite-timeout' });
    expect(cdp.createTab).toHaveBeenCalledTimes(1);
  });
});
