import { describe, it, expect, beforeEach } from 'vitest';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('ComputerVisionService - Screen Text Locator (findTextOnScreen)', () => {
  let vision: ComputerVisionService;
  let appManager: AppManagerService;

  beforeEach(() => {
    appManager = new AppManagerService({ mockMode: true });
    vision = new ComputerVisionService({
      mockMode: true,
      appManager,
    });
  });

  it('returns found: false for empty or whitespace query', async () => {
    const resEmpty = await vision.findTextOnScreen('');
    expect(resEmpty.found).toBe(false);
    expect(resEmpty.matches.length).toBe(0);

    const resWhitespace = await vision.findTextOnScreen('   ');
    expect(resWhitespace.found).toBe(false);
    expect(resWhitespace.matches.length).toBe(0);
  });

  it('locates "Start" button on taskbar with precise center coordinates and bounds', async () => {
    const res = await vision.findTextOnScreen('Start');
    expect(res.found).toBe(true);
    expect(res.bestMatch).toBeDefined();

    const bm = res.bestMatch!;
    expect(bm.text).toBe('Start');
    expect(bm.source).toBe('window_control');
    expect(bm.containerTitle).toBe('Taskbar');
    // Bounds are { x: 0, y: 1032, width: 48, height: 48 }
    expect(bm.bounds).toEqual({ x: 0, y: 1032, width: 48, height: 48 });
    // Center coordinates: 0 + 24 = 24, 1032 + 24 = 1056
    expect(bm.x).toBe(24);
    expect(bm.y).toBe(1056);
    expect(bm.confidence).toBe(1.0);
  });

  it('locates "Save" command in Notepad with accurate bounding box and click position', async () => {
    const res = await vision.findTextOnScreen('Save');
    expect(res.found).toBe(true);
    expect(res.bestMatch).toBeDefined();

    const bm = res.bestMatch!;
    expect(bm.text).toBe('Save');
    expect(bm.containerTitle).toBe('Notepad');
    expect(bm.x).toBe(145); // 105 + 40
    expect(bm.y).toBe(122); // 110 + 12
    expect(bm.bounds.width).toBe(80);
    expect(bm.bounds.height).toBe(24);
  });

  it('performs case-insensitive partial substring search by default', async () => {
    const res = await vision.findTextOnScreen('chrome');
    expect(res.found).toBe(true);
    expect(res.bestMatch?.text).toContain('Google Chrome');
    expect(res.bestMatch?.x).toBeGreaterThan(0);
    expect(res.bestMatch?.y).toBeGreaterThanOrEqual(0);
  });

  it('respects exact match option', async () => {
    // Partial substring "Notep" matches with exact: false
    const partialRes = await vision.findTextOnScreen('Notep', { exact: false });
    expect(partialRes.found).toBe(true);
    expect(partialRes.bestMatch?.text).toBe('Notepad');

    // Partial substring "Notep" does not match with exact: true
    const exactRes = await vision.findTextOnScreen('Notep', { exact: true });
    expect(exactRes.found).toBe(false);

    // Full string matches with exact: true
    const fullRes = await vision.findTextOnScreen('Notepad', { exact: true });
    expect(fullRes.found).toBe(true);
    expect(fullRes.bestMatch?.text).toBe('Notepad');
  });

  it('respects case-sensitive option', async () => {
    const caseInsensitive = await vision.findTextOnScreen('save', { caseSensitive: false });
    expect(caseInsensitive.found).toBe(true);

    const caseSensitiveMismatch = await vision.findTextOnScreen('save', { caseSensitive: true });
    expect(caseSensitiveMismatch.found).toBe(false);

    const caseSensitiveMatch = await vision.findTextOnScreen('Save', { caseSensitive: true });
    expect(caseSensitiveMatch.found).toBe(true);
  });

  it('scopes text search to specific window when windowTitle is provided', async () => {
    // "File" exists in Notepad
    const notepadFile = await vision.findTextOnScreen('File', { windowTitle: 'Notepad' });
    expect(notepadFile.found).toBe(true);
    expect(notepadFile.bestMatch?.containerTitle).toBe('Notepad');

    // "File" does not exist in Calculator
    const calcFile = await vision.findTextOnScreen('File', { windowTitle: 'Calculator' });
    expect(calcFile.found).toBe(false);
  });

  it('discovers running application windows from AppManager if not in static mocks', async () => {
    const res = await vision.findTextOnScreen('PowerShell');
    expect(res.found).toBe(true);
    expect(res.bestMatch?.text).toContain('Windows PowerShell');
    expect(res.bestMatch?.source).toBe('window_title');
  });

  it('returns found: false when text does not exist anywhere on screen', async () => {
    const res = await vision.findTextOnScreen('NON_EXISTENT_TEXT_XYZ_12345');
    expect(res.found).toBe(false);
    expect(res.matches.length).toBe(0);
    expect(res.bestMatch).toBeUndefined();
  });

  it('limits results according to maxResults option', async () => {
    // Empty search or broad search
    const broad = await vision.findTextOnScreen('e', { maxResults: 3 });
    expect(broad.found).toBe(true);
    expect(broad.matches.length).toBeLessThanOrEqual(3);
  });

  it('ranks exact matches higher than partial matches', async () => {
    // Both 'Notepad' and other elements might contain 'Notepad'
    const res = await vision.findTextOnScreen('Notepad');
    expect(res.found).toBe(true);
    expect(res.bestMatch?.text).toBe('Notepad');
    expect(res.bestMatch?.confidence).toBe(1.0);
  });

  it('handles negative or zero maxResults by defaulting to safe limit', async () => {
    const resZero = await vision.findTextOnScreen('e', { maxResults: 0 });
    expect(resZero.found).toBe(true);
    expect(resZero.matches.length).toBeGreaterThan(0);

    const resNegative = await vision.findTextOnScreen('e', { maxResults: -5 });
    expect(resNegative.found).toBe(true);
    expect(resNegative.matches.length).toBeGreaterThan(0);
  });

  it('preserves negative coordinates on multi-monitor arrangements without clamping to zero', async () => {
    // Add a window on Monitor 2 (left of primary at x = -1920)
    (appManager as any).simulatedWindows.push({
      hwnd: 9001,
      title: 'Secondary Monitor Visual Studio',
      processName: 'Code',
      pid: 9911,
      isVisible: true,
      isIconic: false,
    });

    // Mock appManager findText returning negative coordinates
    const origFindText = appManager.findText.bind(appManager);
    appManager.findText = async (query: string, windowScope?: string) => {
      if (query.toLowerCase().includes('secondary')) {
        return [
          {
            text: 'Secondary Monitor Visual Studio',
            x: -960,
            y: 400,
            bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
            confidence: 0.95,
            source: 'window_title',
            containerTitle: 'Secondary Monitor Visual Studio',
          },
        ];
      }
      return origFindText(query, windowScope);
    };

    // Use non-mock vision with mock appManager to test the real mapping branch
    const multiVision = new ComputerVisionService({
      mockMode: false,
      appManager,
    });

    const res = await multiVision.findTextOnScreen('Secondary Monitor');
    expect(res.found).toBe(true);
    expect(res.bestMatch).toBeDefined();
    expect(res.bestMatch?.x).toBe(-960);
    expect(res.bestMatch?.bounds.x).toBe(-1920);
    expect(res.bestMatch?.containerTitle).toBe('Secondary Monitor Visual Studio');
  });

  it('correctly filters real-mode matches when options.windowTitle is specified', async () => {
    appManager.findText = async () => [
      {
        text: 'Save',
        x: 100,
        y: 200,
        bounds: { x: 80, y: 190, width: 40, height: 20 },
        confidence: 0.9,
        source: 'window_control',
        containerTitle: 'Microsoft Word Document',
      },
      {
        text: 'Save',
        x: 400,
        y: 200,
        bounds: { x: 380, y: 190, width: 40, height: 20 },
        confidence: 0.9,
        source: 'window_control',
        containerTitle: 'Untitled - Notepad',
      },
    ];

    const realLikeVision = new ComputerVisionService({
      mockMode: false,
      appManager,
    });

    const res = await realLikeVision.findTextOnScreen('Save', { windowTitle: 'Notepad' });
    expect(res.found).toBe(true);
    expect(res.matches.length).toBe(1);
    expect(res.bestMatch?.containerTitle).toBe('Untitled - Notepad');
  });
});
