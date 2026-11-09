import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { ChromeStatus, ChromeTabInfo, TabSearchMatch, TabSearchResult } from './types.js';

interface CDPResponse<T = Record<string, unknown>> {
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

export class CDPClient extends EventEmitter {
  private port = 9222;
  private host = '127.0.0.1';
  private pollInterval: NodeJS.Timeout | null = null;
  private currentActiveTab: ChromeTabInfo | null = null;
  private isConnected = false;
  private messageSeq = 1;

  constructor(port = 9222, host = '127.0.0.1') {
    super();
    this.port = port;
    this.host = host;
  }

  public get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  public startTracking(intervalMs = 1500): void {
    if (this.pollInterval) return;
    void this.pollTabs();
    this.pollInterval = setInterval(() => {
      void this.pollTabs();
    }, intervalMs);
  }

  public stopTracking(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  public async getStatus(): Promise<ChromeStatus> {
    try {
      const verRes = await fetch(`${this.baseUrl}/json/version`, {
        signal: AbortSignal.timeout(1200),
      });
      if (!verRes.ok) {
        return {
          connected: false,
          port: this.port,
          activeTab: null,
          tabs: [],
          error: 'Remote debugging port responded with non-200 status.',
        };
      }
      const verData = (await verRes.json()) as { Browser?: string };
      const tabs = await this.listTabs();
      const active = this.currentActiveTab || tabs[0] || null;

      return {
        connected: true,
        port: this.port,
        browser: verData.Browser,
        activeTab: active,
        tabs,
      };
    } catch (err) {
      return {
        connected: false,
        port: this.port,
        activeTab: null,
        tabs: [],
        error: (err as Error).message,
      };
    }
  }

  public async listTabs(): Promise<ChromeTabInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as ChromeTabInfo[];
      // Keep only user pages and visible tabs
      return list.filter((t) => t.type === 'page');
    } catch {
      return [];
    }
  }

  public async getActiveTab(): Promise<ChromeTabInfo | null> {
    return await this.findActiveTab();
  }

  public async findActiveTab(tabs?: ChromeTabInfo[]): Promise<ChromeTabInfo | null> {
    const list = tabs ?? (await this.listTabs());
    if (list.length === 0) return null;
    if (list.length === 1) return list[0] ?? null;

    // Check visibilityState across tabs in parallel with a fast timeout
    try {
      const visibilities = await Promise.all(
        list.map(async (tab) => {
          if (!tab.webSocketDebuggerUrl) return { tab, visible: false };
          try {
            const vis = await this.executeCDPCommand<{ result: { value: string } }>(
              tab.webSocketDebuggerUrl,
              'Runtime.evaluate',
              { expression: 'document.visibilityState', returnByValue: true },
              250,
            );
            return { tab, visible: vis?.result?.value === 'visible' };
          } catch {
            return { tab, visible: false };
          }
        }),
      );

      const active = visibilities.find((v) => v.visible)?.tab;
      if (active) return active;
    } catch {
      // Fallback
    }

    // If none is visible (e.g. Chrome minimized), retain currentActiveTab if still open
    if (this.currentActiveTab) {
      const found = list.find((t) => t.id === this.currentActiveTab?.id);
      if (found) return found;
    }

    return list[0] ?? null;
  }

  public async switchTab(tabId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/json/activate/${encodeURIComponent(tabId)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const tabs = await this.listTabs();
        const active = tabs.find((t) => t.id === tabId) ?? null;
        if (active) {
          this.currentActiveTab = active;
          this.emit('active-tab-changed', active);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public async createTab(url = 'https://www.google.com'): Promise<ChromeTabInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const tab = (await res.json()) as ChromeTabInfo;
      this.currentActiveTab = tab;
      this.emit('active-tab-changed', tab);
      return tab;
    } catch {
      return null;
    }
  }

  public async closeTab(tabId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/json/close/${encodeURIComponent(tabId)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async captureScreenshot(
    tabId?: string,
  ): Promise<{ data: string; mimeType: 'image/jpeg' }> {
    const tab = tabId
      ? (await this.listTabs()).find((t) => t.id === tabId)
      : await this.getActiveTab();
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error('No active Chrome tab found to capture screenshot.');
    }

    let res: { data: string } | undefined;
    try {
      res = await this.executeCDPCommand<{ data: string }>(
        tab.webSocketDebuggerUrl,
        'Page.captureScreenshot',
        {
          format: 'jpeg',
          quality: 75,
          fromSurface: true,
        },
      );
    } catch {
      // Retry without fromSurface if surface rasterization fails
      res = await this.executeCDPCommand<{ data: string }>(
        tab.webSocketDebuggerUrl,
        'Page.captureScreenshot',
        {
          format: 'jpeg',
          quality: 75,
        },
      );
    }

    if (!res?.data) {
      throw new Error('CDP Page.captureScreenshot returned empty payload.');
    }

    return {
      data: res.data,
      mimeType: 'image/jpeg',
    };
  }

  public async navigate(url: string, tabId?: string): Promise<{ ok: boolean; url: string }> {
    const tab = tabId
      ? (await this.listTabs()).find((t) => t.id === tabId)
      : await this.getActiveTab();
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error('No active Chrome tab found to navigate.');
    }

    await this.executeCDPCommand(tab.webSocketDebuggerUrl, 'Page.navigate', { url });
    return { ok: true, url };
  }

  public async evaluate<T = unknown>(expression: string, tabId?: string): Promise<T> {
    const tab = tabId
      ? (await this.listTabs()).find((t) => t.id === tabId)
      : await this.getActiveTab();
    if (!tab || !tab.webSocketDebuggerUrl) {
      throw new Error('No active Chrome tab found to evaluate expression.');
    }

    const res = await this.executeCDPCommand<{ result: { value: T } }>(
      tab.webSocketDebuggerUrl,
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
    );

    return res.result?.value as T;
  }

  /**
   * Dispatches a synthetic hardware mouse wheel event to Chrome via CDP Input domain.
   * Works on Chrome PDF viewer, canvas, iframes, and shadow DOM elements.
   */
  public async dispatchMouseWheel(
    deltaY: number,
    x = 600,
    y = 400,
    tabId?: string,
  ): Promise<boolean> {
    try {
      const tab = tabId
        ? (await this.listTabs()).find((t) => t.id === tabId)
        : await this.getActiveTab();
      if (!tab || !tab.webSocketDebuggerUrl) {
        return false;
      }
      await this.executeCDPCommand(
        tab.webSocketDebuggerUrl,
        'Input.dispatchMouseEvent',
        {
          type: 'mouseWheel',
          x,
          y,
          deltaX: 0,
          deltaY,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Dispatches keyboard key event to Chrome via CDP Input domain.
   */
  public async dispatchKeyEvent(
    type: 'keyDown' | 'keyUp' | 'rawKeyDown',
    key: string,
    code: string,
    windowsVirtualKeyCode: number,
    tabId?: string,
  ): Promise<boolean> {
    try {
      const tab = tabId
        ? (await this.listTabs()).find((t) => t.id === tabId)
        : await this.getActiveTab();
      if (!tab || !tab.webSocketDebuggerUrl) {
        return false;
      }
      await this.executeCDPCommand(
        tab.webSocketDebuggerUrl,
        'Input.dispatchKeyEvent',
        {
          type,
          key,
          code,
          windowsVirtualKeyCode,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  public async scroll(direction: 'up' | 'down', amount = 450, tabId?: string): Promise<boolean> {
    const yDelta = direction === 'down' ? amount : -amount;

    // 1. Send hardware-level mouse wheel event via CDP Input domain (scrolls PDFs, canvas, iframes)
    await this.dispatchMouseWheel(yDelta, 600, 400, tabId);

    // 2. Send PageDown / PageUp key event via CDP to advance document pages
    const isDown = direction === 'down';
    await this.dispatchKeyEvent(
      'rawKeyDown',
      isDown ? 'PageDown' : 'PageUp',
      isDown ? 'PageDown' : 'PageUp',
      isDown ? 0x22 : 0x21,
      tabId,
    ).catch(() => undefined);
    await this.dispatchKeyEvent(
      'keyUp',
      isDown ? 'PageDown' : 'PageUp',
      isDown ? 'PageDown' : 'PageUp',
      isDown ? 0x22 : 0x21,
      tabId,
    ).catch(() => undefined);

    // 3. Also execute multi-container DOM scroll as web fallback
    const expr = `(() => {
      try {
        window.scrollBy({ top: ${yDelta}, left: 0, behavior: 'smooth' });

        const pdfViewer = document.querySelector('pdf-viewer');
        const pdfContainer = pdfViewer?.shadowRoot?.querySelector('#viewerContainer') ||
                             document.querySelector('#viewerContainer') ||
                             document.querySelector('#viewer');
        if (pdfContainer && typeof pdfContainer.scrollBy === 'function') {
          pdfContainer.scrollBy({ top: ${yDelta}, left: 0, behavior: 'smooth' });
        }

        if (document.scrollingElement && typeof document.scrollingElement.scrollBy === 'function') {
          document.scrollingElement.scrollBy({ top: ${yDelta}, left: 0, behavior: 'smooth' });
        }
        return true;
      } catch {
        return false;
      }
    })()`;
    await this.evaluate(expr, tabId).catch(() => undefined);
    return true;
  }

  public async clickElementByText(text: string, tabId?: string): Promise<boolean> {
    const escaped = JSON.stringify(text.trim().toLowerCase());
    const expr = `(() => {
      try {
        const search = ${escaped};
        const elements = Array.from(document.querySelectorAll('button, a, input, [role="button"], span, div, h1, h2, h3, p'));
        for (const el of elements) {
          const t = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
          if (t === search || (search.length > 3 && t.includes(search))) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    })()`;
    try {
      const res = await this.evaluate<boolean>(expr, tabId);
      return Boolean(res);
    } catch {
      return false;
    }
  }

  public async click(selector: string, tabId?: string): Promise<boolean> {
    const expr = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return true;
      }
      return false;
    })()`;
    return Boolean(await this.evaluate(expr, tabId));
  }

  public async type(selector: string, text: string, tabId?: string): Promise<boolean> {
    const expr = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el && ('value' in el || el.isContentEditable)) {
        el.focus();
        if ('value' in el) el.value = ${JSON.stringify(text)};
        else el.textContent = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()`;
    return Boolean(await this.evaluate(expr, tabId));
  }

  public async readPage(
    tabId?: string,
  ): Promise<{ title: string; url: string; text: string; headings: string[] }> {
    const expr = `(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .map(h => h.textContent ? h.textContent.trim() : '')
        .filter(Boolean)
        .slice(0, 15);
      const text = (document.body ? document.body.innerText : '')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 8000);
      return {
        title: document.title,
        url: window.location.href,
        headings,
        text
      };
    })()`;
    return await this.evaluate<{ title: string; url: string; text: string; headings: string[] }>(
      expr,
      tabId,
    );
  }

  public async openYouTube(query?: string): Promise<ChromeTabInfo | null> {
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : 'https://www.youtube.com';
    return await this.createTab(url);
  }

  /**
   * Duplicates an existing tab by opening its URL in a new tab
   */
  public async duplicateTab(tabId?: string): Promise<ChromeTabInfo | null> {
    const tabs = await this.listTabs();
    const target = tabId ? tabs.find((t) => t.id === tabId) : await this.findActiveTab(tabs);
    if (!target || !target.url) {
      return null;
    }
    return await this.createTab(target.url);
  }

  /**
   * Reloads a browser tab
   */
  public async reloadTab(tabId?: string, ignoreCache = false): Promise<boolean> {
    const tabs = await this.listTabs();
    const target = tabId ? tabs.find((t) => t.id === tabId) : await this.findActiveTab(tabs);
    if (!target) return false;

    if (target.webSocketDebuggerUrl) {
      try {
        await this.executeCDPCommand(target.webSocketDebuggerUrl, 'Page.reload', { ignoreCache });
        return true;
      } catch {
        // Fallback to evaluating reload
      }
    }

    try {
      await this.evaluate(`location.reload(${ignoreCache ? 'true' : ''}); true;`, target.id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search for text across all open browser tabs and return matching snippets
   */
  public async searchTabContent(
    query: string,
    options: { caseSensitive?: boolean } = {},
  ): Promise<TabSearchResult> {
    const q = String(query ?? '').trim();
    const tabs = await this.listTabs();
    if (!q || tabs.length === 0) {
      return { query: q, totalTabs: tabs.length, matchedTabs: [] };
    }

    const caseSensitive = options.caseSensitive ?? false;
    const searchTarget = caseSensitive ? q : q.toLowerCase();

    const matches = await Promise.all(
      tabs.map(async (tab): Promise<TabSearchMatch | null> => {
        let content = '';
        let tabTitle = tab.title || '';
        let tabUrl = tab.url || '';

        if (tab.webSocketDebuggerUrl) {
          try {
            const pageData = await this.executeCDPCommand<{
              result: { value: { bodyText: string; title: string; url: string } };
            }>(
              tab.webSocketDebuggerUrl,
              'Runtime.evaluate',
              {
                expression: `(() => {
                  try {
                    return {
                      bodyText: (document.body ? document.body.innerText : '').slice(0, 50000),
                      title: document.title || '',
                      url: window.location.href
                    };
                  } catch (e) {
                    return { bodyText: '', title: document.title || '', url: window.location.href };
                  }
                })()`,
                returnByValue: true,
              },
              1000,
            );
            if (pageData?.result?.value) {
              content = pageData.result.value.bodyText || '';
              if (pageData.result.value.title) tabTitle = pageData.result.value.title;
              if (pageData.result.value.url) tabUrl = pageData.result.value.url;
            }
          } catch {
            // Tab evaluate failed, fallback to title/URL matching
          }
        }

        const compTitle = caseSensitive ? tabTitle : tabTitle.toLowerCase();
        const compUrl = caseSensitive ? tabUrl : tabUrl.toLowerCase();
        const compContent = caseSensitive ? content : content.toLowerCase();

        let count = 0;
        let snippet = '';

        // Check content occurrences
        if (compContent) {
          let pos = compContent.indexOf(searchTarget);
          while (pos !== -1) {
            count++;
            if (!snippet) {
              const start = Math.max(0, pos - 50);
              const end = Math.min(content.length, pos + searchTarget.length + 80);
              const prefix = start > 0 ? '...' : '';
              const suffix = end < content.length ? '...' : '';
              snippet = `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
            }
            pos = compContent.indexOf(searchTarget, pos + searchTarget.length);
          }
        }

        // Check title and URL
        if (compTitle.includes(searchTarget)) {
          count++;
          if (!snippet) {
            snippet = `Title match: "${tabTitle}"`;
          }
        }
        if (compUrl.includes(searchTarget)) {
          count++;
          if (!snippet) {
            snippet = `URL match: ${tabUrl}`;
          }
        }

        if (count > 0) {
          return {
            id: tab.id,
            title: tabTitle,
            url: tabUrl,
            matchCount: count,
            snippet: snippet || `Found in tab "${tabTitle}"`,
          };
        }

        return null;
      }),
    );

    const matchedTabs = matches.filter((m): m is TabSearchMatch => m !== null);
    return {
      query: q,
      totalTabs: tabs.length,
      matchedTabs,
    };
  }

  /**
   * Find and close redundant duplicate browser tabs sharing identical normalized URLs
   */
  public async closeDuplicateTabs(): Promise<{
    closedCount: number;
    closedTabs: ChromeTabInfo[];
    remainingCount: number;
  }> {
    const tabs = await this.listTabs();
    if (tabs.length <= 1) {
      return { closedCount: 0, closedTabs: [], remainingCount: tabs.length };
    }

    const normalizeUrl = (rawUrl: string): string => {
      try {
        const u = new URL(rawUrl);
        const path = u.pathname.replace(/\/+$/, '') || '/';
        return `${u.protocol}//${u.host}${path}${u.search}`;
      } catch {
        return rawUrl.trim().replace(/#.*$/, '').replace(/\/+$/, '');
      }
    };

    const activeTab = await this.findActiveTab(tabs);
    const seenUrls = new Set<string>();
    const closedTabs: ChromeTabInfo[] = [];

    // Prioritize active tab if it has a URL so we keep the active tab open
    if (activeTab && activeTab.url) {
      seenUrls.add(normalizeUrl(activeTab.url));
    }

    for (const tab of tabs) {
      if (activeTab && tab.id === activeTab.id) {
        continue;
      }
      const norm = normalizeUrl(tab.url);
      if (seenUrls.has(norm)) {
        const ok = await this.closeTab(tab.id);
        if (ok) {
          closedTabs.push(tab);
        }
      } else {
        seenUrls.add(norm);
      }
    }

    return {
      closedCount: closedTabs.length,
      closedTabs,
      remainingCount: tabs.length - closedTabs.length,
    };
  }

  private async executeCDPCommand<T = Record<string, unknown>>(
    wsUrl: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 6000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const id = this.messageSeq++;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {}
          reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      ws.on('open', () => {
        ws.send(JSON.stringify({ id, method, params }));
      });

      ws.on('message', (raw) => {
        try {
          const resp = JSON.parse(raw.toString()) as CDPResponse<T>;
          if (resp.id === id) {
            settled = true;
            clearTimeout(timer);
            try {
              ws.close();
            } catch {}
            if (resp.error) {
              reject(new Error(`CDP ${method} error: ${resp.error.message}`));
            } else {
              resolve(resp.result as T);
            }
          }
        } catch (_e) {
          /* ignore unrelated frames */
        }
      });

      ws.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private async pollTabs(): Promise<void> {
    try {
      const tabs = await this.listTabs();
      const connected = tabs.length > 0;
      if (connected !== this.isConnected) {
        this.isConnected = connected;
        this.emit('connection-changed', connected);
      }

      if (tabs.length > 0) {
        const activeTab = await this.findActiveTab(tabs);
        const prev = this.currentActiveTab;
        const changed =
          !prev ||
          !activeTab ||
          prev.id !== activeTab.id ||
          prev.title !== activeTab.title ||
          prev.url !== activeTab.url;

        if (changed && activeTab) {
          this.currentActiveTab = activeTab;
          this.emit('active-tab-changed', activeTab);
        }
      } else {
        this.currentActiveTab = null;
      }
    } catch {
      if (this.isConnected) {
        this.isConnected = false;
        this.emit('connection-changed', false);
      }
    }
  }
}
