import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiLiveService } from '../../../apps/desktop-hud/src/main/gemini-live.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('Gemini Live find_text_on_screen Tool', () => {
  let service: GeminiLiveService;
  let nativeInput: NativeInputService;
  let computerVision: ComputerVisionService;
  let appManager: AppManagerService;

  beforeEach(() => {
    const cdpClient = new CDPClient(9222, '127.0.0.1');
    nativeInput = new NativeInputService({ mockMode: true });
    appManager = new AppManagerService({ mockMode: true });
    computerVision = new ComputerVisionService({ mockMode: true, appManager });

    service = new GeminiLiveService(cdpClient, {
      nativeInput,
      computerVision,
      appManager,
    });
  });

  it('includes find_text_on_screen in setup tools payload', () => {
    const setupText = service.currentSettings;
    expect(setupText).toBeDefined();

    // Verify system instruction mentions find_text_on_screen
    const sendSetup = (service as any).sendSetup;
    expect(sendSetup).toBeDefined();
  });

  it('locates on-screen text and emits crosshair and bounding-box telemetry', async () => {
    let crosshairTarget: any = null;
    let bboxTarget: any = null;

    service.on('crosshair-target', (target) => {
      crosshairTarget = target;
    });

    service.on('bounding-box-target', (target) => {
      bboxTarget = target;
    });

    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_find_1',
              name: 'find_text_on_screen',
              args: { text: 'Start' },
            },
          ],
        },
      }),
    );

    expect(crosshairTarget).toBeDefined();
    expect(crosshairTarget.x).toBe(24);
    expect(crosshairTarget.y).toBe(1056);
    expect(crosshairTarget.label).toContain('Start');

    expect(bboxTarget).toBeDefined();
    expect(bboxTarget.width).toBe(48);
    expect(bboxTarget.height).toBe(48);
    expect(bboxTarget.label).toContain('Start');
  });

  it('supports automatic click when click: true is provided while preserving exact element bounding box', async () => {
    const actions: any[] = [];
    const emittedBoxes: any[] = [];
    nativeInput.on('action', (act) => actions.push(act));
    service.on('bounding-box-target', (bbox) => emittedBoxes.push(bbox));

    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_find_2',
              name: 'find_text_on_screen',
              args: { text: 'Save', click: true },
            },
          ],
        },
      }),
    );

    // nativeInput should have received a click action at (145, 122) with skipHighlight: true
    const clickAction = actions.find((a) => a.type === 'click');
    expect(clickAction).toBeDefined();
    expect(clickAction.x).toBe(145);
    expect(clickAction.y).toBe(122);
    expect(clickAction.skipHighlight).toBe(true);

    // Emitted bounding box should be the exact text element bounds (80x24), NOT overwritten with 80x80
    expect(emittedBoxes.length).toBe(1);
    expect(emittedBoxes[0].width).toBe(80);
    expect(emittedBoxes[0].height).toBe(24);
    expect(emittedBoxes[0].label).toContain('Save');
  });

  it('forwards exact and case_sensitive arguments from tool call to findTextOnScreen', async () => {
    let capturedOptions: any = null;
    const origFind = computerVision.findTextOnScreen.bind(computerVision);
    computerVision.findTextOnScreen = async (q, opts) => {
      capturedOptions = opts;
      return origFind(q, opts);
    };

    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_find_opts',
              name: 'find_text_on_screen',
              args: { text: 'Notepad', exact: true, case_sensitive: true, max_results: 5 },
            },
          ],
        },
      }),
    );

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.exact).toBe(true);
    expect(capturedOptions.caseSensitive).toBe(true);
    expect(capturedOptions.maxResults).toBe(5);
  });

  it('handles negative monitor coordinates without clamping to zero in click listener', async () => {
    let emittedBbox: any = null;
    let emittedCrosshair: any = null;
    service.on('bounding-box-target', (b) => {
      emittedBbox = b;
    });
    service.on('crosshair-target', (c) => {
      emittedCrosshair = c;
    });

    // Simulate an action with negative coordinates (Monitor 2 left of Primary)
    await nativeInput.mouseClick(-500, 300);

    expect(emittedCrosshair).toBeDefined();
    expect(emittedCrosshair.x).toBe(-500);
    expect(emittedCrosshair.y).toBe(300);

    expect(emittedBbox).toBeDefined();
    expect(emittedBbox.x).toBe(-540); // -500 - 40, NOT clamped to 0
    expect(emittedBbox.y).toBe(260); // 300 - 40
  });

  it('handles not found gracefully without errors', async () => {
    const messages: any[] = [];
    service.on('conversation-message', (m) => messages.push(m));

    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_find_3',
              name: 'find_text_on_screen',
              args: { text: 'UNRECOGNIZED_GIBBERISH_9876' },
            },
          ],
        },
      }),
    );

    const completedMsg = messages.find((m) => m.title?.includes('Completed: find_text_on_screen'));
    expect(completedMsg).toBeDefined();
  });
});
