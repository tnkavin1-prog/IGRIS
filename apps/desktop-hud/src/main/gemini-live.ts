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

  private settings: HUDSettings;
  private status: LiveHUDStatus = 'idle';

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
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus('idle');
    this.emitTelemetry();
  }

  public sendText(text: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

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
                'You possess OS-wide computer vision and full native control over Windows: mouse clicking and movement, keyboard typing and hotkeys, application lifecycle management, and Google Chrome browser tabs via CDP.',
                'When requested to operate the computer, invoke the appropriate tools: computer_use_click, computer_use_type, computer_use_hotkey, computer_use_screenshot, find_text_on_screen, launch_application, switch_active_window, run_system_command, manage_browser_tabs, and plan_autonomous_task.',
                'When the user asks you to explain, solve, or derive a concept in math, physics, or geometry, invoke teach_visual_blackboard to project SVG chalkboard diagrams and LaTeX proofs.',
                'Keep your spoken voice responses concise, confident, and professional while letting your actions execute seamlessly on the user desktop.',
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
                  },
                  required: ['window_title'],
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
                description: 'Scrolls the active Chrome webpage up or down.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    direction: { type: 'STRING', enum: ['up', 'down'] },
                    amount: { type: 'INTEGER', description: 'Scroll distance in pixels' },
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
        }

        if (sc.inputTranscription?.text) {
          this.emit('user-transcript', sc.inputTranscription.text);
          this.emit('conversation-message', {
            id: `usr_${Date.now()}`,
            kind: 'user',
            text: sc.inputTranscription.text,
            at: Date.now(),
          } as ConversationMessage);
        }

        if (sc.outputTranscription?.text) {
          this.emit('gemini-transcript', sc.outputTranscription.text);
          this.emit('conversation-message', {
            id: `asst_${Date.now()}`,
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

            result = {
              success: true,
              width: shot.width,
              height: shot.height,
              sourceName: shot.sourceName,
              message: 'Desktop screenshot captured and fed into vision stream.',
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
            result = { success: ok, window: target };
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

          case 'scroll_page': {
            const scrolled = await this.cdpClient.scroll(
              call.args.direction || 'down',
              call.args.amount || 450,
            );
            result = { success: scrolled };
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
    };
  }

  public dispose(): void {
    this.disconnect();
    this.hardwareMonitor?.dispose();
    this.removeAllListeners();
  }
}
