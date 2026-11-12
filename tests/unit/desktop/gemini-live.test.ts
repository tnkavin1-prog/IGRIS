import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiLiveService } from '../../../apps/desktop-hud/src/main/gemini-live.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import { computerOperator } from '../../../apps/desktop-hud/src/main/computer-operator.js';
import { autonomousAgent } from '../../../apps/desktop-hud/src/main/autonomous-agent.js';
import { SecurityAuditor } from '../../../apps/desktop-hud/src/main/security-auditor.js';

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
    expect(settings.autoApprove).toBe(false);
    expect(settings.alwaysOnTop).toBe(true);
    expect(settings.soundEffectsEnabled).toBe(true);
    expect(settings.soundVolume).toBe(0.5);
    expect(settings.minimizeToTray).toBe(true);
  });

  it('audits tool metadata without typed secrets or raw arguments', async () => {
    const auditor = new SecurityAuditor({ mockMode: true });
    const live = new GeminiLiveService(cdpClient, {
      auditor,
      nativeInput: new NativeInputService({ mockMode: true }),
      computerVision: new ComputerVisionService({ mockMode: true }),
      appManager: new AppManagerService({ mockMode: true }),
    });
    await (live as any).handleToolCalls([
      { id: 'fixture', name: 'computer_use_type', args: { text: 'private-fixture-token' } },
    ]);
    const records = auditor.getAuditTrail();
    expect(records.map((entry) => entry.action)).toEqual(['tool:started', 'tool:completed']);
    expect(JSON.stringify(records)).not.toContain('private-fixture-token');
    expect(auditor.verifyChainIntegrity()).toBe(true);
    live.dispose();
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

  it('assigns consistent turn ID to streaming outputTranscription chunks to form a single paragraph', async () => {
    const live = new GeminiLiveService(cdpClient);
    const messages: any[] = [];
    live.on('conversation-message', (m) => messages.push(m));

    const handler = (live as any).handleServerMessage.bind(live);

    // Emit two chunks in the same assistant turn
    await handler(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text: 'I can capture ' },
        },
      }),
    );
    await handler(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text: 'and process screenshots.' },
        },
      }),
    );

    expect(messages.length).toBe(2);
    expect(messages[0].id).toBe(messages[1].id);
    expect(messages[0].kind).toBe('assistant');
    expect(messages[1].kind).toBe('assistant');

    // Turn completes
    await handler(
      JSON.stringify({
        serverContent: {
          turnComplete: true,
        },
      }),
    );

    // Next turn gets a new ID
    await handler(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text: 'Next response paragraph.' },
        },
      }),
    );

    expect(messages.length).toBe(3);
    expect(messages[2].id).not.toBe(messages[0].id);
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

  it.each([
    ['{}', false, false],
    ['{"filePath":"report.docx"}', false, true],
    ['[]', false, false],
    ['{"filePath":"report.docx"}', true, false],
  ])(
    'validates skill parameters and approval: %s dangerous=%s',
    async (paramsJson, dangerous, expected) => {
      const initialize = vi.spyOn(computerOperator, 'initialize').mockResolvedValue();
      const getSkill = vi.spyOn(computerOperator.registry, 'getSkill').mockReturnValue({
        id: 'office',
        name: 'Office',
        targetApp: 'Word',
        description: '',
        isAvailable: async () => true,
        getActions: () => [
          {
            name: 'createWordDoc',
            description: '',
            dangerous,
            parameters: [{ name: 'filePath', type: 'string', description: '', required: true }],
          },
        ],
        execute: async () => ({ success: true }),
        verify: async () => true,
      });
      const execute = vi
        .spyOn(computerOperator, 'executeSkillAction')
        .mockResolvedValue({ success: true });
      const verify = vi
        .spyOn(computerOperator.registry, 'verifyActionResult')
        .mockResolvedValue(true);
      service.updateSettings({ autoApprove: false });
      let payload: any;
      (service as any).socket = {
        readyState: 1,
        send: (str: string) => {
          payload = JSON.parse(str);
        },
      };
      try {
        await (service as any).handleToolCalls([
          {
            id: 'skill_1',
            name: 'execute_application_skill',
            args: { skillId: 'office', action: 'createWordDoc', paramsJson },
          },
        ]);
        expect(payload.toolResponse.functionResponses[0].response.result.success).toBe(expected);
        expect(execute.mock.calls.length).toBe(expected ? 1 : 0);
        if (expected)
          expect(payload.toolResponse.functionResponses[0].response.result.verified).toBe(true);
      } finally {
        initialize.mockRestore();
        getSkill.mockRestore();
        execute.mockRestore();
        verify.mockRestore();
      }
    },
  );

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

  it('refuses a blocked command and gates a dangerous one on the approval setting', async () => {
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
              id: 'call_blocked_cmd',
              name: 'run_system_command',
              args: { command: 'format C: /q' },
            },
            {
              id: 'call_dangerous_cmd',
              name: 'run_system_command',
              args: { command: 'Remove-Item C:\\temp\\a.txt' },
            },
          ],
        },
      }),
    );

    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses[0].response.result.blocked).toBe(true);
    expect(responses[0].response.result.success).toBe(false);
    expect(responses[1].response.result.blocked).toBe(true);
    expect(responses[1].response.result.reason).toContain('approval-required');
    // The refusal must tell the model how the user can unblock it.
    expect(responses[1].response.result.hint).toContain('Smart approval');
    expect(responses[0].response.result.hint).toBeUndefined();
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

  it('handles dedicated window operations: maximize_window, minimize_window, restore_window, close_window and mouse_scroll', async () => {
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
              id: 'call_max_1',
              name: 'maximize_window',
              args: { window_title: 'Chrome' },
            },
            {
              id: 'call_min_1',
              name: 'minimize_window',
              args: { window_title: 'active' },
            },
            {
              id: 'call_res_1',
              name: 'restore_window',
              args: { window_title: 'Chrome' },
            },
            {
              id: 'call_scroll_1',
              name: 'mouse_scroll',
              args: { direction: 'down', amount: 500 },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(4);
    expect(responses[0].name).toBe('maximize_window');
    expect(responses[0].response.result.success).toBe(true);
    expect(responses[0].response.result.maximized).toBe(true);
    expect(responses[1].name).toBe('minimize_window');
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[2].name).toBe('restore_window');
    expect(responses[2].response.result.success).toBe(true);
    expect(responses[3].name).toBe('mouse_scroll');
    expect(responses[3].response.result.success).toBe(true);
  });

  it('handles manage_browser_tabs and plan_autonomous_task', async () => {
    const run = vi
      .spyOn(autonomousAgent, 'startSession')
      .mockResolvedValue({ id: 'fixture-session', status: 'completed' } as any);
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
    expect(responses[1].response.result.sessionId).toBe('fixture-session');
    expect(run).toHaveBeenCalledWith('Open Notepad and type test summary', { autoApprove: false });
    run.mockRestore();
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

  it('handles human-like computer control tools: mouse_move, mouse_drag, click_element_by_text, press_key', async () => {
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
              id: 'call_move_1',
              name: 'computer_use_mouse_move',
              args: { x: 300, y: 400 },
            },
            {
              id: 'call_drag_1',
              name: 'computer_use_mouse_drag',
              args: { start_x: 100, start_y: 100, end_x: 500, end_y: 500 },
            },
            {
              id: 'call_click_text_1',
              name: 'click_element_by_text',
              args: { text: 'CLOUD RESUME DOWNLOAD' },
            },
            {
              id: 'call_press_key_1',
              name: 'press_key',
              args: { key: 'PageDown' },
            },
          ],
        },
      }),
    );

    expect(sentPayload).not.toBeNull();
    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.length).toBe(4);
    expect(responses[0].name).toBe('computer_use_mouse_move');
    expect(responses[0].response.result.success).toBe(true);
    expect(responses[1].name).toBe('computer_use_mouse_drag');
    expect(responses[1].response.result.success).toBe(true);
    expect(responses[2].name).toBe('click_element_by_text');
    expect(responses[2].response.result.clickedText).toBe('CLOUD RESUME DOWNLOAD');
    expect(responses[3].name).toBe('press_key');
    expect(responses[3].response.result.key).toBe('PageDown');
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

  it('executes smooth move, horizontal scroll, and key-state tools', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };
    const input = (service as any).nativeInput as NativeInputService;
    const smooth = vi.spyOn(input, 'mouseMoveSmooth').mockResolvedValue(true);
    const hscroll = vi.spyOn(input, 'mouseHorizontalScrollAt').mockResolvedValue(true);
    const keyState = vi.spyOn(input, 'setKeyState').mockResolvedValue(true);

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_smooth',
              name: 'computer_use_mouse_move_smooth',
              args: { x: 100, y: 120, duration_ms: 400 },
            },
            {
              id: 'call_hscroll',
              name: 'computer_use_horizontal_scroll',
              args: { x: 50, y: 60, delta_x: 120 },
            },
            {
              id: 'call_key_state',
              name: 'computer_use_key_state',
              args: { key: 'Shift', down: true },
            },
          ],
        },
      }),
    );

    const responses = sentPayload.toolResponse.functionResponses;
    expect(responses.map((r: any) => r.name)).toEqual([
      'computer_use_mouse_move_smooth',
      'computer_use_horizontal_scroll',
      'computer_use_key_state',
    ]);
    expect(smooth).toHaveBeenCalledWith(100, 120, 400);
    expect(hscroll).toHaveBeenCalledWith(50, 60, 120);
    expect(keyState).toHaveBeenCalledWith('Shift', true);
    expect(responses.every((r: any) => r.response.result.success)).toBe(true);
  });

  it('maps model frame coordinates to the physical desktop before clicking', async () => {
    let sentPayload: any = null;
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => {
        sentPayload = JSON.parse(str);
      },
    };
    const input = (service as any).nativeInput as NativeInputService;
    const click = vi.spyOn(input, 'mouseClick').mockResolvedValue(true);

    (service as any).frameMapper.recordFrame({
      imageWidth: 1024,
      imageHeight: 576,
      displayBounds: { x: 0, y: 0, width: 2400, height: 1350 },
    });

    const handler = (service as any).handleServerMessage.bind(service);
    await handler(
      JSON.stringify({
        toolCall: {
          functionCalls: [
            {
              id: 'call_click_mapped',
              name: 'computer_use_click',
              args: { x: 512, y: 288 },
            },
          ],
        },
      }),
    );

    expect(click).toHaveBeenCalledWith(1200, 675, { button: 'left', double: false });
    const result = sentPayload.toolResponse.functionResponses[0].response.result;
    expect(result.x).toBe(1200);
    expect(result.y).toBe(675);
    expect(result.mappedFromFrame).toEqual({ x: 512, y: 288 });
  });

  it('stores resumption handles and re-uses them in the next setup', async () => {
    const sent: any[] = [];
    (service as any).socket = {
      readyState: 1,
      send: (str: string) => sent.push(JSON.parse(str)),
    };

    await (service as any).handleServerMessage(
      JSON.stringify({ sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } }),
    );
    expect((service as any).resumeHandle).toBe('handle-abc');

    (service as any).sendSetup();
    const setup = sent[0].setup;
    expect(setup.sessionResumption).toEqual({ handle: 'handle-abc' });
    expect(setup.contextWindowCompression).toEqual({ slidingWindow: {} });
  });

  it('does not schedule reconnects after an explicit disconnect', () => {
    vi.useFakeTimers();
    try {
      (service as any).manualDisconnect = true;
      (service as any).scheduleReconnect();
      expect((service as any).reconnectTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off when the connection drops unexpectedly', () => {
    vi.useFakeTimers();
    try {
      (service as any).manualDisconnect = false;
      const connectSpy = vi.spyOn(service, 'connect').mockResolvedValue(false);

      (service as any).scheduleReconnect();
      expect((service as any).reconnectTimer).not.toBeNull();
      expect((service as any).reconnectAttempts).toBe(1);

      vi.advanceTimersByTime(1_000);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
