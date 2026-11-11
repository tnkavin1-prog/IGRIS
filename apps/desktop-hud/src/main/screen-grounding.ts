/**
 * Screen Grounding — visual element detection for autonomous computer use.
 *
 * Provides the ability to find UI elements on the screen by description,
 * wait for elements to appear, and read on-screen text. This is the "eyes"
 * of the Tier-1 autonomous agent — it lets Gematron see what's on screen
 * and decide where to click, what to type, and whether an action succeeded.
 *
 * Uses a layered strategy:
 *   1. findTextOnScreen (existing) — text-based element location
 *   2. AppManager window enumeration — window titles and bounds
 *   3. CDP DOM inspection — browser elements (when Chrome is controlled)
 *   4. Visual template matching — placeholder for image-based matching
 */

import type { CaptureResult, FindTextOptions, TextLocationResult } from './types.js';
import type { ComputerVisionService } from './computer-vision.js';
import type { AppManagerService } from './app-manager.js';
import type { CDPClient } from './cdp-client.js';
import { NativeInputService } from './native-input.js';

const ni = new NativeInputService();

export interface ScreenElement {
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  source: 'text' | 'window' | 'dom' | 'template';
  container?: string;
}

export interface WaitForElementOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  description: string;
  containerTitle?: string;
}

export interface GroundingOptions {
  appManager?: AppManagerService;
  cdpClient?: CDPClient;
  computerVision?: ComputerVisionService;
}

/**
 * ScreenGroundingService finds UI elements on the desktop so the autonomous
 * agent can click, type, and verify actions without knowing exact coordinates.
 */
export class ScreenGroundingService {
  private appManager?: AppManagerService;
  private cdpClient?: CDPClient;
  private computerVision?: ComputerVisionService;

  constructor(options: GroundingOptions = {}) {
    this.appManager = options.appManager;
    this.cdpClient = options.cdpClient;
    this.computerVision = options.computerVision;
  }

  public setAppManager(appManager: AppManagerService): void {
    this.appManager = appManager;
  }

  public setCDPClient(cdpClient: CDPClient): void {
    this.cdpClient = cdpClient;
  }

  public setComputerVision(cv: ComputerVisionService): void {
    this.computerVision = cv;
  }

  /**
   * Find a UI element on screen by its text/description.
   * Returns the best match with clickable coordinates.
   */
  public async findElement(
    description: string,
    options: { containerTitle?: string; exact?: boolean; threshold?: number } = {},
  ): Promise<ScreenElement | null> {
    const { containerTitle, exact = false, threshold = 0.6 } = options;

    // Strategy 1: Text-based search via ComputerVision (window titles + controls + CDP DOM)
    if (this.computerVision) {
      try {
        const result = await this.computerVision.findTextOnScreen(description, {
          windowTitle: containerTitle,
          exact,
          maxResults: 5,
        } as FindTextOptions);

        if (result.found && result.bestMatch && result.bestMatch.confidence >= threshold) {
          const m = result.bestMatch;
          return {
            description,
            x: m.x,
            y: m.y,
            width: m.bounds.width,
            height: m.bounds.height,
            confidence: m.confidence,
            source: m.source === 'browser_dom' ? 'dom' : (m.source as ScreenElement['source']),
            container: m.containerTitle,
          };
        }
      } catch {
        /* fall through to other strategies */
      }
    }

    // Strategy 2: Window title matching via AppManager
    if (this.appManager) {
      try {
        const windows = await this.appManager.listRunningWindows();
        const match = windows.find((w) => {
          const t = w.title.toLowerCase();
          const d = description.toLowerCase();
          return exact ? t === d : t.includes(d) || d.includes(t);
        });
        if (match) {
          const bounds = await this.appManager.getWindowBounds(match.hwnd || match.title);
          return {
            description,
            x: bounds.x + Math.round(bounds.width / 2),
            y: bounds.y + Math.min(30, Math.round(bounds.height / 2)),
            width: bounds.width,
            height: bounds.height,
            confidence: 0.9,
            source: 'window',
            container: match.title,
          };
        }
      } catch {
        /* fall through */
      }
    }

    // Strategy 3: CDP DOM element search (browser only)
    if (this.cdpClient) {
      try {
        // Try to click element by text via CDP first
        const clicked = await this.cdpClient.clickElementByText(description).catch(() => false);
        if (clicked) {
          // We don't have coordinates from CDP click, use center of viewport
          return {
            description,
            x: 960,
            y: 540,
            width: 100,
            height: 40,
            confidence: 0.85,
            source: 'dom',
          };
        }
      } catch {
        /* fall through */
      }
    }

    return null;
  }

  /**
   * Wait for a UI element to appear on screen, polling at intervals.
   * Resolves with the element when found, or null on timeout.
   */
  public async waitForElement(options: WaitForElementOptions): Promise<ScreenElement | null> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const el = await this.findElement(options.description, {
          containerTitle: options.containerTitle,
        });
        if (el) return el;
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return null;
  }

  /**
   * Click a UI element found by description.
   * Returns true if the element was found and clicked.
   */
  public async clickElement(
    description: string,
    options: {
      containerTitle?: string;
      button?: 'left' | 'right' | 'middle';
      double?: boolean;
    } = {},
  ): Promise<{ ok: boolean; element?: ScreenElement; error?: string }> {
    const el = await this.findElement(description, {
      containerTitle: options.containerTitle,
    });
    if (!el) {
      return { ok: false, error: `Element not found on screen: "${description}"` };
    }

    const ok = await ni.mouseClick(el.x, el.y, {
      button: options.button || 'left',
      double: options.double ?? false,
      scaleWithDpi: true,
    });

    if (!ok) {
      return { ok: false, element: el, error: `Failed to click element: "${description}"` };
    }

    return { ok: true, element: el };
  }

  /**
   * Type text into a focused field, optionally after clicking an element.
   */
  public async typeInto(
    description: string | null,
    text: string,
    options: { pressEnter?: boolean; containerTitle?: string } = {},
  ): Promise<{ ok: boolean; element?: ScreenElement; error?: string }> {
    if (description) {
      const clicked = await this.clickElement(description, {
        containerTitle: options.containerTitle,
      });
      if (!clicked.ok) {
        return { ok: false, error: clicked.error };
      }
      // Brief settle time after click
      await new Promise((r) => setTimeout(r, 300));
    }

    const ok = await ni.typeText(text);
    if (!ok) {
      return { ok: false, error: 'Failed to type text' };
    }

    if (options.pressEnter) {
      await ni.sendHotkey('Enter');
    }

    return { ok: true };
  }

  /**
   * Press a hotkey (e.g. Ctrl+O, F12, Ctrl+S).
   */
  public async pressHotkey(keys: string | string[]): Promise<{ ok: boolean }> {
    const ok = await ni.sendHotkey(keys);
    return { ok };
  }

  /**
   * Capture the current screen and return it as a base64 image.
   * Used by the autonomous agent to "see" the current state.
   */
  public async captureScreen(): Promise<CaptureResult | null> {
    if (!this.computerVision) return null;
    try {
      return await this.computerVision.captureScreen();
    } catch {
      return null;
    }
  }

  /**
   * Read on-screen text matching a query.
   * Returns all matches with coordinates.
   */
  public async readScreen(
    query: string,
    options: FindTextOptions = {},
  ): Promise<TextLocationResult> {
    if (!this.computerVision) {
      return { found: false, query, matches: [] };
    }
    return this.computerVision.findTextOnScreen(query, options);
  }

  /**
   * Check whether a specific UI element (by text) is currently visible on screen.
   */
  public async isElementVisible(description: string): Promise<boolean> {
    const el = await this.findElement(description);
    return el !== null;
  }
}

export const screenGrounding = new ScreenGroundingService();
