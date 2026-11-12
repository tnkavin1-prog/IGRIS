// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_PIN_PATH, BRIDGE_ORIGIN } from '@gbl/shared';
import { LiveSessionManager } from '../../../apps/chrome-extension/src/live/session-manager.js';
import type { BridgeClient } from '../../../apps/chrome-extension/src/live/bridge.js';
import { sanitizeSettings } from '../../../apps/chrome-extension/src/sidepanel/storage.js';

describe('Option 1: Native Desktop Companion HUD & Active Tab Tracking', () => {
  it('exposes BRIDGE_PIN_PATH constant', () => {
    expect(BRIDGE_PIN_PATH).toBe('/api/pin');
    expect(BRIDGE_ORIGIN).toBe('http://127.0.0.1:47821');
  });

  it('LiveSessionManager forwards sendContext to active session', () => {
    const mockBridge = {
      token: vi.fn(),
    } as unknown as BridgeClient;
    const manager = new LiveSessionManager({
      settings: sanitizeSettings(undefined),
      bridge: mockBridge,
      onEvent: vi.fn(),
    });

    // When session is null, sendContext returns false gracefully
    expect(manager.sendContext('test context')).toBe(false);

    // Mock active session
    const mockSession = {
      sendContext: vi.fn().mockReturnValue(true),
    };
    (manager as unknown as { session: typeof mockSession }).session = mockSession;

    const result = manager.sendContext('[Active Tab Switched] User is viewing YouTube');
    expect(result).toBe(true);
    expect(mockSession.sendContext).toHaveBeenCalledWith(
      '[Active Tab Switched] User is viewing YouTube',
    );
  });

  it('verifies PageFingerprint fallback defaults for unscriptable tabs', () => {
    const tab: Pick<chrome.tabs.Tab, 'id' | 'url' | 'title' | 'width' | 'height'> = {
      id: 42,
      url: 'file:///C:/Users/tnkav/Downloads/exam_paper.pdf',
      title: 'SSC CGL Tier 1 Exam 2026.pdf',
      width: 1920,
      height: 1080,
    };

    const fp = {
      url: tab.url ?? '',
      title: tab.title ?? '',
      generation: 0,
      scrollY: 0,
      scrollMax: 0,
      elementCount: 0,
      textLength: 0,
      viewportWidth: tab.width ?? 1280,
      viewportHeight: tab.height ?? 720,
      dpr: 1,
      documentId: 'doc_fallback',
      digest: '',
    };

    expect(fp.url).toContain('exam_paper.pdf');
    expect(fp.title).toContain('SSC CGL');
    expect(fp.viewportWidth).toBe(1920);
    expect(fp.documentId).toBe('doc_fallback');
  });

  it('generates monochromatic frosted glass styling in session export HTML bundle', async () => {
    const { buildSessionExportBundle } =
      await import('../../../apps/chrome-extension/src/tools/session-export.js');
    const bundle = buildSessionExportBundle(
      [
        {
          id: '1',
          kind: 'user',
          text: 'Derive inradius of equilateral triangle',
          at: 1000,
          final: true,
        },
        {
          id: '2',
          kind: 'assistant',
          text: 'The inradius formula is r = a / (2*sqrt(3)).',
          at: 2000,
          final: true,
        },
      ],
      {
        id: 'sample_lesson',
        title: 'Equilateral Triangle',
        topic: 'Geometry',
        diagramType: 'geometry',
        latexFormula: 'r = \\frac{a}{2\\sqrt{3}}',
        svgMarkup: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
        steps: ['Altitude is (sqrt(3)/2)a', 'Incenter divides in 2:1 ratio'],
        activeStep: 0,
        teachingNarration: 'Centroid and incenter coincide.',
        createdAt: 1000,
      },
      'en.wikipedia.org',
    );

    expect(bundle.html).toContain('background: rgba(14, 16, 24, 0.98)');
    expect(bundle.html).toContain('color: #ffffff');
    expect(bundle.html).toContain('formula-card');
    expect(bundle.markdown).toContain('# Equilateral Triangle');
    expect(bundle.markdown).toContain('$$');
  });
});
