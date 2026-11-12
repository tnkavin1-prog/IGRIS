import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgenticTask,
  BoundingBoxTarget,
  CaptureResult,
  ChromeStatus,
  ChromeTabInfo,
  CommandResult,
  ConversationMessage,
  CrosshairTarget,
  CursorPosition,
  DesktopSourceInfo,
  DisplayMetrics,
  FindTextOptions,
  HardwareTelemetry,
  HUDSettings,
  LaunchResult,
  LiveHUDStatus,
  NeuralTelemetry,
  SessionExportPayload,
  TabSearchResult,
  TextLocationResult,
  TileWindowsOptions,
  TileWindowsResult,
  VisualBlackboardLesson,
  WindowItem,
  WindowTilingLayout,
  WorkflowStep,
  WorkflowStepInput,
} from './types.js';
import type { AppAlias, RecentContextEntry, TaskRecipe, UserPreferences } from './jarvis-memory.js';
import type { OpenTabResult } from './browser-gateway.js';

const api = {
  windowControl: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    togglePin: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-pin'),
    isPinned: (): Promise<boolean> => ipcRenderer.invoke('window:is-pinned'),
    setDisplayMode: (mode: 'orb' | 'bar' | 'full' | 'console'): Promise<string> =>
      ipcRenderer.invoke('window:set-display-mode', mode),
    getDisplayMode: (): Promise<string> => ipcRenderer.invoke('window:get-display-mode'),
    onMaximizedChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_: unknown, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on('window:maximized-changed', handler);
      return () => ipcRenderer.removeListener('window:maximized-changed', handler);
    },
  },

  cdp: {
    getStatus: (): Promise<ChromeStatus> => ipcRenderer.invoke('cdp:get-status'),
    listTabs: (): Promise<ChromeTabInfo[]> => ipcRenderer.invoke('cdp:list-tabs'),
    getActiveTab: (): Promise<ChromeTabInfo | null> => ipcRenderer.invoke('cdp:get-active-tab'),
    switchTab: (tabId: string): Promise<boolean> => ipcRenderer.invoke('cdp:switch-tab', tabId),
    createTab: (url?: string): Promise<OpenTabResult> => ipcRenderer.invoke('cdp:create-tab', url),
    closeTab: (tabId: string): Promise<boolean> => ipcRenderer.invoke('cdp:close-tab', tabId),
    captureScreenshot: (tabId?: string): Promise<{ data: string; mimeType: 'image/jpeg' }> =>
      ipcRenderer.invoke('cdp:capture-screenshot', tabId),
    navigate: (
      url: string,
      tabId?: string,
    ): Promise<{ ok: boolean; url: string; error?: string }> =>
      ipcRenderer.invoke('cdp:navigate', url, tabId),
    openYouTube: (query?: string): Promise<OpenTabResult> =>
      ipcRenderer.invoke('cdp:open-youtube', query),
    launchChrome: (url?: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('cdp:launch-chrome', url),
    duplicateTab: (tabId?: string): Promise<ChromeTabInfo | null> =>
      ipcRenderer.invoke('cdp:duplicate-tab', tabId),
    reloadTab: (tabId?: string, ignoreCache?: boolean): Promise<boolean> =>
      ipcRenderer.invoke('cdp:reload-tab', tabId, ignoreCache),
    searchTabContent: (
      query: string,
      options?: { caseSensitive?: boolean },
    ): Promise<TabSearchResult> => ipcRenderer.invoke('cdp:search-tab-content', query, options),
    closeDuplicateTabs: (): Promise<{
      closedCount: number;
      closedTabs: ChromeTabInfo[];
      remainingCount: number;
    }> => ipcRenderer.invoke('cdp:close-duplicate-tabs'),

    onActiveTabChanged: (callback: (tab: ChromeTabInfo) => void): (() => void) => {
      const handler = (_: unknown, tab: ChromeTabInfo) => callback(tab);
      ipcRenderer.on('cdp:active-tab-changed', handler);
      return () => ipcRenderer.removeListener('cdp:active-tab-changed', handler);
    },

    onConnectionChanged: (callback: (connected: boolean) => void): (() => void) => {
      const handler = (_: unknown, connected: boolean) => callback(connected);
      ipcRenderer.on('cdp:connection-changed', handler);
      return () => ipcRenderer.removeListener('cdp:connection-changed', handler);
    },
  },

  gemini: {
    connect: (): Promise<boolean> => ipcRenderer.invoke('gemini:connect'),
    disconnect: (): Promise<void> => ipcRenderer.invoke('gemini:disconnect'),
    sendText: (text: string): Promise<boolean> => ipcRenderer.invoke('gemini:send-text', text),
    sendAudioChunk: (base64: string): Promise<void> =>
      ipcRenderer.invoke('gemini:send-audio-chunk', base64),
    sendFrame: (base64: string): Promise<void> => ipcRenderer.invoke('gemini:send-frame', base64),
    getSettings: (): Promise<HUDSettings> => ipcRenderer.invoke('gemini:get-settings'),
    updateSettings: (settings: Partial<HUDSettings>): Promise<void> =>
      ipcRenderer.invoke('gemini:update-settings', settings),

    onWakeWord: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('gemini:wake-word', handler);
      return () => ipcRenderer.removeListener('gemini:wake-word', handler);
    },
    onStatusChanged: (callback: (status: LiveHUDStatus) => void): (() => void) => {
      const handler = (_: unknown, status: LiveHUDStatus) => callback(status);
      ipcRenderer.on('gemini:status-changed', handler);
      return () => ipcRenderer.removeListener('gemini:status-changed', handler);
    },

    onConversationMessage: (callback: (msg: ConversationMessage) => void): (() => void) => {
      const handler = (_: unknown, msg: ConversationMessage) => callback(msg);
      ipcRenderer.on('gemini:conversation-message', handler);
      return () => ipcRenderer.removeListener('gemini:conversation-message', handler);
    },

    onBlackboardLesson: (callback: (lesson: VisualBlackboardLesson) => void): (() => void) => {
      const handler = (_: unknown, lesson: VisualBlackboardLesson) => callback(lesson);
      ipcRenderer.on('gemini:blackboard-lesson', handler);
      return () => ipcRenderer.removeListener('gemini:blackboard-lesson', handler);
    },

    onAudioChunk: (callback: (chunk: { data: string; mimeType: string }) => void): (() => void) => {
      const handler = (_: unknown, chunk: { data: string; mimeType: string }) => callback(chunk);
      ipcRenderer.on('gemini:audio-chunk', handler);
      return () => ipcRenderer.removeListener('gemini:audio-chunk', handler);
    },

    onInterrupted: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('gemini:interrupted', handler);
      return () => ipcRenderer.removeListener('gemini:interrupted', handler);
    },

    onTurnComplete: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('gemini:turn-complete', handler);
      return () => ipcRenderer.removeListener('gemini:turn-complete', handler);
    },

    onError: (callback: (err: string) => void): (() => void) => {
      const handler = (_: unknown, err: string) => callback(err);
      ipcRenderer.on('gemini:error', handler);
      return () => ipcRenderer.removeListener('gemini:error', handler);
    },

    onAskGeminiPrompt: (callback: (data: { prompt: string }) => void): (() => void) => {
      const handler = (_: unknown, data: { prompt: string }) => callback(data);
      ipcRenderer.on('ask-gemini:prompt', handler);
      return () => ipcRenderer.removeListener('ask-gemini:prompt', handler);
    },
  },

  computer: {
    captureScreen: (sourceId?: string): Promise<CaptureResult> =>
      ipcRenderer.invoke('computer:capture-screen', sourceId),
    captureWindow: (windowTitle: string): Promise<CaptureResult> =>
      ipcRenderer.invoke('computer:capture-window', windowTitle),
    listSources: (): Promise<DesktopSourceInfo[]> => ipcRenderer.invoke('computer:list-sources'),
    getDisplayMetrics: (): Promise<DisplayMetrics> =>
      ipcRenderer.invoke('computer:get-display-metrics'),

    mouseMove: (x: number, y: number): Promise<boolean> =>
      ipcRenderer.invoke('computer:mouse-move', x, y),
    mouseClick: (
      x: number,
      y: number,
      options?: { button?: 'left' | 'right' | 'middle'; double?: boolean },
    ): Promise<boolean> => ipcRenderer.invoke('computer:mouse-click', x, y, options),
    mouseDrag: (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      steps?: number,
    ): Promise<boolean> =>
      ipcRenderer.invoke('computer:mouse-drag', startX, startY, endX, endY, steps),
    mouseScroll: (deltaY: number): Promise<boolean> =>
      ipcRenderer.invoke('computer:mouse-scroll', deltaY),
    getCursor: (): Promise<CursorPosition> => ipcRenderer.invoke('computer:get-cursor'),
    typeText: (text: string): Promise<boolean> => ipcRenderer.invoke('computer:type-text', text),
    sendHotkey: (keys: string | string[]): Promise<boolean> =>
      ipcRenderer.invoke('computer:send-hotkey', keys),
    findTextOnScreen: (text: string, options?: FindTextOptions): Promise<TextLocationResult> =>
      ipcRenderer.invoke('computer:find-text-on-screen', text, options),
  },

  apps: {
    listWindows: (): Promise<WindowItem[]> => ipcRenderer.invoke('apps:list-windows'),
    launch: (appName: string, args?: string[]): Promise<LaunchResult> =>
      ipcRenderer.invoke('apps:launch', appName, args),
    focusWindow: (query: string | number): Promise<boolean> =>
      ipcRenderer.invoke('apps:focus-window', query),
    minimizeWindow: (query: string | number): Promise<boolean> =>
      ipcRenderer.invoke('apps:minimize-window', query),
    maximizeWindow: (query: string | number): Promise<boolean> =>
      ipcRenderer.invoke('apps:maximize-window', query),
    closeWindow: (query: string | number): Promise<boolean> =>
      ipcRenderer.invoke('apps:close-window', query),
    tileWindows: (
      layout: WindowTilingLayout,
      options?: TileWindowsOptions,
    ): Promise<TileWindowsResult> => ipcRenderer.invoke('apps:tile-windows', layout, options),
    runCommand: (
      command: string,
      options?: { timeoutMs?: number; requiresApproval?: boolean },
    ): Promise<CommandResult> => ipcRenderer.invoke('apps:run-command', command, options),
  },

  workflow: {
    createTask: (goal: string, steps?: WorkflowStepInput[]): Promise<AgenticTask> =>
      ipcRenderer.invoke('workflow:create-task', goal, steps),
    startTask: (taskId?: string): Promise<AgenticTask> =>
      ipcRenderer.invoke('workflow:start-task', taskId),
    pauseTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke('workflow:pause-task', taskId),
    pauseCurrent: (): Promise<boolean> => ipcRenderer.invoke('workflow:pause-current'),
    resumeTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke('workflow:resume-task', taskId),
    resumeCurrent: (): Promise<boolean> => ipcRenderer.invoke('workflow:resume-current'),
    cancelTask: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke('workflow:cancel-task', taskId),
    emergencyStop: (reason?: string): Promise<{ stopped: boolean; task: AgenticTask | null }> =>
      ipcRenderer.invoke('workflow:emergency-stop', reason),
    approveStep: (taskId: string, stepId: string): Promise<boolean> =>
      ipcRenderer.invoke('workflow:approve-step', taskId, stepId),
    rejectStep: (taskId: string, stepId: string, reason?: string): Promise<boolean> =>
      ipcRenderer.invoke('workflow:reject-step', taskId, stepId, reason),
    getCurrentTask: (): Promise<AgenticTask | null> =>
      ipcRenderer.invoke('workflow:get-current-task'),

    onTaskUpdated: (callback: (task: AgenticTask) => void): (() => void) => {
      const handler = (_: unknown, task: AgenticTask) => callback(task);
      ipcRenderer.on('workflow:task-updated', handler);
      return () => ipcRenderer.removeListener('workflow:task-updated', handler);
    },

    onNeedsApproval: (
      callback: (data: { task: AgenticTask; step: WorkflowStep }) => void,
    ): (() => void) => {
      const handler = (_: unknown, data: { task: AgenticTask; step: WorkflowStep }) =>
        callback(data);
      ipcRenderer.on('workflow:needs-approval', handler);
      return () => ipcRenderer.removeListener('workflow:needs-approval', handler);
    },

    onEmergencyStop: (
      callback: (data: { task: AgenticTask; reason: string }) => void,
    ): (() => void) => {
      const handler = (_: unknown, data: { task: AgenticTask; reason: string }) => callback(data);
      ipcRenderer.on('workflow:emergency-stop', handler);
      return () => ipcRenderer.removeListener('workflow:emergency-stop', handler);
    },
  },

  telemetry: {
    onCrosshairTarget: (callback: (target: CrosshairTarget) => void): (() => void) => {
      const handler = (_: unknown, target: CrosshairTarget) => callback(target);
      ipcRenderer.on('telemetry:crosshair-target', handler);
      return () => ipcRenderer.removeListener('telemetry:crosshair-target', handler);
    },

    onBoundingBoxTarget: (callback: (target: BoundingBoxTarget) => void): (() => void) => {
      const handler = (_: unknown, target: BoundingBoxTarget) => callback(target);
      ipcRenderer.on('telemetry:bounding-box-target', handler);
      return () => ipcRenderer.removeListener('telemetry:bounding-box-target', handler);
    },

    onTelemetryUpdated: (callback: (telemetry: NeuralTelemetry) => void): (() => void) => {
      const handler = (_: unknown, telemetry: NeuralTelemetry) => callback(telemetry);
      ipcRenderer.on('telemetry:updated', handler);
      return () => ipcRenderer.removeListener('telemetry:updated', handler);
    },

    getHardwareMetrics: (): Promise<HardwareTelemetry> =>
      ipcRenderer.invoke('telemetry:get-hardware-metrics'),
  },

  memory: {
    getPreferences: (): Promise<UserPreferences> => ipcRenderer.invoke('memory:get-preferences'),
    updatePreferences: (partial: Partial<UserPreferences>): Promise<UserPreferences> =>
      ipcRenderer.invoke('memory:update-preferences', partial),
    getAlias: (name: string): Promise<AppAlias | undefined> =>
      ipcRenderer.invoke('memory:get-alias', name),
    setAlias: (name: string, targetApp: string, args?: string[]): Promise<AppAlias> =>
      ipcRenderer.invoke('memory:set-alias', name, targetApp, args),
    listAliases: (): Promise<AppAlias[]> => ipcRenderer.invoke('memory:list-aliases'),
    getTaskRecipes: (): Promise<TaskRecipe[]> => ipcRenderer.invoke('memory:get-recipes'),
    getRecentContext: (limit?: number): Promise<RecentContextEntry[]> =>
      ipcRenderer.invoke('memory:get-recent-context', limit),
  },

  session: {
    exportNotes: (
      payload: SessionExportPayload,
    ): Promise<{
      ok: boolean;
      mdPath?: string;
      htmlPath?: string;
      filename?: string;
      error?: string;
    }> => ipcRenderer.invoke('session:export', payload),
  },

  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write-text', text),
    hasText: (): Promise<boolean> => ipcRenderer.invoke('clipboard:has-text'),
    readHtml: (): Promise<string> => ipcRenderer.invoke('clipboard:read-html'),
    writeHtml: (html: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write-html', html),
    clear: (): Promise<void> => ipcRenderer.invoke('clipboard:clear'),
  },

  tray: {
    onOpenRadar: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('tray:open-radar', handler);
      return () => ipcRenderer.removeListener('tray:open-radar', handler);
    },
    onOpenBlackboard: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('tray:open-blackboard', handler);
      return () => ipcRenderer.removeListener('tray:open-blackboard', handler);
    },
    onToggleSoundMute: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('tray:toggle-sound-mute', handler);
      return () => ipcRenderer.removeListener('tray:toggle-sound-mute', handler);
    },
  },
};

export type GeminiHUDAPI = typeof api;

contextBridge.exposeInMainWorld('geminiHUD', api);
