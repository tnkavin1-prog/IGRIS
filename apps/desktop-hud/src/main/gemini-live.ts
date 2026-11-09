import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import WebSocket from 'ws';
import type { CDPClient } from './cdp-client.js';
import { NativeInputService } from './native-input.js';
import { ComputerVisionService } from './computer-vision.js';
import { AppManagerService } from './app-manager.js';
import { AgenticWorkflowEngine } from './agentic-workflow.js';
import { ClipboardService } from './clipboard-manager.js';
import { JarvisMemoryStore, type UserPreferences } from './jarvis-memory.js';
import { HardwareMonitorService } from './hardware-monitor.js';
import type {
  BoundingBoxTarget,
  ConversationMessage,
  CrosshairTarget,
  HUDSettings,
  LiveHUDStatus,
  NeuralTelemetry,
  VisualBlackboardLesson,
  WindowTilingLayout,
} from './types.js';

const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export interface GeminiLiveServiceDeps {
  nativeInput?: NativeInputService;
  computerVision?: ComputerVisionService;
  appManager?: AppManagerService;
  workflowEngine?: AgenticWorkflowEngine;
  memoryStore?: JarvisMemoryStore;
  hardwareMonitor?: HardwareMonitorService;
  clipboard?: ClipboardService;
}

export class GeminiLiveService extends EventEmitter {
  private socket: WebSocket | null = null;
  private cdpClient: CDPClient;
  private nativeInput: NativeInputService;
  private computerVision: ComputerVisionService;
  private appManager: AppManagerService;
  private workflowEngine: AgenticWorkflowEngine;
  private memoryStore: JarvisMemoryStore;
  private hardwareMonitor: HardwareMonitorService;
  private clipboard: ClipboardService;
  private currentAssistantTurnId: string | null = null;
  private currentUserTurnId: string | null = null;

  private settings: HUDSettings;
  private status: LiveHUDStatus = 'idle';
  private screenStreamTimer: NodeJS.Timeout | null = null;

  constructor(cdpClient: CDPClient, deps?: GeminiLiveServiceDeps) {
    super();
    this.cdpClient = cdpClient;
    this.nativeInput = deps?.nativeInput ?? new NativeInputService();
    this.computerVision = deps?.computerVision ?? new ComputerVisionService();
    this.appManager = deps?.appManager ?? new AppManagerService();
    this.clipboard =
      deps?.clipboard ?? new ClipboardService({ mockMode: this.appManager.isMockMode });
    this.memoryStore = deps?.memoryStore ?? new JarvisMemoryStore();
    this.hardwareMonitor =
      deps?.hardwareMonitor ?? new HardwareMonitorService({ mockMode: this.appManager.isMockMode });

    // Link memory store, cdpClient & display metrics
    this.appManager.setMemoryStore(this.memoryStore);
    this.computerVision.setAppManager(this.appManager);
    this.computerVision.setCDPClient(this.cdpClient);
    this.nativeInput.setDisplayMetrics(this.computerVision.getDisplayMetrics());

    this.workflowEngine =
      deps?.workflowEngine ??
      new AgenticWorkflowEngine({
        cdpClient: this.cdpClient,
        nativeInput: this.nativeInput,
        computerVision: this.computerVision,
        appManager: this.appManager,
        clipboardService: this.clipboard,
        memoryStore: this.memoryStore,
      });

    this.settings = this.loadInitialSettings();
    this.workflowEngine.setAutoApprove(this.settings.autoApprove);

    this.hardwareMonitor.on('metrics-updated', () => {
      this.emitTelemetry();
    });
    this.hardwareMonitor.start();

    // Forward workflow events
    this.workflowEngine.on('task:updated', (task) => {
      this.emit('workflow:task-updated', task);
      this.emitTelemetry();
    });

    this.workflowEngine.on('task:emergency-stop', (data) => {
      this.emit('workflow:emergency-stop', data);
    });

    this.workflowEngine.on('target-highlight', (target: BoundingBoxTarget) => {
      this.emit('bounding-box-target', target);
    });

    this.workflowEngine.on('task:needs-approval', (data) => {
      this.emit('workflow:needs-approval', data);
      this.emit('conversation-message', {
        id: `sec_${Date.now()}`,
        kind: 'system',
        title: '🛡️ Safety Barrier',
        text: `Safety Check: Step "${data.step.description}" requires user approval before execution.`,
        at: Date.now(),
      } as ConversationMessage);
    });

    this.nativeInput.on('action', (action) => {
      if (action.type === 'click' && action.x !== undefined && action.y !== undefined) {
        if (!action.skipHighlight) {
          this.emit('crosshair-target', {
            x: action.x,
            y: action.y,
            label: `Click (${action.x}, ${action.y})`,
            timestamp: Date.now(),
          } as CrosshairTarget);

          this.emit('bounding-box-target', {
            x: action.x - 40,
            y: action.y - 40,
            width: 80,
            height: 80,
            label: `Click Target (${action.x}, ${action.y})`,
            timestamp: Date.now(),
          } as BoundingBoxTarget);
        }
      }
    });
  }

  public get input(): NativeInputService {
    return this.nativeInput;
  }

  public get vision(): ComputerVisionService {
    return this.computerVision;
  }

  public get apps(): AppManagerService {
    return this.appManager;
  }

  public get workflow(): AgenticWorkflowEngine {
    return this.workflowEngine;
  }

  public get memory(): JarvisMemoryStore {
    return this.memoryStore;
  }

  public get hardware(): HardwareMonitorService {
    return this.hardwareMonitor;
  }

  public get clipboardService(): ClipboardService {
    return this.clipboard;
  }

  public get currentStatus(): LiveHUDStatus {
    return this.status;
  }

  public get currentSettings(): HUDSettings {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<HUDSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.autoApprove !== undefined) {
      this.workflowEngine.setAutoApprove(newSettings.autoApprove);
    }
    const prefsUpdate: Partial<UserPreferences> = {};
    if (newSettings.autoApprove !== undefined) prefsUpdate.autoApprove = newSettings.autoApprove;
    if (newSettings.alwaysOnTop !== undefined) prefsUpdate.alwaysOnTop = newSettings.alwaysOnTop;
    if (newSettings.soundEffectsEnabled !== undefined)
      prefsUpdate.soundEffectsEnabled = newSettings.soundEffectsEnabled;
    if (newSettings.soundVolume !== undefined) prefsUpdate.soundVolume = newSettings.soundVolume;
    if (Object.keys(prefsUpdate).length > 0) {
      try {
        this.memoryStore.updatePreferences(prefsUpdate);
      } catch {}
    }
    this.emit('settings-updated', this.settings);
  }

  public async emergencyStop(
    reason = 'Emergency killswitch activated',
  ): Promise<{ stopped: boolean; task: any }> {
    const res = await this.workflowEngine.emergencyStop(reason);
    this.emit('conversation-message', {
      id: `sys_kill_${Date.now()}`,
      kind: 'system',
      title: '🚨 EMERGENCY KILLSWITCH ACTIVATED',
      text: `${reason}. All autonomous operations halted, queues cleared, input states safely released.`,
      at: Date.now(),
    } as ConversationMessage);
    return res;
  }

  public async connect(): Promise<boolean> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return true;
    }

    const apiKey = this.settings.apiKey;
    if (!apiKey) {
      this.emitError('API key is missing. Enter a Gemini API key in HUD Settings.');
      return false;
    }

    this.setStatus('connecting');
    const wsUrl = `${LIVE_WS_URL}?key=${encodeURIComponent(apiKey)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.on('open', () => {
        this.setStatus('listening');
        this.sendSetup();
        this.startScreenStream();
        this.emit('connected');
        this.emitTelemetry();
      });

      this.socket.on('message', (data: WebSocket.RawData) => {
        this.handleServerMessage(data.toString());
      });

      this.socket.on('error', (err: Error) => {
        this.emitError(`Live WebSocket error: ${err.message}`);
      });

      this.socket.on('close', (code: number, reason: Buffer) => {
        this.stopScreenStream();
        this.setStatus('closed');
        this.socket = null;
        this.emit('disconnected', { code, reason: reason.toString() });
        this.emitTelemetry();
      });

      return true;
    } catch (err) {
      this.emitError(`Connection initiation failed: ${(err as Error).message}`);
      this.setStatus('error');
      return false;
    }
  }

  public disconnect(): void {
    this.stopScreenStream();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus('idle');
    this.emitTelemetry();
  }

  public startScreenStream(intervalMs = 2500): void {
    if (this.screenStreamTimer) return;
    this.screenStreamTimer = setInterval(async () => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        const shot = await this.computerVision.captureScreen(undefined, {
          maxWidth: 1024,
          maxHeight: 576,
          quality: 70,
        });
        if (shot?.data) {
          this.sendImageFrame(shot.data);
        }
      } catch {}
    }, intervalMs);
  }

  public stopScreenStream(): void {
    if (this.screenStreamTimer) {
      clearInterval(this.screenStreamTimer);
      this.screenStreamTimer = null;
    }
  }

  public sendText(text: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Auto-capture live screen on user interaction so Gemini always has fresh visual context
    void this.computerVision
      .captureScreen(undefined, { maxWidth: 1024, maxHeight: 576, quality: 75 })
      .then((shot) => {
        if (shot?.data) {
          this.sendImageFrame(shot.data);
        }
      })
      .catch(() => undefined);

    const msg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.socket.send(JSON.stringify(msg));
    this.emit('conversation-message', {
      id: `usr_${Date.now()}`,
      kind: 'user',
      text,
      at: Date.now(),
    } as ConversationMessage);
    return true;
  }

  public sendAudioChunk(base64Pcm: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const msg = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Pcm,
        },
      },
    };
    this.socket.send(JSON.stringify(msg));
  }

  public sendImageFrame(base64Jpeg: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const msg = {
      realtimeInput: {
        video: {
          mimeType: 'image/jpeg',
          data: base64Jpeg,
        },
      },
    };
    this.socket.send(JSON.stringify(msg));
  }

  private sendSetup(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const rawModel = this.settings.modelId || 'gemini-3.8-live';
    const model = rawModel.startsWith('models/') ? rawModel : `models/${rawModel}`;

    const setupPayload = {
      setup: {
        model,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.settings.voice || 'Kore',
              },
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [
            {
              text: [
                'You are Jarvis, an advanced Autonomous Multimodal Computer-Use Co-Pilot embedded in a native desktop HUD.',
                'You possess complete human-like, OS-wide autonomous control over Windows: mouse clicking, dragging, moving, hardware mouse wheel scrolling, keyboard typing and hotkeys, window management (maximize, minimize, restore, close), application management, and Chrome browser tabs via CDP.',
                'FAST-PATH AUTONOMOUS ACTIONS (CRITICAL):',
                '- When asked to MAXIMIZE a window (e.g. "maximize Chrome", "maximize window", "make it full screen"): IMMEDIATELY call maximize_window({ window_title: "Chrome" }). Do NOT call switch_active_window or tile_windows.',
                '- When asked to SCROLL DOWN or SCROLL UP in a document, PDF, or webpage (e.g. "scroll down", "scroll up", "scroll pdf", "read further"): IMMEDIATELY call scroll_page({ direction: "down" }) or scroll_page({ direction: "up" }). Never merely claim you scrolled—always invoke the tool call.',
                '- When asked to TAKE A SCREENSHOT, show screen, paste screenshot in chat, or view what is on screen: IMMEDIATELY call computer_use_screenshot({}). It captures the screen and displays the screenshot directly in the chat.',
                '- When asked to CLICK a button, link, or label on screen (e.g. "click Download", "click Resume", "click Close"): IMMEDIATELY call click_element_by_text({ text: "..." }) or computer_use_click({ x, y }).',
                '- When asked to PRESS a key (e.g. "press Enter", "press PageDown", "press Esc"): IMMEDIATELY call press_key({ key: "..." }) or computer_use_hotkey({ keys: ["..."] }).',
                '- When asked to MINIMIZE, RESTORE, or CLOSE a window: call minimize_window, restore_window, or close_window.',
                '- When asked to type or navigate: immediately invoke computer_use_type, computer_use_click, navigate_to_url, or launch_application.',
                '- When asked to explain or derive concepts in math/physics: invoke teach_visual_blackboard.',
                'SCREEN & APPLICATION VISIBILITY GROUNDING (CRITICAL):',
                '- You receive real-time streaming video frames of the user live desktop screen.',
                '- Always observe the actual visual screen before asserting whether an application is open or visible. If the desktop wallpaper is showing and no application window is visible on screen, it is NOT open.',
                '- If the user tells you an app is NOT open, NEVER argue or claim it is open. Immediately call launch_application({ app_name: "..." }) or switch_active_window({ window_title: "..." }) to bring it up.',
                'Keep your spoken responses ultra-concise, natural, and confident (strictly under 6 words: e.g. "Maximized.", "Scrolling down.", "Screenshot captured.", "Clicked.", "Done."). Execute physical tools on Turn 1 without hesitation.',
                this.memoryStore.buildSystemContextPrompt(),
              ].join('\n\n'),
            },
          ],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'teach_visual_blackboard',
                behavior: 'NON_BLOCKING',
                description:
                  'Projects a visual teaching lesson on the user Visual Blackboard with chalkboard SVG diagram, LaTeX formula, and numbered proof steps.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING', description: 'Title of the lesson or theorem' },
                    topic: {
                      type: 'STRING',
                      description: 'Academic subject domain (e.g. Geometry, Calculus, Physics)',
                    },
                    diagram_type: {
                      type: 'STRING',
                      enum: [
                        'geometry',
                        'graph',
                        'formula',
                        'mensuration',
                        'flowchart',
                        'chalk_sketch',
                      ],
                      description: 'Type of diagram being illustrated',
                    },
                    latex_formula: {
                      type: 'STRING',
                      description: 'Core LaTeX mathematical formulas',
                    },
                    svg_markup: {
                      type: 'STRING',
                      description: 'Complete well-formed SVG element with viewBox 0 0 500 320',
                    },
                    steps: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                      description: 'Sequential step-by-step proof or explanation steps',
                    },
                    teaching_narration: {
                      type: 'STRING',
                      description: 'Intuitive insight and commentary',
                    },
                  },
                  required: ['title', 'latex_formula', 'svg_markup', 'steps'],
                },
              },
              {
                name: 'find_text_on_screen',
                behavior: 'NON_BLOCKING',
                description:
                  'Searches the user desktop screen, active application windows, and UI controls for a text label or button text, returning precise click coordinates (x, y) and bounding box without guessing.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    text: {
                      type: 'STRING',
                      description:
                        'The exact or partial text label to locate on screen (e.g. "Save", "File", "Submit", window title)',
                    },
                    window_title: {
                      type: 'STRING',
                      description:
                        'Optional window title or application name to restrict search to',
                    },
                    click: {
                      type: 'BOOLEAN',
                      description:
                        'If true, automatically moves the mouse and clicks the located text element',
                    },
                    exact: {
                      type: 'BOOLEAN',
                      description:
                        'If true, requires exact string match rather than substring match',
                    },
                    case_sensitive: {
                      type: 'BOOLEAN',
                      description: 'If true, enforces case-sensitive comparison',
                    },
                    max_results: {
                      type: 'INTEGER',
                      description: 'Maximum number of candidate matches to return (default 10)',
                    },
                  },
                  required: ['text'],
                },
              },
              {
                name: 'computer_use_click',
                behavior: 'NON_BLOCKING',
                description:
                  'Simulates a native OS mouse move and click at target coordinates (x, y) on the user desktop.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    x: { type: 'INTEGER', description: 'Screen X pixel coordinate' },
                    y: { type: 'INTEGER', description: 'Screen Y pixel coordinate' },
                    button: {
                      type: 'STRING',
                      enum: ['left', 'right', 'middle'],
                      description: 'Mouse button to click',
                    },
                    double: { type: 'BOOLEAN', description: 'Perform double click if true' },
                    description: {
                      type: 'STRING',
                      description: 'What UI element or button is being clicked',
                    },
                  },
                  required: ['x', 'y'],
                },
              },
              {
                name: 'computer_use_mouse_move',
                behavior: 'NON_BLOCKING',
                description: 'Moves the native mouse cursor to coordinate (x, y) on screen.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    x: { type: 'INTEGER', description: 'Screen X pixel coordinate' },
                    y: { type: 'INTEGER', description: 'Screen Y pixel coordinate' },
                  },
                  required: ['x', 'y'],
                },
              },
              {
                name: 'computer_use_mouse_drag',
                behavior: 'NON_BLOCKING',
                description: 'Drags mouse cursor from (start_x, start_y) to (end_x, end_y).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    start_x: { type: 'INTEGER', description: 'Start X coordinate' },
                    start_y: { type: 'INTEGER', description: 'Start Y coordinate' },
                    end_x: { type: 'INTEGER', description: 'End X coordinate' },
                    end_y: { type: 'INTEGER', description: 'End Y coordinate' },
                    steps: { type: 'INTEGER', description: 'Interpolation steps (default 10)' },
                  },
                  required: ['start_x', 'start_y', 'end_x', 'end_y'],
                },
              },
              {
                name: 'click_element_by_text',
                behavior: 'NON_BLOCKING',
                description:
                  'Visually locates any button, link, menu item, or text label on screen and clicks it like a human.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    text: {
                      type: 'STRING',
                      description: 'Exact text or button label to click (e.g. "CLOUD RESUME DOWNLOAD", "Next", "Submit", "Close")',
                    },
                  },
                  required: ['text'],
                },
              },
              {
                name: 'press_key',
                behavior: 'NON_BLOCKING',
                description:
                  'Presses a specific keyboard key directly (e.g. PageDown, PageUp, Enter, Escape, Tab, Space, Down, Up).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    key: {
                      type: 'STRING',
                      description: 'Key name to press (PageDown, PageUp, Enter, Escape, Tab, Space, Down, Up)',
                    },
                  },
                  required: ['key'],
                },
              },
              {
                name: 'computer_use_type',
                behavior: 'NON_BLOCKING',
                description:
                  'Types text into the currently active desktop window with optional Enter keystroke.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    text: { type: 'STRING', description: 'Text string to type' },
                    press_enter: {
                      type: 'BOOLEAN',
                      description: 'Whether to press Enter key after typing',
                    },
                  },
                  required: ['text'],
                },
              },
              {
                name: 'computer_use_hotkey',
                behavior: 'NON_BLOCKING',
                description:
                  'Sends a native keyboard hotkey or chord combination (e.g. Win+R, Alt+Tab, Ctrl+C, Ctrl+V, Enter).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    keys: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                      description: 'Key chord components, e.g. ["Control", "c"] or ["Win", "r"]',
                    },
                  },
                  required: ['keys'],
                },
              },
              {
                name: 'computer_use_screenshot',
                behavior: 'NON_BLOCKING',
                description:
                  'Captures full desktop screen or a specific window and feeds it directly into your visual input stream.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    target: {
                      type: 'STRING',
                      enum: ['screen', 'window'],
                      description: 'Capture full screen or specific window',
                    },
                    window_title: {
                      type: 'STRING',
                      description: 'Window title substring if target is window',
                    },
                    feed_to_vision: {
                      type: 'BOOLEAN',
                      description:
                        'Whether to push frame into Gemini multimodal vision (default true)',
                    },
                  },
                },
              },
              {
                name: 'launch_application',
                behavior: 'NON_BLOCKING',
                description:
                  'Launches a desktop application (e.g. Notepad, Calculator, Word, Excel, File Explorer, Terminal, Chrome).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    app_name: {
                      type: 'STRING',
                      description:
                        'Name or executable alias (notepad, calc, explorer, terminal, word, excel, chrome)',
                    },
                    arguments: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                      description: 'Command-line arguments',
                    },
                  },
                  required: ['app_name'],
                },
              },
              {
                name: 'switch_active_window',
                behavior: 'NON_BLOCKING',
                description:
                  'Switches foreground focus to a specified desktop window by title query.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    window_title: {
                      type: 'STRING',
                      description: 'Title or substring of window to focus',
                    },
                    maximize: {
                      type: 'BOOLEAN',
                      description: 'Set true to also maximize the window upon focusing',
                    },
                  },
                  required: ['window_title'],
                },
              },
              {
                name: 'maximize_window',
                behavior: 'NON_BLOCKING',
                description:
                  'Maximizes a desktop application window to fill the screen (e.g. Chrome, Word, Notepad, PDF, or active window).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    window_title: {
                      type: 'STRING',
                      description: 'Window title or application name to maximize (e.g. "Chrome", "Notepad", or "active")',
                    },
                  },
                },
              },
              {
                name: 'minimize_window',
                behavior: 'NON_BLOCKING',
                description:
                  'Minimizes a desktop application window to the taskbar.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    window_title: {
                      type: 'STRING',
                      description: 'Window title or application name to minimize (default: active)',
                    },
                  },
                },
              },
              {
                name: 'restore_window',
                behavior: 'NON_BLOCKING',
                description:
                  'Restores a maximized or minimized window to its previous regular window size.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    window_title: {
                      type: 'STRING',
                      description: 'Window title or application name to restore',
                    },
                  },
                },
              },
              {
                name: 'close_window',
                behavior: 'NON_BLOCKING',
                description:
                  'Closes a specified application window.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    window_title: {
                      type: 'STRING',
                      description: 'Window title or application name to close',
                    },
                  },
                },
              },
              {
                name: 'mouse_scroll',
                behavior: 'NON_BLOCKING',
                description:
                  'Performs a native hardware mouse scroll wheel action up or down on the active window or document (scrolls PDFs, Chrome, Word, code editors).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    direction: {
                      type: 'STRING',
                      enum: ['up', 'down'],
                      description: 'Scroll direction',
                    },
                    amount: {
                      type: 'INTEGER',
                      description: 'Scroll distance in pixels (default: 450)',
                    },
                  },
                  required: ['direction'],
                },
              },
              {
                name: 'run_system_command',
                behavior: 'NON_BLOCKING',
                description:
                  'Executes a system PowerShell or shell command with safety protections.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    command: {
                      type: 'STRING',
                      description: 'PowerShell / command line string to run',
                    },
                    explanation: {
                      type: 'STRING',
                      description: 'Rationale or user explanation for running this command',
                    },
                  },
                  required: ['command'],
                },
              },
              {
                name: 'manage_browser_tabs',
                behavior: 'NON_BLOCKING',
                description:
                  'Lists, opens, switches, closes, duplicates, reloads, or declutters Chrome browser tabs via DevTools Protocol.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    action: {
                      type: 'STRING',
                      enum: [
                        'list',
                        'create',
                        'switch',
                        'close',
                        'duplicate',
                        'reload',
                        'close_duplicates',
                      ],
                      description: 'Tab operation to perform',
                    },
                    url: { type: 'STRING', description: 'URL for new tab creation' },
                    tab_id: {
                      type: 'STRING',
                      description: 'Target tab ID for switch, close, duplicate, or reload',
                    },
                    ignore_cache: {
                      type: 'BOOLEAN',
                      description: 'Bypass cache when reloading tab',
                    },
                  },
                  required: ['action'],
                },
              },
              {
                name: 'search_tab_content',
                behavior: 'NON_BLOCKING',
                description:
                  'Searches across all open Chrome tabs for text, keywords, or topics and returns matching tabs with text snippets.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    query: {
                      type: 'STRING',
                      description: 'Search string or keyword to locate in open browser tabs',
                    },
                    case_sensitive: {
                      type: 'BOOLEAN',
                      description: 'Whether search should match exact case (default false)',
                    },
                  },
                  required: ['query'],
                },
              },
              {
                name: 'close_duplicate_tabs',
                behavior: 'NON_BLOCKING',
                description:
                  'Closes redundant duplicate Chrome tabs sharing identical URLs to declutter the browser.',
                parameters: {
                  type: 'OBJECT',
                  properties: {},
                },
              },
              {
                name: 'read_clipboard',
                behavior: 'NON_BLOCKING',
                description:
                  'Inspects and returns current text contents from the OS system clipboard.',
                parameters: {
                  type: 'OBJECT',
                  properties: {},
                },
              },
              {
                name: 'write_clipboard',
                behavior: 'NON_BLOCKING',
                description: 'Writes specified text, notes, or code to the OS system clipboard.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    text: {
                      type: 'STRING',
                      description: 'Text or code string to copy to the system clipboard',
                    },
                  },
                  required: ['text'],
                },
              },
              {
                name: 'tile_windows',
                behavior: 'NON_BLOCKING',
                description:
                  'Arranges and tiles desktop application windows into automated productivity layouts (side-by-side, maximize-target, grid-2x2).',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    layout: {
                      type: 'STRING',
                      enum: ['side-by-side', 'maximize-target', 'grid-2x2'],
                      description:
                        'Target layout: "side-by-side" (Chrome left 50%, target app right 50%), "maximize-target" (focus & maximize target app), or "grid-2x2" (up to 4 windows in a 2x2 grid)',
                    },
                    target_app: {
                      type: 'STRING',
                      description:
                        'Target application name or title for side-by-side or maximize-target (e.g. Word, Notepad, Calc, PDF, Chrome)',
                    },
                    window_titles: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                      description: 'Optional list of window titles or queries for grid-2x2 layout',
                    },
                    monitor_index: {
                      type: 'INTEGER',
                      description:
                        'Target monitor index (0 for primary display, 1 for secondary monitor)',
                    },
                  },
                  required: ['layout'],
                },
              },
              {
                name: 'plan_autonomous_task',
                behavior: 'NON_BLOCKING',
                description:
                  'Decomposes an autonomous multi-step workflow across apps and browser tabs and starts agentic execution.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    goal: {
                      type: 'STRING',
                      description: 'High-level objective to achieve autonomously',
                    },
                    steps: {
                      type: 'ARRAY',
                      items: {
                        type: 'OBJECT',
                        properties: {
                          description: { type: 'STRING' },
                          actionType: { type: 'STRING' },
                          params: { type: 'OBJECT' },
                        },
                        required: ['description', 'actionType'],
                      },
                      description: 'Optional explicit sequence of steps',
                    },
                  },
                  required: ['goal'],
                },
              },
              {
                name: 'get_desktop_state',
                behavior: 'NON_BLOCKING',
                description:
                  'Retrieves comprehensive OS state: cursor coordinates, active window list, display metrics, and open Chrome tabs.',
                parameters: {
                  type: 'OBJECT',
                  properties: {},
                },
              },
              {
                name: 'capture_viewport',
                behavior: 'NON_BLOCKING',
                description: 'Captures a live screenshot of the user current active Chrome tab.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    reason: { type: 'STRING', description: 'Why the screenshot is needed' },
                  },
                },
              },
              {
                name: 'open_youtube',
                behavior: 'NON_BLOCKING',
                description: 'Opens YouTube in Chrome, optionally searching for a topic.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    query: { type: 'STRING', description: 'Search query for YouTube' },
                  },
                },
              },
              {
                name: 'navigate_to_url',
                behavior: 'NON_BLOCKING',
                description: 'Navigates the active Chrome tab to a target URL.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    url: { type: 'STRING', description: 'Absolute http or https URL' },
                  },
                  required: ['url'],
                },
              },
              {
                name: 'scroll_page',
                behavior: 'NON_BLOCKING',
                description:
                  'Scrolls the active window, document, PDF viewer, or webpage up or down.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    direction: { type: 'STRING', enum: ['up', 'down'] },
                    amount: { type: 'INTEGER', description: 'Scroll distance in pixels' },
                    target_app: {
                      type: 'STRING',
                      description: 'Application or window name to scroll (default: active window)',
                    },
                  },
                  required: ['direction'],
                },
              },
              {
                name: 'read_page',
                behavior: 'NON_BLOCKING',
                description:
                  'Reads the text content, title, and headings from the active Chrome webpage.',
                parameters: {
                  type: 'OBJECT',
                  properties: {},
                },
              },
            ],
          },
        ],
      },
    };

    this.socket.send(JSON.stringify(setupPayload));
  }

  private async handleServerMessage(rawText: string): Promise<void> {
    try {
      const msg = JSON.parse(rawText) as Record<string, any>;

      // 1. Audio and transcript parts
      if (msg.serverContent) {
        const sc = msg.serverContent;

        if (sc.interrupted) {
          this.emit('interrupted');
          this.setStatus('listening');
          this.currentAssistantTurnId = null;
          this.currentUserTurnId = null;
        }

        if (sc.inputTranscription?.text) {
          if (!this.currentUserTurnId) {
            this.currentUserTurnId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          }
          this.emit('user-transcript', sc.inputTranscription.text);
          this.emit('conversation-message', {
            id: this.currentUserTurnId,
            kind: 'user',
            text: sc.inputTranscription.text,
            at: Date.now(),
          } as ConversationMessage);
        }

        if (sc.outputTranscription?.text) {
          if (!this.currentAssistantTurnId) {
            this.currentAssistantTurnId = `asst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          }
          this.emit('gemini-transcript', sc.outputTranscription.text);
          this.emit('conversation-message', {
            id: this.currentAssistantTurnId,
            kind: 'assistant',
            text: sc.outputTranscription.text,
            at: Date.now(),
          } as ConversationMessage);
        }

        if (sc.modelTurn?.parts) {
          this.setStatus('speaking');
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData?.data) {
              this.emit('audio-chunk', {
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
              });
            }
          }
        }

        if (sc.turnComplete) {
          this.setStatus('listening');
          this.currentAssistantTurnId = null;
          this.currentUserTurnId = null;
          this.emit('turn-complete');
        }
      }

      // 2. Interaction Status (Extended Thinking)
      if (msg.interactionStatus) {
        if (msg.interactionStatus === 'IDLE') {
          this.setStatus('listening');
        } else if (msg.interactionStatus === 'IN_PROGRESS' && this.status === 'idle') {
          this.setStatus('thinking');
        }
      }

      // 3. Tool Calls
      if (msg.toolCall?.functionCalls) {
        this.setStatus('thinking');
        await this.handleToolCalls(msg.toolCall.functionCalls);
      }
    } catch (err) {
      this.emitError(`Failed to parse Gemini Live message: ${(err as Error).message}`);
    }
  }

  private async handleToolCalls(
    calls: Array<{ id: string; name: string; args: Record<string, any> }>,
  ): Promise<void> {
    this.currentAssistantTurnId = null;
    this.currentUserTurnId = null;
    const responses: Array<{ id: string; name: string; response: Record<string, any> }> = [];

    for (const call of calls) {
      this.emit('conversation-message', {
        id: `tool_${Date.now()}`,
        kind: 'tool',
        name: call.name,
        title: `Tool: ${call.name}`,
        detail: JSON.stringify(call.args).slice(0, 100),
        status: 'running',
        at: Date.now(),
      } as ConversationMessage);

      try {
        let result: Record<string, any> = {};

        switch (call.name) {
          case 'teach_visual_blackboard': {
            const lesson: VisualBlackboardLesson = {
              id: `lesson_${Date.now()}`,
              title: call.args.title || 'Visual Blackboard Lesson',
              topic: call.args.topic || 'Academic Problem Solving',
              diagramType: call.args.diagram_type || 'geometry',
              latexFormula: call.args.latex_formula || '',
              svgMarkup: call.args.svg_markup || '',
              steps: Array.isArray(call.args.steps) ? call.args.steps : [String(call.args.steps)],
              teachingNarration: call.args.teaching_narration || '',
              createdAt: Date.now(),
            };
            this.emit('blackboard-lesson', lesson);
            result = { success: true, lessonId: lesson.id, title: lesson.title };
            break;
          }

          case 'find_text_on_screen': {
            const textToFind = String(call.args.text || '');
            const winScope = call.args.window_title || call.args.windowTitle;
            const shouldClick = Boolean(call.args.click);
            const exact = Boolean(call.args.exact);
            const caseSensitive = Boolean(call.args.case_sensitive ?? call.args.caseSensitive);
            const maxResults = call.args.max_results ? Number(call.args.max_results) : undefined;

            const searchRes = await this.computerVision.findTextOnScreen(textToFind, {
              windowTitle: winScope,
              exact,
              caseSensitive,
              maxResults,
            });

            if (searchRes.found && searchRes.bestMatch) {
              const bm = searchRes.bestMatch;
              this.emit('crosshair-target', {
                x: bm.x,
                y: bm.y,
                label: `Text "${bm.text}" (${bm.x}, ${bm.y})`,
                timestamp: Date.now(),
              } as CrosshairTarget);

              this.emit('bounding-box-target', {
                x: bm.bounds.x,
                y: bm.bounds.y,
                width: bm.bounds.width,
                height: bm.bounds.height,
                label: `Found: "${bm.text}"`,
                source: bm.source,
                timestamp: Date.now(),
              } as BoundingBoxTarget);

              if (shouldClick) {
                await this.nativeInput.mouseClick(bm.x, bm.y, { skipHighlight: true });
              }

              result = {
                success: true,
                found: true,
                x: bm.x,
                y: bm.y,
                bounds: bm.bounds,
                matchText: bm.text,
                matchesCount: searchRes.matches.length,
                clicked: shouldClick,
                source: bm.source,
              };
            } else {
              result = {
                success: true,
                found: false,
                query: textToFind,
                message: `Text "${textToFind}" not detected on screen.`,
              };
            }
            break;
          }

          case 'computer_use_click': {
            const x = Number(call.args.x);
            const y = Number(call.args.y);
            const button = call.args.button || 'left';
            const double = Boolean(call.args.double);

            await this.nativeInput.mouseClick(x, y, { button, double });
            this.emit('crosshair-target', {
              x,
              y,
              label: call.args.description || `Click (${x}, ${y})`,
              timestamp: Date.now(),
            } as CrosshairTarget);

            result = { success: true, x, y, button, double };
            break;
          }

          case 'computer_use_mouse_move': {
            const x = Number(call.args.x) || 0;
            const y = Number(call.args.y) || 0;
            const ok = await this.nativeInput.mouseMove(x, y);
            result = { success: ok, x, y };
            break;
          }

          case 'computer_use_mouse_drag': {
            const sx = Number(call.args.start_x) || 0;
            const sy = Number(call.args.start_y) || 0;
            const ex = Number(call.args.end_x) || 0;
            const ey = Number(call.args.end_y) || 0;
            const steps = Number(call.args.steps) || 10;
            const ok = await this.nativeInput.mouseDrag(sx, sy, ex, ey, steps);
            result = { success: ok, from: { x: sx, y: sy }, to: { x: ex, y: ey } };
            break;
          }

          case 'click_element_by_text': {
            const textToClick = call.args.text || call.args.query || '';
            let clicked = false;
            try {
              clicked = await this.cdpClient.clickElementByText(textToClick);
            } catch {}
            if (!clicked) {
              try {
                const matches = await this.appManager.findText(textToClick);
                const target = matches[0];
                if (target) {
                  clicked = await this.nativeInput.mouseClick(target.x, target.y);
                  this.emit('crosshair-target', {
                    x: target.x,
                    y: target.y,
                    label: `Clicked: "${textToClick}"`,
                    timestamp: Date.now(),
                  } as CrosshairTarget);
                }
              } catch {}
            }
            result = { success: clicked, clickedText: textToClick };
            break;
          }

          case 'press_key': {
            const rawKey = call.args.key || 'Enter';
            const ok = await this.nativeInput.sendHotkey(rawKey);
            result = { success: ok, key: rawKey };
            break;
          }

          case 'computer_use_type': {
            const text = String(call.args.text || '');
            await this.nativeInput.typeText(text);
            if (call.args.press_enter) {
              await this.nativeInput.sendHotkey('Enter');
            }
            result = { success: true, charactersTyped: text.length };
            break;
          }

          case 'computer_use_hotkey': {
            const rawKeys = call.args.keys || call.args.key || call.args.hotkey || call.args.chord;
            const keys = Array.isArray(rawKeys) ? rawKeys.join('+') : String(rawKeys || 'Enter');
            await this.nativeInput.sendHotkey(keys);
            result = { success: true, keysSent: keys };
            break;
          }

          case 'computer_use_screenshot': {
            const winTitle = call.args.window_title || call.args.windowTitle || call.args.title;
            const shot =
              call.args.target === 'window' && winTitle
                ? await this.computerVision.captureWindow(winTitle)
                : await this.computerVision.captureScreen();

            if (call.args.feed_to_vision !== false) {
              this.sendImageFrame(shot.data);
            }

            this.emit('conversation-message', {
              id: `shot_${Date.now()}`,
              kind: 'assistant',
              title: '📸 Screenshot',
              text: `Desktop Screenshot captured (${shot.width}x${shot.height}):`,
              imageUrl: `data:image/jpeg;base64,${shot.data}`,
              at: Date.now(),
            } as ConversationMessage);

            result = {
              success: true,
              width: shot.width,
              height: shot.height,
              sourceName: shot.sourceName,
              message: 'Desktop screenshot captured, displayed in chat, and fed into vision stream.',
            };
            break;
          }

          case 'launch_application': {
            const app =
              call.args.app_name || call.args.appName || call.args.app || call.args.name || '';
            const rawArgs = call.args.arguments || call.args.args || [];
            const res = await this.appManager.launchApplication(
              app,
              Array.isArray(rawArgs) ? rawArgs : [String(rawArgs)],
            );
            result = res;
            break;
          }

          case 'switch_active_window': {
            const target =
              call.args.window_title ||
              call.args.title ||
              call.args.query ||
              call.args.appName ||
              call.args.app ||
              '';
            const ok = await this.appManager.focusWindow(target);
            if (call.args.maximize === true || target.toLowerCase().includes('max')) {
              await this.appManager.maximizeWindow(target);
            }
            result = { success: ok, window: target };
            break;
          }

          case 'maximize_window': {
            const target =
              call.args.window_title ||
              call.args.windowTitle ||
              call.args.title ||
              call.args.appName ||
              call.args.app ||
              'chrome';
            const ok = await this.appManager.maximizeWindow(target);
            result = { success: ok, maximized: true, window: target };
            break;
          }

          case 'minimize_window': {
            const target =
              call.args.window_title ||
              call.args.windowTitle ||
              call.args.title ||
              call.args.appName ||
              call.args.app ||
              'active';
            const ok = await this.appManager.minimizeWindow(target);
            await this.nativeInput.sendHotkey('Win+Down').catch(() => undefined);
            result = { success: ok, minimized: true, window: target };
            break;
          }

          case 'restore_window': {
            const target =
              call.args.window_title ||
              call.args.windowTitle ||
              call.args.title ||
              call.args.appName ||
              call.args.app ||
              'chrome';
            const ok = await this.appManager.restoreWindow(target);
            await this.nativeInput.sendHotkey('Win+Down').catch(() => undefined);
            result = { success: ok, restored: true, window: target };
            break;
          }

          case 'close_window': {
            const target =
              call.args.window_title ||
              call.args.windowTitle ||
              call.args.title ||
              call.args.appName ||
              call.args.app ||
              'active';
            const ok = await this.appManager.closeWindow(target);
            result = { success: ok, closed: true, window: target };
            break;
          }

          case 'run_system_command': {
            const cmd = call.args.command || call.args.cmd || '';
            const res = await this.appManager.runSystemCommand(cmd);
            result = res;
            break;
          }

          case 'manage_browser_tabs': {
            const act = call.args.action;
            if (act === 'list') {
              const tabs = await this.cdpClient.listTabs();
              result = { success: true, count: tabs.length, tabs };
            } else if (act === 'create') {
              const tab = await this.cdpClient.createTab(call.args.url || 'https://www.google.com');
              result = { success: true, tab };
            } else if (act === 'switch') {
              const ok = await this.cdpClient.switchTab(call.args.tab_id);
              result = { success: ok, tabId: call.args.tab_id };
            } else if (act === 'close') {
              const ok = await this.cdpClient.closeTab(call.args.tab_id);
              result = { success: ok, tabId: call.args.tab_id };
            } else if (act === 'duplicate') {
              const tab = await this.cdpClient.duplicateTab(call.args.tab_id);
              result = { success: Boolean(tab), tab };
            } else if (act === 'reload') {
              const ok = await this.cdpClient.reloadTab(
                call.args.tab_id,
                Boolean(call.args.ignore_cache),
              );
              result = { success: ok, tabId: call.args.tab_id };
            } else if (act === 'close_duplicates') {
              const dupRes = await this.cdpClient.closeDuplicateTabs();
              result = dupRes;
            } else {
              result = { error: `Unknown tab action: ${act}` };
            }
            break;
          }

          case 'search_tab_content': {
            const query = call.args.query || call.args.text || '';
            const caseSensitive = Boolean(call.args.case_sensitive || call.args.caseSensitive);
            const searchRes = await this.cdpClient.searchTabContent(query, { caseSensitive });
            result = searchRes;
            break;
          }

          case 'close_duplicate_tabs': {
            const closeRes = await this.cdpClient.closeDuplicateTabs();
            result = closeRes;
            break;
          }

          case 'read_clipboard': {
            const text = this.clipboard.readText();
            result = {
              success: true,
              text,
              length: text.length,
              hasText: this.clipboard.hasText(),
            };
            break;
          }

          case 'write_clipboard': {
            const text = call.args.text || '';
            const ok = this.clipboard.writeText(text);
            result = { success: ok, length: text.length };
            break;
          }

          case 'tile_windows': {
            const layout = (call.args.layout || 'side-by-side') as WindowTilingLayout;
            const targetApp =
              call.args.target_app ||
              call.args.targetApp ||
              call.args.target ||
              call.args.app ||
              '';
            const rawTitles =
              call.args.window_titles ||
              call.args.windowTitles ||
              call.args.windows ||
              call.args.titles;
            const windowTitles = Array.isArray(rawTitles) ? rawTitles.map(String) : undefined;
            const monitorIndex =
              typeof call.args.monitor_index === 'number'
                ? call.args.monitor_index
                : typeof call.args.monitorIndex === 'number'
                  ? call.args.monitorIndex
                  : undefined;

            const tileRes = await this.appManager.tileWindows(layout, {
              targetApp: targetApp || undefined,
              windowTitles,
              monitorIndex,
            });
            result = tileRes;
            break;
          }

          case 'plan_autonomous_task': {
            const task = this.workflowEngine.createTask(
              call.args.goal,
              Array.isArray(call.args.steps) ? call.args.steps : undefined,
            );
            void this.workflowEngine.startTask(task.id);
            result = {
              success: true,
              taskId: task.id,
              goal: task.goal,
              stepCount: task.steps.length,
            };
            break;
          }

          case 'get_desktop_state': {
            const [cursor, windows, tabs] = await Promise.all([
              this.nativeInput.getCursorPosition(),
              this.appManager.listRunningWindows(),
              this.cdpClient.listTabs(),
            ]);
            const display = this.computerVision.getDisplayMetrics();
            result = {
              cursor,
              display,
              windowsCount: windows.length,
              activeWindows: windows.slice(0, 10),
              openTabsCount: tabs.length,
              tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
            };
            break;
          }

          case 'capture_viewport': {
            const shot = await this.cdpClient.captureScreenshot();
            this.sendImageFrame(shot.data);
            result = {
              success: true,
              message:
                'Viewport screenshot captured successfully and fed into Gemini vision stream.',
            };
            break;
          }

          case 'open_youtube': {
            const tab = await this.cdpClient.openYouTube(call.args.query);
            result = { success: true, url: tab?.url || 'https://www.youtube.com' };
            break;
          }

          case 'navigate_to_url': {
            await this.cdpClient.navigate(call.args.url);
            result = { success: true, url: call.args.url };
            break;
          }

          case 'scroll_page':
          case 'mouse_scroll': {
            const direction = (call.args.direction || 'down') as 'up' | 'down';
            const amount = Number(call.args.amount) || 450;
            const targetApp =
              call.args.target_app || call.args.app || call.args.window_title || 'chrome';
            const yDelta = direction === 'down' ? amount : -amount;

            // 1. Locate window bounds to position the mouse cursor over the document/PDF
            let scrollX = -1;
            let scrollY = -1;
            try {
              const windows = await this.appManager.listRunningWindows();
              const targetWin = this.appManager.resolveAppWindow(targetApp, windows);
              if (targetWin) {
                await this.appManager.focusWindow(targetWin.hwnd);
                const bounds = await this.appManager.getWindowBounds(targetWin.hwnd);
                if (bounds.width > 100 && bounds.height > 100) {
                  scrollX = bounds.x + Math.floor(bounds.width / 2);
                  scrollY = bounds.y + Math.floor(bounds.height / 2);
                }
              }
            } catch {}

            // Fallback to center of screen if window bounds not found
            if (scrollX < 0 || scrollY < 0) {
              const metrics = this.computerVision.getDisplayMetrics();
              scrollX = Math.floor(metrics.width / 2);
              scrollY = Math.floor(metrics.height / 2);
            }

            // 2. Hardware wheel via Win32 OS directly at the window coordinates
            const nativeOk = await this.nativeInput.mouseScrollAt(scrollX, scrollY, -yDelta);

            // 3. Hardware wheel via CDP if Chrome is listening
            const cdpOk = await this.cdpClient.scroll(direction, amount).catch(() => false);

            // 4. Keyboard page scroll (PageDown / PageUp) to advance PDFs and readers
            await this.nativeInput
              .sendHotkey(direction === 'down' ? 'PageDown' : 'PageUp')
              .catch(() => undefined);

            result = { success: nativeOk || cdpOk, direction, amount, targetApp };
            break;
          }

          case 'read_page': {
            const pageData = await this.cdpClient.readPage();
            result = { success: true, ...pageData };
            break;
          }

          default:
            result = { error: `Unrecognized tool function: ${call.name}` };
        }

        responses.push({
          id: call.id,
          name: call.name,
          response: { result },
        });

        this.emit('conversation-message', {
          id: `tool_${Date.now()}`,
          kind: 'tool',
          name: call.name,
          title: `Completed: ${call.name}`,
          status: 'ok',
          at: Date.now(),
        } as ConversationMessage);
      } catch (toolErr) {
        responses.push({
          id: call.id,
          name: call.name,
          response: { error: { message: (toolErr as Error).message } },
        });

        this.emit('conversation-message', {
          id: `tool_${Date.now()}`,
          kind: 'tool',
          name: call.name,
          title: `Failed: ${call.name}`,
          detail: (toolErr as Error).message,
          status: 'error',
          at: Date.now(),
        } as ConversationMessage);
      }
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN && responses.length > 0) {
      this.socket.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: responses,
          },
        }),
      );
    }
  }

  private emitTelemetry(): void {
    const curTask = this.workflowEngine ? this.workflowEngine.getCurrentTask() : null;
    const hw = this.hardwareMonitor?.getLastMetrics();
    const telemetry: NeuralTelemetry = {
      active:
        this.status === 'listening' || this.status === 'speaking' || this.status === 'thinking',
      cpuUsage: hw?.cpuUsage,
      memoryUsagePercent: hw?.memoryUsagePercent,
      memoryUsedBytes: hw?.memoryUsed,
      memoryTotalBytes: hw?.memoryTotal,
      processCount: hw?.activeProcessCount,
      uptimeSeconds: hw?.uptimeSeconds,
      workflowActive: curTask ? curTask.status === 'running' : false,
      activeStepTitle: curTask?.steps[curTask.activeStepIndex]?.description,
      totalSteps: curTask?.steps.length,
      completedSteps: curTask?.steps.filter((s) => s.status === 'completed').length,
    };
    this.emit('telemetry-updated', telemetry);
  }

  private setStatus(newStatus: LiveHUDStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.emit('status-changed', newStatus);
      this.emitTelemetry();
    }
  }

  private emitError(message: string): void {
    this.emit('error', message);
    this.emit('conversation-message', {
      id: `sys_${Date.now()}`,
      kind: 'system',
      text: message,
      at: Date.now(),
    } as ConversationMessage);
  }

  private loadInitialSettings(): HUDSettings {
    let key = process.env.GEMINI_API_KEY || '';

    // Attempt to load from apps/local-bridge/.env
    const bridgeEnvPath = 'E:\\Gemetron\\apps\\local-bridge\\.env';
    if (!key && existsSync(bridgeEnvPath)) {
      try {
        const text = readFileSync(bridgeEnvPath, 'utf8');
        const match = text.match(/GEMINI_API_KEY=([^\r\n]+)/);
        if (match && match[1]) {
          key = match[1].trim();
        }
      } catch {}
    }

    return {
      apiKey: key,
      modelId: 'gemini-3.8-live',
      voice: 'Kore',
      autoApprove: true,
      alwaysOnTop: true,
      bridgeUrl: 'http://127.0.0.1:47821',
      soundEffectsEnabled: true,
      soundVolume: 0.5,
      minimizeToTray: true,
    };
  }

  public dispose(): void {
    this.disconnect();
    this.hardwareMonitor?.dispose();
    this.removeAllListeners();
  }
}
