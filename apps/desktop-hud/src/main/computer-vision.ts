import { app, desktopCapturer, screen } from 'electron';
import type {
  CaptureResult,
  DesktopSourceInfo,
  DisplayMetrics,
  FindTextOptions,
  SingleDisplayInfo,
  TextLocationResult,
  TextMatch,
} from './types.js';
import type { AppManagerService } from './app-manager.js';
import type { CDPClient } from './cdp-client.js';

export interface ComputerVisionOptions {
  mockMode?: boolean;
  appManager?: AppManagerService;
  cdpClient?: CDPClient;
}

export interface MockScreenElement {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
  source: 'window_title' | 'window_control' | 'mock';
  containerTitle?: string;
}

const DEFAULT_MOCK_ELEMENTS: MockScreenElement[] = [
  {
    text: 'Start',
    bounds: { x: 0, y: 1032, width: 48, height: 48 },
    source: 'window_control',
    containerTitle: 'Taskbar',
  },
  { text: 'Taskbar', bounds: { x: 0, y: 1032, width: 1920, height: 48 }, source: 'window_control' },
  {
    text: 'Google Chrome',
    bounds: { x: 100, y: 0, width: 1000, height: 40 },
    source: 'window_title',
  },
  {
    text: 'New Tab',
    bounds: { x: 240, y: 8, width: 80, height: 24 },
    source: 'window_control',
    containerTitle: 'Google Chrome',
  },
  {
    text: 'Search Google or type a URL',
    bounds: { x: 300, y: 50, width: 600, height: 36 },
    source: 'window_control',
    containerTitle: 'Google Chrome',
  },
  { text: 'Notepad', bounds: { x: 100, y: 50, width: 800, height: 30 }, source: 'window_title' },
  {
    text: 'File',
    bounds: { x: 105, y: 85, width: 35, height: 22 },
    source: 'window_control',
    containerTitle: 'Notepad',
  },
  {
    text: 'Edit',
    bounds: { x: 145, y: 85, width: 35, height: 22 },
    source: 'window_control',
    containerTitle: 'Notepad',
  },
  {
    text: 'View',
    bounds: { x: 185, y: 85, width: 35, height: 22 },
    source: 'window_control',
    containerTitle: 'Notepad',
  },
  {
    text: 'Save',
    bounds: { x: 105, y: 110, width: 80, height: 24 },
    source: 'window_control',
    containerTitle: 'Notepad',
  },
  {
    text: 'Visual Studio Code',
    bounds: { x: 200, y: 0, width: 1400, height: 35 },
    source: 'window_title',
  },
  { text: 'Submit', bounds: { x: 750, y: 580, width: 100, height: 40 }, source: 'window_control' },
  { text: 'Cancel', bounds: { x: 870, y: 580, width: 100, height: 40 }, source: 'window_control' },
  { text: 'OK', bounds: { x: 760, y: 485, width: 80, height: 30 }, source: 'window_control' },
  { text: 'Settings', bounds: { x: 1830, y: 15, width: 50, height: 30 }, source: 'window_control' },
  {
    text: 'Calculator',
    bounds: { x: 400, y: 200, width: 320, height: 500 },
    source: 'window_title',
  },
];

export class ComputerVisionService {
  private mockMode: boolean;
  private appManager?: AppManagerService;
  private cdpClient?: CDPClient;

  constructor(options: ComputerVisionOptions = {}) {
    // Auto-detect mock mode if running in Vitest or non-Electron test runner
    this.mockMode = options.mockMode ?? typeof desktopCapturer === 'undefined';
    this.appManager = options.appManager;
    this.cdpClient = options.cdpClient;
  }

  public setAppManager(appManager: AppManagerService): void {
    this.appManager = appManager;
  }

  public setCDPClient(cdpClient: CDPClient): void {
    this.cdpClient = cdpClient;
  }

  /**
   * Set mock mode explicitly (useful for unit tests)
   */
  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  /**
   * List all available desktop screens and active application windows
   */
  public async listSources(): Promise<DesktopSourceInfo[]> {
    if (this.mockMode || typeof desktopCapturer === 'undefined') {
      return [
        {
          id: 'screen:0:0',
          name: 'Primary Display (1920x1080)',
          isScreen: true,
          displayId: 'primary',
        },
        { id: 'window:101:0', name: 'Google Chrome', isScreen: false },
        { id: 'window:102:0', name: 'Visual Studio Code', isScreen: false },
      ];
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });

      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        displayId: s.display_id,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : undefined,
      }));
    } catch (err) {
      console.warn('[ComputerVision] Error listing sources via desktopCapturer:', err);
      return [];
    }
  }

  /**
   * Capture full desktop screen (primary display by default or matching sourceId)
   */
  public async captureScreen(
    sourceId?: string,
    options?: { maxWidth?: number; maxHeight?: number; quality?: number },
  ): Promise<CaptureResult> {
    if (this.mockMode || typeof desktopCapturer === 'undefined') {
      // 1x1 black JPEG pixel base64 for simulation
      const mockJpeg =
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      return {
        data: mockJpeg,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        sourceId: sourceId || 'screen:mock:0',
        sourceName: 'Mock Desktop Screen',
        timestamp: Date.now(),
      };
    }

    const metrics = this.getDisplayMetrics();
    const targetWidth = options?.maxWidth
      ? options.maxWidth
      : Math.max(1920, Math.round(metrics.bounds.width * metrics.scaleFactor));
    const targetHeight = options?.maxHeight
      ? options.maxHeight
      : Math.max(1080, Math.round(metrics.bounds.height * metrics.scaleFactor));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetWidth, height: targetHeight },
    });

    const target = (sourceId && sources.find((s) => s.id === sourceId)) || sources[0];
    if (!target) {
      throw new Error('No desktop screen sources found to capture.');
    }

    const img = target.thumbnail;
    const size = img.getSize();
    const quality = options?.quality ?? 85;
    const base64 = img.toJPEG(quality).toString('base64');

    return {
      data: base64,
      mimeType: 'image/jpeg',
      width: size.width,
      height: size.height,
      sourceId: target.id,
      sourceName: target.name,
      timestamp: Date.now(),
    };
  }

  /**
   * Capture a specific application window by title query or sourceId
   */
  public async captureWindow(windowTitleOrId: string): Promise<CaptureResult> {
    if (this.mockMode || typeof desktopCapturer === 'undefined') {
      const mockJpeg =
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      return {
        data: mockJpeg,
        mimeType: 'image/jpeg',
        width: 1280,
        height: 720,
        sourceId: windowTitleOrId,
        sourceName: `Mock Window: ${windowTitleOrId}`,
        timestamp: Date.now(),
      };
    }

    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    const target = sources.find(
      (s) =>
        s.id === windowTitleOrId || s.name.toLowerCase().includes(windowTitleOrId.toLowerCase()),
    );

    if (!target) {
      throw new Error(`Window matching "${windowTitleOrId}" not found among capture sources.`);
    }

    const img = target.thumbnail;
    const size = img.getSize();
    const base64 = img.toJPEG(85).toString('base64');

    return {
      data: base64,
      mimeType: 'image/jpeg',
      width: size.width,
      height: size.height,
      sourceId: target.id,
      sourceName: target.name,
      timestamp: Date.now(),
    };
  }

  /**
   * Retrieve current display resolution, bounds, and scale factor across all displays
   */
  public getDisplayMetrics(): DisplayMetrics {
    const isAppReady =
      typeof app !== 'undefined' &&
      app !== null &&
      typeof app.isReady === 'function' &&
      app.isReady();

    if (this.mockMode || !isAppReady) {
      return {
        width: 1920,
        height: 1080,
        scaleFactor: 1.0,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        allDisplays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1.0,
            isPrimary: true,
          },
        ],
        virtualBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      };
    }

    try {
      const primary = screen.getPrimaryDisplay();
      const displays = screen.getAllDisplays();

    let minX = 0;
    let minY = 0;
    let maxX = primary.bounds.width;
    let maxY = primary.bounds.height;

    const allDisplays: SingleDisplayInfo[] = displays.map((d) => {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.height);

      return {
        id: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primary.id,
      };
    });

    return {
      width: primary.size.width,
      height: primary.size.height,
      scaleFactor: primary.scaleFactor,
      bounds: { ...primary.bounds },
      allDisplays,
      virtualBounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    };
  } catch {
    return {
      width: 1920,
      height: 1080,
      scaleFactor: 1.0,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      allDisplays: [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1.0,
          isPrimary: true,
        },
      ],
      virtualBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    };
  }
  }

  /**
   * Search on-screen text, window labels, and controls to return precise click coordinates (x, y)
   */
  public async findTextOnScreen(
    query: string,
    options: FindTextOptions = {},
  ): Promise<TextLocationResult> {
    const q = query.trim();
    if (!q) {
      return { found: false, query, matches: [] };
    }

    const isMatch = (targetText: string): boolean => {
      if (options.exact) {
        return options.caseSensitive
          ? targetText === q
          : targetText.toLowerCase() === q.toLowerCase();
      }
      return options.caseSensitive
        ? targetText.includes(q)
        : targetText.toLowerCase().includes(q.toLowerCase());
    };

    if (this.mockMode) {
      const matches: TextMatch[] = [];

      for (const el of DEFAULT_MOCK_ELEMENTS) {
        if (
          options.windowTitle &&
          el.containerTitle &&
          !el.containerTitle.toLowerCase().includes(options.windowTitle.toLowerCase())
        ) {
          continue;
        }

        if (isMatch(el.text)) {
          const cx = el.bounds.x + Math.round(el.bounds.width / 2);
          const cy = el.bounds.y + Math.round(el.bounds.height / 2);
          const isExact = el.text.toLowerCase() === q.toLowerCase();
          matches.push({
            text: el.text,
            x: cx,
            y: cy,
            bounds: { ...el.bounds },
            confidence: isExact ? 1.0 : 0.85,
            source: el.source,
            containerTitle: el.containerTitle,
          });
        }
      }

      if (this.appManager) {
        try {
          const wins = await this.appManager.listRunningWindows();
          for (const w of wins) {
            if (
              options.windowTitle &&
              !w.title.toLowerCase().includes(options.windowTitle.toLowerCase())
            ) {
              continue;
            }
            if (isMatch(w.title)) {
              if (!matches.some((m) => m.text === w.title)) {
                matches.push({
                  text: w.title,
                  x: 700,
                  y: 120,
                  bounds: { x: 100, y: 100, width: 1200, height: 40 },
                  confidence: w.title.toLowerCase() === q.toLowerCase() ? 1.0 : 0.9,
                  source: 'window_title',
                });
              }
            }
          }
        } catch {
          /* ignore */
        }
      }

      const maxResults =
        typeof options.maxResults === 'number' && options.maxResults > 0 ? options.maxResults : 10;
      const sorted = matches
        .sort((a, b) => {
          if (b.confidence !== a.confidence) {
            return b.confidence - a.confidence;
          }
          const aExact = a.text.toLowerCase() === q.toLowerCase() ? 1 : 0;
          const bExact = b.text.toLowerCase() === q.toLowerCase() ? 1 : 0;
          if (bExact !== aExact) return bExact - aExact;
          return a.text.length - b.text.length;
        })
        .slice(0, maxResults);

      return {
        found: sorted.length > 0,
        query,
        matches: sorted,
        bestMatch: sorted[0],
      };
    }

    const matches: TextMatch[] = [];

    // 1. Check Win32 / AppManager text search (window titles + child controls)
    if (this.appManager) {
      try {
        const rawMatches = await this.appManager.findText(q, options.windowTitle);
        for (const rm of rawMatches) {
          if (
            options.windowTitle &&
            rm.containerTitle &&
            !rm.containerTitle.toLowerCase().includes(options.windowTitle.toLowerCase())
          ) {
            continue;
          }
          if (isMatch(rm.text)) {
            matches.push({
              text: rm.text,
              x: rm.x,
              y: rm.y,
              bounds: rm.bounds,
              confidence: rm.text.toLowerCase() === q.toLowerCase() ? 1.0 : rm.confidence,
              source: (rm.source as any) || 'window_control',
              containerTitle: rm.containerTitle,
            });
          }
        }
      } catch (err) {
        console.warn('[ComputerVision] AppManager text search error:', err);
      }
    }

    // 2. Check running windows directly if no controls matched
    if (matches.length === 0 && this.appManager) {
      try {
        const wins = await this.appManager.listRunningWindows();
        for (const w of wins) {
          if (
            options.windowTitle &&
            !w.title.toLowerCase().includes(options.windowTitle.toLowerCase())
          ) {
            continue;
          }
          if (isMatch(w.title)) {
            const bounds = await this.appManager.getWindowBounds(w.hwnd || w.title);
            if (bounds.width > 0 && bounds.height > 0) {
              matches.push({
                text: w.title,
                x: bounds.x + Math.round(bounds.width / 2),
                y: bounds.y + Math.min(25, Math.round(bounds.height / 2)),
                bounds,
                confidence: 0.92,
                source: 'window_title',
              });
            }
          }
        }
      } catch (err) {
        console.warn('[ComputerVision] Window titles search error:', err);
      }
    }

    // 3. Check active Chrome tab via CDP if connected
    if (matches.length === 0 && this.cdpClient) {
      try {
        const pageData = await this.cdpClient.readPage();
        if (pageData && pageData.text && isMatch(pageData.text)) {
          matches.push({
            text: pageData.title || q,
            x: 960,
            y: 540,
            bounds: { x: 200, y: 150, width: 1520, height: 800 },
            confidence: 0.88,
            source: 'browser_dom',
            containerTitle: pageData.title,
          });
        }
      } catch {
        /* ignore */
      }
    }

    const maxResults =
      typeof options.maxResults === 'number' && options.maxResults > 0 ? options.maxResults : 10;
    const sorted = matches
      .sort((a, b) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        const aExact = a.text.toLowerCase() === q.toLowerCase() ? 1 : 0;
        const bExact = b.text.toLowerCase() === q.toLowerCase() ? 1 : 0;
        if (bExact !== aExact) return bExact - aExact;
        return a.text.length - b.text.length;
      })
      .slice(0, maxResults);

    return {
      found: sorted.length > 0,
      query,
      matches: sorted,
      bestMatch: sorted[0],
    };
  }
}
