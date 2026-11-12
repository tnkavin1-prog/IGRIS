import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';

describe('CDPClient', () => {
  let client: CDPClient;

  beforeEach(() => {
    client = new CDPClient(9222, '127.0.0.1');
  });

  afterEach(() => {
    client.stopTracking();
    vi.restoreAllMocks();
  });

  it('constructs with correct default host and port', () => {
    expect(client.baseUrl).toBe('http://127.0.0.1:9222');
  });

  it('returns empty tab list and disconnected status when port is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));

    const status = await client.getStatus();
    expect(status.connected).toBe(false);
    expect(status.tabs).toEqual([]);
    expect(status.activeTab).toBeNull();
    expect(status.error).toContain('ECONNREFUSED');
  });

  it('filters out non-page targets and parses page tabs correctly', async () => {
    const mockTargets = [
      {
        id: 'page1',
        type: 'page',
        title: 'SSC CGL Mock Exam',
        url: 'file:///E:/Gematron/SSC_CGL_Mock_Exam.html',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page1',
      },
      {
        id: 'bg1',
        type: 'background_page',
        title: 'Service Worker',
        url: 'chrome-extension://abc/bg.html',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/bg1',
      },
      {
        id: 'page2',
        type: 'page',
        title: 'YouTube',
        url: 'https://www.youtube.com',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page2',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/json/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ Browser: 'Chrome/157.0' }),
        } as Response);
      }
      if (String(url).endsWith('/json/list')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTargets),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const tabs = await client.listTabs();
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.id).toBe('page1');
    expect(tabs[0]?.title).toBe('SSC CGL Mock Exam');
    expect(tabs[1]?.id).toBe('page2');

    const status = await client.getStatus();
    expect(status.connected).toBe(true);
    expect(status.browser).toBe('Chrome/157.0');
    expect(status.activeTab?.id).toBe('page1');
  });

  it('correctly tracks active tab and emits active-tab-changed on switch', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/json/activate/page2')) {
        return Promise.resolve({ ok: true } as Response);
      }
      if (String(url).endsWith('/json/list')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 'page2',
                type: 'page',
                title: 'YouTube',
                url: 'https://www.youtube.com',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page2',
              },
            ]),
        } as Response);
      }
      return Promise.resolve({ ok: true } as Response);
    });

    let emittedTab: any = null;
    client.on('active-tab-changed', (tab) => {
      emittedTab = tab;
    });

    const switched = await client.switchTab('page2');
    expect(switched).toBe(true);
    expect(emittedTab).not.toBeNull();
    expect(emittedTab.id).toBe('page2');
  });

  it('determines the active tab among multiple tabs using document.visibilityState', async () => {
    const tabs = [
      {
        id: 'tab1',
        type: 'page',
        title: 'Tab 1 (Background)',
        url: 'https://example.com/1',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
      },
      {
        id: 'tab2',
        type: 'page',
        title: 'Tab 2 (Active Foreground)',
        url: 'https://example.com/2',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab2',
      },
    ];

    vi.spyOn(client as any, 'executeCDPCommand').mockImplementation(
      async (wsUrl: unknown): Promise<any> => {
        const url = String(wsUrl);
        if (url.includes('tab1')) {
          return { result: { value: 'hidden' } };
        }
        if (url.includes('tab2')) {
          return { result: { value: 'visible' } };
        }
        return { result: { value: 'unknown' } };
      },
    );

    const active = await client.findActiveTab(tabs);
    expect(active).not.toBeNull();
    expect(active?.id).toBe('tab2');
    expect(active?.title).toBe('Tab 2 (Active Foreground)');
  });

  describe('Multi-Tab Management & Tab Content Search', () => {
    it('duplicateTab duplicates active tab or specified tab id', async () => {
      const mockTabs = [
        {
          id: 'tab1',
          type: 'page',
          title: 'Gemini AI',
          url: 'https://gemini.google.com/app',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
        },
      ];
      vi.spyOn(client, 'listTabs').mockResolvedValue(mockTabs);
      const createSpy = vi.spyOn(client, 'createTab').mockResolvedValue({
        id: 'tab1_dup',
        type: 'page',
        title: 'Gemini AI',
        url: 'https://gemini.google.com/app',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1_dup',
      });

      const res = await client.duplicateTab('tab1');
      expect(createSpy).toHaveBeenCalledWith('https://gemini.google.com/app');
      expect(res?.id).toBe('tab1_dup');
    });

    it('reloadTab executes Page.reload via CDP websocket', async () => {
      const mockTabs = [
        {
          id: 'tab1',
          type: 'page',
          title: 'Test Page',
          url: 'https://example.com',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
        },
      ];
      vi.spyOn(client, 'listTabs').mockResolvedValue(mockTabs);
      const cmdSpy = vi.spyOn(client as any, 'executeCDPCommand').mockResolvedValue({ result: {} });

      const ok = await client.reloadTab('tab1', true);
      expect(ok).toBe(true);
      expect(cmdSpy).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/page/tab1', 'Page.reload', {
        ignoreCache: true,
      });
    });

    it('searchTabContent locates text across tab DOM text and titles', async () => {
      const mockTabs = [
        {
          id: 'tab1',
          type: 'page',
          title: 'SSC CGL Mock Exam 2026',
          url: 'https://ssc.nic.in/exam',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
        },
        {
          id: 'tab2',
          type: 'page',
          title: 'Wikipedia Article',
          url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab2',
        },
      ];
      vi.spyOn(client, 'listTabs').mockResolvedValue(mockTabs);

      vi.spyOn(client as any, 'executeCDPCommand').mockImplementation(
        async (wsUrl: unknown): Promise<any> => {
          if (String(wsUrl).includes('tab1')) {
            return {
              result: {
                value: {
                  bodyText:
                    'General Intelligence and Reasoning. Question 1: What is quantitative aptitude score?',
                  title: 'SSC CGL Mock Exam 2026',
                  url: 'https://ssc.nic.in/exam',
                },
              },
            };
          }
          return {
            result: {
              value: {
                bodyText: 'Artificial intelligence is intelligence demonstrated by machines.',
                title: 'Wikipedia Article',
                url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
              },
            },
          };
        },
      );

      const res = await client.searchTabContent('quantitative aptitude');
      expect(res.totalTabs).toBe(2);
      expect(res.matchedTabs).toHaveLength(1);
      expect(res.matchedTabs[0]?.id).toBe('tab1');
      expect(res.matchedTabs[0]?.snippet).toContain('quantitative aptitude');

      // Title match search
      const resTitle = await client.searchTabContent('Wikipedia');
      expect(resTitle.matchedTabs).toHaveLength(1);
      expect(resTitle.matchedTabs[0]?.id).toBe('tab2');
    });

    it('closeDuplicateTabs identifies and closes redundant URLs while preserving active tab', async () => {
      const mockTabs = [
        {
          id: 'tab1',
          type: 'page',
          title: 'Google Search 1',
          url: 'https://www.google.com/search?q=gemetron',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
        },
        {
          id: 'tab2',
          type: 'page',
          title: 'Google Search 2 (Duplicate)',
          url: 'https://www.google.com/search?q=gemetron#top',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab2',
        },
        {
          id: 'tab3',
          type: 'page',
          title: 'Unique Page',
          url: 'https://example.com/unique',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab3',
        },
      ];
      vi.spyOn(client, 'listTabs').mockResolvedValue(mockTabs);
      vi.spyOn(client, 'findActiveTab').mockResolvedValue(mockTabs[0]!);
      const closeSpy = vi.spyOn(client, 'closeTab').mockResolvedValue(true);

      const res = await client.closeDuplicateTabs();
      expect(res.closedCount).toBe(1);
      expect(res.closedTabs).toHaveLength(1);
      expect(res.closedTabs[0]?.id).toBe('tab2');
      expect(closeSpy).toHaveBeenCalledWith('tab2');
    });
  });

  describe('Deep DOM probing and single-strategy scrolling', () => {
    const pageTab = {
      id: 'tab1',
      type: 'page' as const,
      title: 'Test Page',
      url: 'https://example.com',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab1',
    };

    it('scrolls the deepest DOM container without also dispatching a wheel event', async () => {
      const evaluateSpy = vi
        .spyOn(client, 'evaluate')
        .mockResolvedValue({ scrolled: true } as never);
      const wheelSpy = vi.spyOn(client, 'dispatchMouseWheel').mockResolvedValue(true);
      const keySpy = vi.spyOn(client as any, 'dispatchKeyEvent').mockResolvedValue({ result: {} });

      const scrolled = await client.scroll('down', 450, 'tab1');

      expect(scrolled).toBe(true);
      expect(evaluateSpy).toHaveBeenCalledTimes(1);
      expect(wheelSpy).not.toHaveBeenCalled();
      // The old implementation also sent PageDown/PageUp, double-scrolling.
      expect(keySpy).not.toHaveBeenCalled();
      expect(String(evaluateSpy.mock.calls[0]?.[0])).toContain('scrollBy');
      expect(String(evaluateSpy.mock.calls[0]?.[0])).toContain('shadowRoot');
    });

    it('falls back to exactly one wheel event when no container scrolled', async () => {
      vi.spyOn(client, 'evaluate').mockResolvedValue({ scrolled: false } as never);
      const wheelSpy = vi.spyOn(client, 'dispatchMouseWheel').mockResolvedValue(true);

      const scrolled = await client.scroll('up', 300, 'tab1');

      expect(scrolled).toBe(true);
      expect(wheelSpy).toHaveBeenCalledTimes(1);
      expect(wheelSpy).toHaveBeenCalledWith(-300, 600, 400, 'tab1');
    });

    it('finds elements inside open shadow roots and translates iframe coordinates', async () => {
      vi.spyOn(client, 'listTabs').mockResolvedValue([pageTab]);
      const evaluateSpy = vi.spyOn(client, 'evaluate').mockResolvedValue({
        text: 'Deep button',
        x: 120,
        y: 80,
        width: 40,
        height: 20,
      } as never);

      const element = await client.findElementByText('Deep button', 'tab1', true);

      expect(element).toEqual({
        text: 'Deep button',
        x: 120,
        y: 80,
        width: 40,
        height: 20,
        tabId: 'tab1',
        coordinateSpace: 'css_viewport',
      });
      const expression = String(evaluateSpy.mock.calls[0]?.[0]);
      // Deep traversal must cover shadow roots AND same-origin frames.
      expect(expression).toContain('el.shadowRoot');
      expect(expression).toContain('contentDocument');
      expect(expression).toContain('__deepQueryAll');
      expect(expression).toContain('__deepHit');
      expect(expression).toContain('frameElement');
    });

    it('resolves click targets through the same deep DOM helpers', async () => {
      vi.spyOn(client, 'listTabs').mockResolvedValue([pageTab]);
      const evaluateSpy = vi.spyOn(client, 'evaluate').mockResolvedValue({ x: 10, y: 20 } as never);
      const clickAtSpy = vi.spyOn(client, 'clickAt').mockResolvedValue(true);

      const clicked = await client.click('#deep-button', 'tab1');

      expect(clicked).toBe(true);
      expect(clickAtSpy).toHaveBeenCalledWith(10, 20, 'tab1');
      const expression = String(evaluateSpy.mock.calls[0]?.[0]);
      expect(expression).toContain('__deepQuery');
      expect(expression).toContain('frameElement');
    });
  });
});
