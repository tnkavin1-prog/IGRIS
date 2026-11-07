import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiLiveService } from '../../../apps/desktop-hud/src/main/gemini-live.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('GeminiLiveService', () => {
  let cdpClient: CDPClient;
  let service: GeminiLiveService;

  beforeEach(() => {
    cdpClient = new CDPClient(9222, '127.0.0.1');
    service = new GeminiLiveService(cdpClient, {
      nativeInput: new NativeInputService({ mockMode: true }),
      computerVision: new ComputerVisionService({ mockMode: true }),
      appManager: new AppManagerService({ mockMode: true }),
    });
  });

  it('loads default settings with gemini-3.8-live, Kore voice, and sound enabled', () => {
    const settings = service.currentSettings;
    expect(settings.modelId).toBe('gemini-3.8-live');
    expect(settings.voice).toBe('Kore');
    expect(settings.autoApprove).toBe(true);
    expect(settings.alwaysOnTop).toBe(true);
    expect(settings.soundEffectsEnabled).toBe(true);
    expect(settings.soundVolume).toBe(0.5);
  });

  it('updates settings and emits settings-updated', () => {
    let updated: any = null;
    service.on('settings-updated', (s) => {
      updated = s;
    });

    service.updateSettings({
      voice: 'Puck',
      autoApprove: false,
      soundEffectsEnabled: false,
      soundVolume: 0.25,
    });
    expect(service.currentSettings.voice).toBe('Puck');
    expect(service.currentSettings.autoApprove).toBe(false);
    expect(service.currentSettings.soundEffectsEnabled).toBe(false);
    expect(service.currentSettings.soundVolume).toBe(0.25);
    expect(updated.voice).toBe('Puck');
    expect(updated.soundVolume).toBe(0.25);
  });

  it('correctly processes serverContent with transcription, audio, and interruption', async () => {
    const messages: any[] = [];
    let receivedAudio = false;
    let receivedInterrupted = false;
    let turnCompleted = false;

    service.on('conversation-message', (m) => messages.push(m));
    service.on('audio-chunk', () => {
      receivedAudio = true;
    });
    service.on('interrupted', () => {
      receivedInterrupted = true;
    });
    service.on('turn-complete', () => {
      turnCompleted = true;
    });

    // Simulate incoming server messages via private handler
    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'How do you derive the area of a circle sector?' },
        },
      }),
    );

    expect(messages.length).toBe(1);
    expect(messages[0].kind).toBe('user');
    expect(messages[0].text).toContain('circle sector');

    await handler(
      JSON.stringify({
        serverContent: {
          outputTranscription: {
            text: 'To derive the area of a sector, notice it is a fraction of πr².',
          },
          modelTurn: {
            parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'dGVzdA==' } }],
          },
        },
      }),
    );

    expect(messages.length).toBe(2);
    expect(messages[1].kind).toBe('assistant');
    expect(receivedAudio).toBe(true);

    await handler(
      JSON.stringify({
        serverContent: {
          interrupted: true,
        },
      }),
    );
    expect(receivedInterrupted).toBe(true);

    await handler(
      JSON.stringify({
        serverContent: {
          turnComplete: true,
        },
      }),
    );
    expect(turnCompleted).toBe(true);
  });

  it('handles teach_visual_blackboard tool call and emits blackboard-lesson', async () => {
    let emittedLesson: any = null;
    service.on('blackboard-lesson', (l) => {
      emittedLesson = l;
    });

    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_123',
              name: 'teach_visual_blackboard',
              args: {
                title: 'Derivation of Quadratic Formula',
                topic: 'Algebra',
                diagram_type: 'formula',
                latex_formula: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
                svg_markup: '<svg><rect/></svg>',
                steps: ['Divide by a', 'Complete the square', 'Take square root'],
                teaching_narration: 'Completing the square mirrors geometric squaring.',
              },
            },
          ],
        },
      }),
    );

    expect(emittedLesson).not.toBeNull();
    expect(emittedLesson.title).toBe('Derivation of Quadratic Formula');
    expect(emittedLesson.steps.length).toBe(3);
    expect(emittedLesson.latexFormula).toContain('\\frac{-b');
  });

  it('handles interactionStatus for extended thinking models', async () => {
    const handler = (service as any).handleServerMessage.bind(service);

    await handler(
      JSON.stringify({
        interactionStatus: 'IN_PROGRESS',
      }),
    );
    expect(service.currentStatus).toBe('thinking');

    await handler(
      JSON.stringify({
        interactionStatus: 'IDLE',
      }),
    );
    expect(service.currentStatus).toBe('listening');
  });

  it('formats tool responses with id, name, and standard result', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1, // OPEN
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_math_1',
              name: 'teach_visual_blackboard',
              args: {
                title: 'Pythagorean Theorem',
                latex_formula: 'a^2 + b^2 = c^2',
                svg_markup: '<svg></svg>',
                steps: ['Construct square on hypotenuse'],
              },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(1);
    expect(responses[0].id).toBe('call_math_1');
    expect(responses[0].name).toBe('teach_visual_blackboard');
    expect(responses[0].response.result.success).toBe(true);
  });

  it('formats realtimeInput with audio and video keys', () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1, // OPEN
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    service.sendAudioChunk('AQIDBA==');
    expect(sentPayload.realtimeInput.audio).toEqual({
      mimeType: 'audio/pcm;rate=16000',
      data: 'AQIDBA==',
    });

    service.sendImageFrame('/9j/4AAQSkZJRg==');
    expect(sentPayload.realtimeInput.video).toEqual({
      mimeType: 'image/jpeg',
      data: '/9j/4AAQSkZJRg==',
    });
  });

  it('handles computer_use_click tool call and emits crosshair-target event', async () => {
    let crosshairTarget: any = null;
    service.on('crosshair-target', (t) => {
      crosshairTarget = t;
    });

    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_click_1',
              name: 'computer_use_click',
              args: { x: 500, y: 300, button: 'left', double: false, description: 'Submit Button' },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const res = sentPayload.toolResponse.functionResponses[0];
    expect(res.name).toBe('computer_use_click');
    expect(res.response.result.success).toBe(true);
    expect(res.response.result.x).toBe(500);
    expect(res.response.result.y).toBe(300);

    expect(crosshairTarget).not.toBeNull();
    expect(crosshairTarget.x).toBe(500);
    expect(crosshairTarget.y).toBe(300);
  });

  it('handles computer_use_type and computer_use_hotkey tool calls', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_type_1',
              name: 'computer_use_type',
              args: { text: 'Jarvis autonomous typing', press_enter: true },
            },
            {
              id: 'call_hotkey_1',
              name: 'computer_use_hotkey',
              args: { keys: ['Control', 's'] },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(2);
    expect(responses[0].name).toBe('computer_use_type');
    expect(responses[0].response.result.success).toBe(true);
    expect(responses[1].name).toBe('computer_use_hotkey');
    expect(responses[1].response.result.success).toBe(true);
  });

  it('handles computer_use_screenshot tool call and feeds frame to vision', async () => {
    const sentFrames: any[] = [];
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        const parsed = JSON.parse(str);
        if (parsed.realtimeInput?.video) {
          sentFrames.push(parsed.realtimeInput.video);
        }
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_shot_1',
              name: 'computer_use_screenshot',
              args: { target: 'screen', feed_to_vision: true },
            },
          ],
        },
      }),
    );

    expect(sentFrames.length).toBeGreaterThan(0);
    expect(sentFrames[0].mimeType).toBe('image/jpeg');
  });

  it('handles launch_application, switch_active_window, and run_system_command', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_launch_1',
              name: 'launch_application',
              args: { app_name: 'notepad' },
            },
            {
              id: 'call_switch_1',
              name: 'switch_active_window',
              args: { window_title: 'notepad' },
            },
            {
              id: 'call_cmd_1',
              name: 'run_system_command',
              args: { command: 'Get-Date' },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(3);
    expect(responses[0].response.result.ok).toBe(true);
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[2].response.result.ok).toBe(true);
  });

  it('handles tool parameter aliases seamlessly (appName, query, hotkey, cmd)', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'alias_launch',
              name: 'launch_application',
              args: { appName: 'calc' },
            },
            {
              id: 'alias_switch',
              name: 'switch_active_window',
              args: { query: 'Chrome' },
            },
            {
              id: 'alias_hotkey',
              name: 'computer_use_hotkey',
              args: { hotkey: 'Win+R' },
            },
            {
              id: 'alias_cmd',
              name: 'run_system_command',
              args: { cmd: 'Get-Date' },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(4);
    expect(responses[0].response.result.ok).toBe(true);
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[2].response.result.success).toBe(true);
    expect(responses[3].response.result.ok).toBe(true);
  });

  it('handles manage_browser_tabs and plan_autonomous_task', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_tab_1',
              name: 'manage_browser_tabs',
              args: { action: 'list' },
            },
            {
              id: 'call_plan_1',
              name: 'plan_autonomous_task',
              args: { goal: 'Open Notepad and type test summary' },
            },
            {
              id: 'call_state_1',
              name: 'get_desktop_state',
              args: {},
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(3);
    expect(responses[0].name).toBe('manage_browser_tabs');
    expect(responses[1].name).toBe('plan_autonomous_task');
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[1].response.result.taskId).toBeDefined();
    expect(responses[2].name).toBe('get_desktop_state');
    expect(responses[2].response.result.cursor).toBeDefined();
  });

  it('handles tile_windows tool call with side-by-side and maximize-target layouts', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_tile_1',
              name: 'tile_windows',
              args: { layout: 'side-by-side', target_app: 'notepad' },
            },
            {
              id: 'call_tile_2',
              name: 'tile_windows',
              args: { layout: 'maximize-target', target_app: 'Google Chrome' },
            },
            {
              id: 'call_tile_3',
              name: 'tile_windows',
              args: { layout: 'grid-2x2' },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(3);

    expect(responses[0].name).toBe('tile_windows');
    expect(responses[0].response.result.success).toBe(true);
    expect(responses[0].response.result.layout).toBe('side-by-side');
    expect(responses[0].response.result.tiledWindows).toHaveLength(2);

    expect(responses[1].name).toBe('tile_windows');
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[1].response.result.layout).toBe('maximize-target');

    expect(responses[2].name).toBe('tile_windows');
    expect(responses[2].response.result.success).toBe(true);
    expect(responses[2].response.result.layout).toBe('grid-2x2');
    expect(responses[2].response.result.tiledWindows.length).toBeGreaterThanOrEqual(2);
  });

  it('emits telemetry-updated including hardware metrics (CPU, RAM, procs, uptime)', async () => {
    service.hardware.setMockMetrics({
      cpuUsage: 35.8,
      memoryUsagePercent: 52.4,
      activeProcessCount: 168,
      uptimeSeconds: 7200,
    });

    let lastTelemetry: any = null;
    service.on('telemetry-updated', (t) => {
      lastTelemetry = t;
    });

    await service.hardware.sampleMetrics();
    expect(lastTelemetry).not.toBeNull();
    expect(lastTelemetry.cpuUsage).toBe(35.8);
    expect(lastTelemetry.memoryUsagePercent).toBe(52.4);
    expect(lastTelemetry.processCount).toBe(168);
    expect(lastTelemetry.uptimeSeconds).toBe(7200);
  });

  describe('Round 5 Expanded Tools: Clipboard, CDP Multi-Tab, Multi-Monitor', () => {
    it('handles read_clipboard and write_clipboard tool calls', async () => {
      let sentPayload: any = null;
      (service as any).socket = {
        readyState: 1,
        send: (str: string) => {
          sentPayload = JSON.parse(str);
        },
      };

      // 1. write_clipboard
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_clip_write',
                name: 'write_clipboard',
                args: { text: 'Gemini Live OS Clipboard Content' },
              },
            ],
          },
        }),
      );

      expect(sentPayload).not.toBeNull();
      let res = sentPayload.toolResponse.functionResponses[0];
      expect(res.name).toBe('write_clipboard');
      expect(res.response.result.success).toBe(true);
      expect(res.response.result.length).toBe('Gemini Live OS Clipboard Content'.length);

      // 2. read_clipboard
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_clip_read',
                name: 'read_clipboard',
                args: {},
              },
            ],
          },
        }),
      );

      res = sentPayload.toolResponse.functionResponses[0];
      expect(res.name).toBe('read_clipboard');
      expect(res.response.result.success).toBe(true);
      expect(res.response.result.text).toBe('Gemini Live OS Clipboard Content');
      expect(res.response.result.hasText).toBe(true);
    });

    it('handles search_tab_content and close_duplicate_tabs tool calls', async () => {
      let sentPayload: any = null;
      (service as any).socket = {
        readyState: 1,
        send: (str: string) => {
          sentPayload = JSON.parse(str);
        },
      };

      vi.spyOn(cdpClient, 'searchTabContent').mockResolvedValue({
        query: 'quantum',
        totalTabs: 3,
        matchedTabs: [
          {
            id: 'tab_q',
            title: 'Quantum Computing',
            url: 'https://example.com/quantum',
            matchCount: 2,
            snippet: '...research in quantum computing...',
          },
        ],
      });

      vi.spyOn(cdpClient, 'closeDuplicateTabs').mockResolvedValue({
        closedCount: 2,
        closedTabs: [],
        remainingCount: 2,
      });

      // Call search_tab_content
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_tab_search',
                name: 'search_tab_content',
                args: { query: 'quantum' },
              },
            ],
          },
        }),
      );

      let res = sentPayload.toolResponse.functionResponses[0];
      expect(res.name).toBe('search_tab_content');
      expect(res.response.result.matchedTabs).toHaveLength(1);
      expect(res.response.result.matchedTabs[0]?.id).toBe('tab_q');

      // Call close_duplicate_tabs
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_tab_dedup',
                name: 'close_duplicate_tabs',
                args: {},
              },
            ],
          },
        }),
      );

      res = sentPayload.toolResponse.functionResponses[0];
      expect(res.name).toBe('close_duplicate_tabs');
      expect(res.response.result.closedCount).toBe(2);
    });

    it('handles duplicate, reload, and close_duplicates actions in manage_browser_tabs', async () => {
      let sentPayload: any = null;
      (service as any).socket = {
        readyState: 1,
        send: (str: string) => {
          sentPayload = JSON.parse(str);
        },
      };

      const dupSpy = vi.spyOn(cdpClient, 'duplicateTab').mockResolvedValue({
        id: 'dup_tab_1',
        title: 'Duplicated Tab',
        url: 'https://example.com',
        type: 'page',
        webSocketDebuggerUrl: '',
      });
      const reloadSpy = vi.spyOn(cdpClient, 'reloadTab').mockResolvedValue(true);
      const closeDupSpy = vi.spyOn(cdpClient, 'closeDuplicateTabs').mockResolvedValue({
        closedCount: 1,
        closedTabs: [],
        remainingCount: 1,
      });

      // 1. duplicate
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_mgt_1',
                name: 'manage_browser_tabs',
                args: { action: 'duplicate', tab_id: 'tab_orig' },
              },
            ],
          },
        }),
      );
      expect(dupSpy).toHaveBeenCalledWith('tab_orig');
      expect(sentPayload.toolResponse.functionResponses[0].response.result.success).toBe(true);

      // 2. reload
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_mgt_2',
                name: 'manage_browser_tabs',
                args: { action: 'reload', tab_id: 'tab_orig', ignore_cache: true },
              },
            ],
          },
        }),
      );
      expect(reloadSpy).toHaveBeenCalledWith('tab_orig', true);
      expect(sentPayload.toolResponse.functionResponses[0].response.result.success).toBe(true);

      // 3. close_duplicates
      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_mgt_3',
                name: 'manage_browser_tabs',
                args: { action: 'close_duplicates' },
              },
            ],
          },
        }),
      );
      expect(closeDupSpy).toHaveBeenCalled();
      expect(sentPayload.toolResponse.functionResponses[0].response.result.closedCount).toBe(1);
    });

    it('handles tile_windows with monitor_index on secondary display', async () => {
      let sentPayload: any = null;
      (service as any).socket = {
        readyState: 1,
        send: (str: string) => {
          sentPayload = JSON.parse(str);
        },
      };

      await (service as any).handleServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              {
                id: 'call_tile_mon2',
                name: 'tile_windows',
                args: {
                  layout: 'side-by-side',
                  target_app: 'Calculator',
                  monitor_index: 1,
                },
              },
            ],
          },
        }),
      );

      const res = sentPayload.toolResponse.functionResponses[0];
      expect(res.name).toBe('tile_windows');
      expect(res.response.result.success).toBe(true);
      expect(res.response.result.tiledWindows[0]?.bounds.x).toBe(1920);
      expect(res.response.result.tiledWindows[1]?.bounds.x).toBe(2880);
    });
  });
});
