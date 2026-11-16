import { app, ipcMain, globalShortcut, shell, session, screen } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { CDPClient } from './cdp-client.js';
import { HardwareMonitorService } from './hardware-monitor.js';
import {
  ELECTRON_USER_DATA_DIR,
  ICON_PATH,
  LOGS_DIR,
  NOTES_DIR,
  TEMP_DIR,
} from './runtime-paths.js';
import { WakeWordService } from './wake-word.js';
import { startAutoUpdates } from './auto-update.js';
import { cleanupTempDir } from './temp-cleanup.js';

const LOG_ROTATION_BYTES = 5 * 1024 * 1024;

function rotateLogIfNeeded(logPath: string): void {
  try {
    const stat = statSync(logPath);
    if (stat.size < LOG_ROTATION_BYTES) return;
    const rotated = `${logPath}.1`;
    try {
      unlinkSync(rotated);
    } catch {
      /* no previous backup */
    }
    renameSync(logPath, rotated);
  } catch {
    /* the file does not exist yet, or it is not writable */
  }
}

function logLine(file: 'hud-startup' | 'electron-error', msg: string): void {
  const logPath = join(LOGS_DIR, `${file}.log`);
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    rotateLogIfNeeded(logPath);
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {
    console.error(`[Log] Failed to write ${file}.log`);
  }
}

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  try {
    logLine('electron-error', `UncaughtException: ${err?.stack || err}`);
  } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
  try {
    logLine('electron-error', `UnhandledRejection: ${(reason as Error)?.stack || reason}`);
  } catch {}
});
import { ChromeLauncher } from './chrome-launcher.js';
import { GeminiLiveService } from './gemini-live.js';
import { ControlServer } from './control-server.js';
import { ControlAuthService } from './control-auth.js';
import { SecurityAuditor } from './security-auditor.js';
import { exportAuditSession } from './audit-exporter.js';
import { TrayManager } from './tray-manager.js';
import {
  createMainWindow,
  ensureWindowVisible,
  getMainWindow,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  toggleAlwaysOnTop,
  setDisplayMode,
  getDisplayMode,
  presentWindow,
  getWindowDiagnostics,
} from './window.js';
import type {
  FindTextOptions,
  SessionExportPayload,
  TileWindowsOptions,
  WindowTilingLayout,
} from './types.js';
import { screenGrounding } from './screen-grounding.js';

// GPU acceleration flags for transparent overlay rendering.
// Must be set before app.ready / app.whenReady.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

// Electron keeps its own caches, cookies and local storage under the
// userData directory. Both it and the temporary directory must follow the
// configured data root, otherwise a development run writes Chromium caches
// and the updater staging area to the system drive.
{
  try {
    mkdirSync(ELECTRON_USER_DATA_DIR, { recursive: true });
    app.setPath('userData', ELECTRON_USER_DATA_DIR);
    app.setPath('temp', TEMP_DIR);
  } catch {
    /* read-only media: Electron falls back to its own defaults */
  }
}

// Allow the renderer to access the microphone for voice input. Without this
// handler Electron denies the permission in packaged builds, which silently
// breaks wake word and live transcription.
//
// This MUST run after app is ready: `session.defaultSession` throws
// "Session can only be received when app is ready" if accessed at module
// load time, which crashes the whole main process before a window is shown.
function configurePermissions(): void {
  const allowed = new Set(['media', 'microphone', 'audioCapture', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    allowed.has(permission),
  );
}

// Register custom Windows URI protocol (e.g. gematron://summon)
// Protocol registration is deferred until the Electron app is ready.
// Moving this inside app.whenReady() prevents a module-load-time crash
// that killed the main process before createMainWindow() could run.
void app.whenReady().then(() => {
  for (const protocol of ['gematron', 'gemetron']) {
    try {
      if (process.defaultApp && process.argv.length >= 2 && process.argv[1]) {
        app.setAsDefaultProtocolClient(protocol, process.execPath, [process.argv[1]]);
      } else {
        app.setAsDefaultProtocolClient(protocol);
      }
    } catch (err) {
      console.warn(`[hud] Failed to register "${protocol}" protocol client:`, err);
    }
  }
});

// Strictly Singleton: ensure only ONE instance exists across the OS
const gotLock = app.requestSingleInstanceLock();
logLine('hud-startup', `gotLock: ${gotLock}`);
if (!gotLock) {
  console.log('[Singleton] Another instance of Gemini Desktop HUD is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.setAlwaysOnTop(true);
      win.moveTop();
    }
  });

  let isQuitting = false;
  let trayManager: TrayManager | null = null;
  let liveService: GeminiLiveService;
  const wakeWord = new WakeWordService();
  let stopAutoUpdates = () => {};
  // True only when the system tray actually initialised. Hiding the window
  // without a tray would leave an unreachable background process.
  let trayReady = false;

  app.on('before-quit', () => {
    logLine('hud-startup', `app before-quit fired (isQuitting: ${isQuitting})`);
    isQuitting = true;
    stopAutoUpdates();
    void wakeWord.dispose();
    liveService?.input.dispose();
    trayManager?.destroy();
  });

  app.on('will-quit', () => {
    logLine('hud-startup', 'app will-quit fired');
  });

  app.on('quit', (_, exitCode) => {
    logLine('hud-startup', `app quit fired (exitCode: ${exitCode})`);
  });

  const cdpClient = new CDPClient(9222, '127.0.0.1');
  let controlServer: ControlServer;
  let hardwareMonitor: HardwareMonitorService;

  app.whenReady().then(async () => {
    try {
      // Must be configured after the app is ready; touching
      // session.defaultSession at module load crashes the main process.
      try {
        configurePermissions();
      } catch (permErr) {
        logLine(
          'hud-startup',
          `Permission handler setup failed: ${permErr instanceof Error ? permErr.message : String(permErr)}`,
        );
      }
      logLine('hud-startup', 'app.whenReady started');
      try {
        const cleanup = cleanupTempDir();
        if (cleanup.removedFiles + cleanup.removedDirs > 0) {
          logLine(
            'hud-startup',
            `Temp cleanup removed ${cleanup.removedFiles} files and ${cleanup.removedDirs} dirs (${cleanup.bytesFreed} bytes)`,
          );
        }
      } catch {
        /* temp cleanup is best-effort */
      }
      liveService = new GeminiLiveService(cdpClient);
      logLine('hud-startup', 'GeminiLiveService created');
      hardwareMonitor = new HardwareMonitorService();
      hardwareMonitor.start();
      logLine('hud-startup', 'HardwareMonitor created');
      const controlAuth = new ControlAuthService();
      controlServer = new ControlServer(
        Number(process.env.GEMATRON_CONTROL_PORT ?? 9228),
        '127.0.0.1',
        {
          auth: controlAuth,
          audit: new SecurityAuditor({ mockMode: false }),
        },
      );
      logLine('hud-startup', 'ControlServer created');

      const preloadPath = join(__dirname, 'preload.cjs');
      const htmlPath = join(__dirname, 'index.html');

      const win = createMainWindow(preloadPath, htmlPath);
      logLine('hud-startup', 'MainWindow created');
      presentWindow();
      stopAutoUpdates = startAutoUpdates();
      try {
        liveService.input.setDisplayMetrics(liveService.vision.getDisplayMetrics());
      } catch {
        /* ignore */
      }

      // Wire up screen grounding with live services for visual element detection
      screenGrounding.setAppManager(liveService.apps);
      screenGrounding.setCDPClient(cdpClient);
      screenGrounding.setComputerVision(liveService.vision);

      // Expose live service for autonomous agent vision frame streaming
      (globalThis as any).__geminiLiveService = liveService;

      const summonHUD = () => {
        const w = getMainWindow();
        if (w) {
          // A previous monitor change, an orb collapse or a dragged window can
          // leave the HUD off-screen. Summon must always reveal it.
          ensureWindowVisible();
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
          w.setAlwaysOnTop(true);
          w.moveTop();
        }
      };

      const toggleHUD = () => {
        const w = getMainWindow();
        if (w) {
          if (w.isVisible() && w.isFocused()) {
            if (trayReady && liveService.currentSettings.minimizeToTray) {
              w.hide();
            } else {
              w.minimize();
            }
          } else {
            summonHUD();
          }
        }
      };

      // Initialize System Tray & Background Daemon
      trayManager = new TrayManager({
        iconPath: ICON_PATH,
        callbacks: {
          onSummon: () => summonHUD(),
          onKillswitch: () => {
            void liveService.emergencyStop('Emergency killswitch triggered from System Tray');
            safeSend('workflow:emergency-stop', {
              reason: 'Emergency killswitch triggered from System Tray',
            });
            trayManager?.setStatus(trayManager.getStatusLabel());
          },
          onDesktopRadar: () => {
            summonHUD();
            safeSend('tray:open-radar');
          },
          onVisualBlackboard: () => {
            summonHUD();
            safeSend('tray:open-blackboard');
          },
          onToggleSoundMute: () => {
            safeSend('tray:toggle-sound-mute');
          },
          onOpenNotes: () => {
            try {
              void shell.openPath(NOTES_DIR);
            } catch {}
          },
          onExit: () => {
            isQuitting = true;
            app.quit();
          },
          getStatus: () => {
            const curTask = liveService.workflow.getCurrentTask();
            if (curTask) {
              if (curTask.status === 'running') return 'Running Task';
              if (curTask.status === 'paused') return 'Paused';
              if (curTask.status === 'waiting_approval') return 'Waiting Approval';
            }
            const liveStatus = liveService.currentStatus;
            if (liveStatus === 'listening') return 'Listening';
            if (liveStatus === 'thinking') return 'Thinking';
            if (liveStatus === 'speaking') return 'Speaking';
            return 'Idle';
          },
        },
      });
      trayReady = trayManager.init();

      // Closing the HUD window always means "quit".
      // Tray background mode is opt-in and is reached through Minimize, never
      // through the close button. Previously X only called win.hide(), so the
      // process survived with no visible window and had to be killed from Task
      // Manager, and any summon (hotkey / tray / :9228) made it reappear.
      win.on('close', () => {
        isQuitting = true;
        // A quitting HUD must not keep the microphone open.
        try {
          liveService.disconnect();
        } catch {}
      });

      win.on('minimize', () => {
        if (!isQuitting && trayReady && liveService.currentSettings.minimizeToTray) {
          win.hide();
        }
        cdpClient.suspendTracking();
      });

      win.on('hide', () => {
        cdpClient.suspendTracking();
      });

      win.on('show', () => {
        cdpClient.resumeTracking();
      });

      win.on('restore', () => {
        cdpClient.resumeTracking();
      });

      // Start background tracking of Chrome tabs
      cdpClient.startTracking(1500);

      // A monitor being unplugged or its resolution changing must never leave
      // the HUD stranded outside the remaining work area.
      screen.on('display-removed', () => {
        ensureWindowVisible();
      });
      screen.on('display-metrics-changed', () => {
        ensureWindowVisible();
      });

      // Start in-Chrome loopback summon server (http://127.0.0.1:9228/summon)
      const controlPort = Number(process.env.GEMATRON_CONTROL_PORT ?? 9228);
      const controlBound = await controlServer.start(() => {
        // The in-Chrome summon endpoint reveals the HUD too, so it must not
        // return a window that is stranded off-screen.
        ensureWindowVisible();
        return getMainWindow();
      }, cdpClient);
      logLine(
        'hud-startup',
        controlBound
          ? `ControlServer started on port ${controlPort}`
          : `ControlServer could not bind port ${controlPort}; another instance is already serving it`,
      );

      // Do not open Chrome when the HUD starts: only the Gematron HUD should appear.
      // Chrome can be launched explicitly from the HUD ("Open Chrome").
      // Set GEMATRON_AUTOLAUNCH_CHROME=1 to opt back into the old auto-launch behaviour.
      if (process.env.GEMATRON_AUTOLAUNCH_CHROME === '1') {
        const isChromeActive = await ChromeLauncher.isPortAvailable();
        if (!isChromeActive) {
          console.log(
            '[ChromeLauncher] Chrome remote debugging port 9222 not detected. Spawning Chrome...',
          );
          void liveService.browser.focusOrLaunch();
        }
      }

      const safeSend = (channel: string, ...args: any[]) => {
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send(channel, ...args);
          } catch {
            /* ignore */
          }
        }
      };

      wakeWord.on('wake', () => {
        void wakeWord.setPaused(true).then(() => {
          summonHUD();
          safeSend('gemini:wake-word');
        });
      });
      wakeWord.on('unavailable', (message: string) => {
        safeSend('gemini:conversation-message', {
          id: `wake_${Date.now()}`,
          kind: 'system',
          title: 'Wake word unavailable',
          text: message,
          at: Date.now(),
        });
      });
      liveService.on('settings-updated', (settings) => {
        void wakeWord.setEnabled(settings.wakeWordEnabled === true);
      });
      liveService.on('status-changed', (status) => {
        void wakeWord.setPaused(!['idle', 'closed', 'error'].includes(status));
      });
      void wakeWord.setEnabled(liveService.currentSettings.wakeWordEnabled === true);

      // Forward CDP events to Renderer
      cdpClient.on('active-tab-changed', (tab) => {
        safeSend('cdp:active-tab-changed', tab);
      });

      cdpClient.on('connection-changed', (connected) => {
        safeSend('cdp:connection-changed', connected);
      });

      // Forward Gemini Live events to Renderer
      liveService.on('status-changed', (status) => {
        safeSend('gemini:status-changed', status);
        trayManager?.setStatus(trayManager.getStatusLabel());
      });

      liveService.on('conversation-message', (msg) => {
        safeSend('gemini:conversation-message', msg);
      });

      liveService.on('blackboard-lesson', (lesson) => {
        safeSend('gemini:blackboard-lesson', lesson);
      });

      liveService.on('audio-chunk', (chunk) => {
        safeSend('gemini:audio-chunk', chunk);
      });

      liveService.on('interrupted', () => {
        safeSend('gemini:interrupted');
      });

      liveService.on('turn-complete', () => {
        safeSend('gemini:turn-complete');
      });

      // Forward window maximize events to Renderer
      win.on('maximize', () => {
        safeSend('window:maximized-changed', true);
      });
      win.on('unmaximize', () => {
        safeSend('window:maximized-changed', false);
      });

      liveService.on('error', (err) => {
        safeSend('gemini:error', err);
      });

      liveService.on('workflow:task-updated', (task) => {
        safeSend('workflow:task-updated', task);
        trayManager?.setStatus(trayManager.getStatusLabel());
      });

      liveService.on('workflow:needs-approval', (data) => {
        safeSend('workflow:needs-approval', data);
      });

      liveService.on('crosshair-target', (target) => {
        safeSend('telemetry:crosshair-target', target);
      });

      liveService.on('bounding-box-target', (target) => {
        safeSend('telemetry:bounding-box-target', target);
      });

      liveService.on('workflow:emergency-stop', (data) => {
        safeSend('workflow:emergency-stop', data);
      });

      liveService.on('telemetry-updated', (telem) => {
        safeSend('telemetry:updated', telem);
      });

      // Register global summon shortcut (Ctrl+Alt+Space)
      try {
        globalShortcut.register('CommandOrControl+Alt+Space', () => {
          toggleHUD();
        });
      } catch (err) {
        console.warn('[GlobalShortcut] Failed to register Ctrl+Alt+Space:', err);
      }

      // Register global emergency stop shortcut (Ctrl+Alt+K)
      try {
        globalShortcut.register('CommandOrControl+Alt+K', () => {
          void liveService.emergencyStop('Emergency global shortcut Ctrl+Alt+K triggered');
          safeSend('workflow:emergency-stop', {
            reason: 'Emergency global shortcut Ctrl+Alt+K triggered',
          });
          trayManager?.setStatus(trayManager.getStatusLabel());
        });
      } catch (err) {
        console.warn('[GlobalShortcut] Failed to register Ctrl+Alt+K:', err);
      }
      logLine('hud-startup', 'app.whenReady completed successfully');
    } catch (startupErr) {
      logLine('hud-startup', `Startup ERROR: ${(startupErr as Error)?.stack || startupErr}`);
    }
  });

  function isTrustedHudFrame(event: Electron.IpcMainInvokeEvent): boolean {
    try {
      const frame = event.senderFrame;
      if (!frame) return false;
      const url = new URL(frame.url);
      const expected = pathToFileURL(join(__dirname, 'index.html'));
      return url.origin === expected.origin && url.protocol === 'file:';
    } catch {
      return false;
    }
  }

  // Security boundary: payload size limit (1MB per argument)
  const MAX_PAYLOAD_BYTES = 1024 * 1024;
  function validatePayloadSize(...args: any[]): void {
    for (const arg of args) {
      const size = JSON.stringify(arg).length;
      if (size > MAX_PAYLOAD_BYTES) {
        throw new Error(`IPC payload exceeds ${MAX_PAYLOAD_BYTES} byte limit`);
      }
    }
  }

  // Security boundary: per-channel rate limiting (100 calls per minute)
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX_CALLS = 100;
  const channelCallCounts = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(channel: string): void {
    const now = Date.now();
    let entry = channelCallCounts.get(channel);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      channelCallCounts.set(channel, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_CALLS) {
      throw new Error(`Rate limit exceeded for channel: ${channel}`);
    }
  }

  // Track child processes for supervision
  const supervisedProcesses = new Set<{ pid: number; kill: () => void }>();
  function cleanupSupervisedProcesses(): void {
    for (const proc of supervisedProcesses) {
      try {
        proc.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }
    supervisedProcesses.clear();
  }

  function handleHud(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedHudFrame(event)) {
        throw new Error('Blocked IPC from untrusted renderer: ' + channel);
      }
      validatePayloadSize(...args);
      checkRateLimit(channel);
      return handler(event, ...args);
    });
  }

  // Setup IPC Handlers
  handleHud('window:minimize', () => minimizeWindow());
  handleHud('window:toggle-maximize', () => toggleMaximize());
  handleHud('window:is-maximized', () => getMainWindow()?.isMaximized() ?? false);
  handleHud('window:close', () => closeWindow());
  handleHud('window:toggle-pin', () => toggleAlwaysOnTop());
  handleHud('window:is-pinned', () => getMainWindow()?.isAlwaysOnTop() ?? true);
  handleHud('window:set-display-mode', (_, mode: string) =>
    setDisplayMode(mode as 'orb' | 'bar' | 'full' | 'console'),
  );
  handleHud('window:get-display-mode', () => getDisplayMode());
  handleHud('window:diagnostics', () => getWindowDiagnostics());
  handleHud('hardware:diagnostics', () => {
    const metrics = hardwareMonitor.getLastMetrics();
    return {
      metrics,
      pressureState: hardwareMonitor.getMemoryPressureState(),
      pressureThresholds: hardwareMonitor.getMemoryPressureThresholds(),
      timestamp: Date.now(),
    };
  });

  // Read-only CDP queries never launch Chrome. Mutations that create or navigate
  // tabs use the same attach-first gateway as voice commands.
  handleHud('cdp:get-status', async () => await cdpClient.getStatus());
  handleHud('cdp:list-tabs', async () => await cdpClient.listTabs());
  handleHud('cdp:get-active-tab', async () => await cdpClient.getActiveTab());
  handleHud('cdp:switch-tab', async (_, tabId: string) => {
    const ok = await cdpClient.switchTab(tabId);
    getMainWindow()?.focus();
    return ok;
  });
  handleHud('cdp:create-tab', async (_, url?: string) => {
    const result = await liveService.browser.openTab(url);
    getMainWindow()?.focus();
    return result;
  });
  handleHud('cdp:close-tab', async (_, tabId: string) => {
    return await cdpClient.closeTab(tabId);
  });
  handleHud('cdp:capture-screenshot', async (_, tabId?: string) => {
    return await cdpClient.captureScreenshot(tabId);
  });
  handleHud('cdp:navigate', async (_, url: string, tabId?: string) => {
    const result = await liveService.browser.navigate(url, tabId);
    getMainWindow()?.focus();
    return { ok: result.success, url: result.url, error: result.error };
  });
  handleHud('cdp:open-youtube', async (_, query?: string) => {
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : 'https://www.youtube.com';
    const result = await liveService.browser.openTab(url);
    getMainWindow()?.focus();
    return result;
  });
  handleHud('cdp:launch-chrome', async (_, url?: string) => {
    const result = url
      ? await liveService.browser.openTab(url)
      : await liveService.browser.focusOrLaunch();
    return {
      ok: result.success,
      message: result.message ?? result.error ?? 'Chrome command completed.',
    };
  });
  handleHud('cdp:duplicate-tab', async (_, tabId?: string) => {
    const tab = await cdpClient.duplicateTab(tabId);
    getMainWindow()?.focus();
    return tab;
  });
  handleHud('cdp:reload-tab', async (_, tabId?: string, ignoreCache?: boolean) => {
    return await cdpClient.reloadTab(tabId, ignoreCache);
  });
  handleHud(
    'cdp:search-tab-content',
    async (_, query: string, options?: { caseSensitive?: boolean }) => {
      return await cdpClient.searchTabContent(query, options);
    },
  );
  handleHud('cdp:close-duplicate-tabs', async () => {
    return await cdpClient.closeDuplicateTabs();
  });

  // Gemini Live IPC Handlers
  handleHud('gemini:connect', async () => {
    await wakeWord.setPaused(true);
    const connected = await liveService.connect();
    if (!connected) await wakeWord.setPaused(false);
    return connected;
  });
  handleHud('gemini:disconnect', () => liveService.disconnect());
  handleHud('gemini:send-text', (_, text: string) => liveService.sendText(text));
  handleHud('gemini:send-audio-chunk', (_, base64: string) =>
    liveService.sendAudioChunk(base64),
  );
  handleHud('gemini:send-frame', (_, base64: string) => liveService.sendImageFrame(base64));
  handleHud('gemini:get-settings', () => liveService.currentSettings);
  handleHud('gemini:update-settings', (_, settings) => liveService.updateSettings(settings));

  // OS Computer Vision & Input Handlers
  handleHud(
    'computer:capture-screen',
    async (_, sourceId?: string) => await liveService.vision.captureScreen(sourceId),
  );
  handleHud(
    'computer:capture-window',
    async (_, windowTitle: string) => await liveService.vision.captureWindow(windowTitle),
  );
  handleHud('computer:list-sources', async () => await liveService.vision.listSources());
  handleHud('computer:get-display-metrics', () => liveService.vision.getDisplayMetrics());
  handleHud(
    'computer:find-text-on-screen',
    async (_, text: string, options?: FindTextOptions) =>
      await liveService.vision.findTextOnScreen(text, options),
  );

  handleHud(
    'computer:mouse-move',
    async (_, x: number, y: number) => await liveService.input.mouseMove(x, y),
  );
  handleHud(
    'computer:mouse-click',
    async (
      _,
      x: number,
      y: number,
      options?: { button?: 'left' | 'right' | 'middle'; double?: boolean },
    ) => await liveService.input.mouseClick(x, y, options),
  );
  handleHud(
    'computer:mouse-drag',
    async (_, startX: number, startY: number, endX: number, endY: number, steps?: number) =>
      await liveService.input.mouseDrag(startX, startY, endX, endY, steps),
  );
  handleHud(
    'computer:mouse-scroll',
    async (_, deltaY: number) => await liveService.input.mouseScroll(deltaY),
  );
  handleHud('computer:get-cursor', async () => await liveService.input.getCursorPosition());
  handleHud(
    'computer:type-text',
    async (_, text: string) => await liveService.input.typeText(text),
  );
  handleHud(
    'computer:send-hotkey',
    async (_, keys: string | string[]) => await liveService.input.sendHotkey(keys),
  );

  // Application Lifecycle & Windows Management Handlers
  handleHud('apps:list-windows', async () => await liveService.apps.listRunningWindows());
  handleHud(
    'apps:launch',
    async (_, appName: string, args?: string[]) =>
      await liveService.apps.launchApplication(appName, args),
  );
  handleHud(
    'apps:focus-window',
    async (_, query: string | number) => await liveService.apps.focusWindow(query),
  );
  handleHud(
    'apps:minimize-window',
    async (_, query: string | number) => await liveService.apps.minimizeWindow(query),
  );
  handleHud(
    'apps:maximize-window',
    async (_, query: string | number) => await liveService.apps.maximizeWindow(query),
  );
  handleHud(
    'apps:close-window',
    async (_, query: string | number) => await liveService.apps.closeWindow(query),
  );
  handleHud(
    'apps:run-command',
    async (_, command: string, options?: { timeoutMs?: number; requiresApproval?: boolean }) =>
      await liveService.apps.runSystemCommand(command, options),
  );
  handleHud(
    'apps:tile-windows',
    async (_, layout: WindowTilingLayout, options?: TileWindowsOptions) =>
      await liveService.apps.tileWindows(layout, options),
  );
  handleHud(
    'telemetry:get-hardware-metrics',
    async () => await liveService.hardware.sampleMetrics(),
  );

  // Autonomous Workflow Handlers
  handleHud('workflow:create-task', (_, goal: string, steps?: any) =>
    liveService.workflow.createTask(goal, steps),
  );
  handleHud(
    'workflow:start-task',
    async (_, taskId?: string) => await liveService.workflow.startTask(taskId),
  );
  handleHud('workflow:pause-task', (_, taskId: string) =>
    liveService.workflow.pauseTask(taskId),
  );
  handleHud('workflow:pause-current', () => liveService.workflow.pauseCurrentTask());
  handleHud(
    'workflow:resume-task',
    async (_, taskId: string) => await liveService.workflow.resumeTask(taskId),
  );
  handleHud(
    'workflow:resume-current',
    async () => await liveService.workflow.resumeCurrentTask(),
  );
  handleHud('workflow:cancel-task', (_, taskId: string) =>
    liveService.workflow.cancelTask(taskId),
  );
  handleHud(
    'workflow:emergency-stop',
    async (_, reason?: string) => await liveService.emergencyStop(reason),
  );
  handleHud(
    'workflow:approve-step',
    async (_, taskId: string, stepId: string) =>
      await liveService.workflow.approveStep(taskId, stepId),
  );
  handleHud(
    'workflow:reject-step',
    async (_, taskId: string, stepId: string, reason?: string) =>
      await liveService.workflow.rejectStep(taskId, stepId, reason),
  );
  handleHud('workflow:get-current-task', () => liveService.workflow.getCurrentTask());
  handleHud('workflow:list-checkpoints', () => liveService.workflow.listCheckpoints());
  handleHud(
    'workflow:resume-checkpoint',
    async (_, taskId: string) => await liveService.workflow.resumeCheckpoint(taskId),
  );
  handleHud(
    'workflow:discard-checkpoint',
    async (_, taskId: string) => await liveService.workflow.discardCheckpoint(taskId),
  );
  // Persistent Memory Handlers
  handleHud('memory:get-preferences', () => liveService.memory.getPreferences());
  handleHud('memory:update-preferences', (_, partial) =>
    liveService.memory.updatePreferences(partial),
  );
  handleHud('memory:get-alias', (_, name: string) => liveService.memory.getAlias(name));
  handleHud('memory:set-alias', (_, name: string, targetApp: string, args?: string[]) =>
    liveService.memory.setAlias(name, targetApp, args),
  );
  handleHud('memory:list-aliases', () => liveService.memory.listAliases());
  handleHud('memory:get-recipes', () => liveService.memory.getTaskRecipes());
  handleHud('memory:get-recent-context', (_, limit?: number) =>
    liveService.memory.getRecentContext(limit),
  );

  // Autonomous Execution Dossier & Session Export to Markdown & HTML
  handleHud('session:export', async (_, payload: SessionExportPayload) => {
    return exportAuditSession(payload);
  });

  // OS Native Clipboard Handlers
  handleHud('clipboard:read-text', () => liveService.clipboardService.readText());
  handleHud('clipboard:write-text', (_, text: string) =>
    liveService.clipboardService.writeText(text),
  );
  handleHud('clipboard:has-text', () => liveService.clipboardService.hasText());
  handleHud('clipboard:read-html', () => liveService.clipboardService.readHtml());
  handleHud('clipboard:write-html', (_, html: string) =>
    liveService.clipboardService.writeHtml(html),
  );
  handleHud('clipboard:clear', () => liveService.clipboardService.clear());

  app.on('window-all-closed', () => {
    logLine(
      'hud-startup',
      `app window-all-closed fired (minimizeToTray: ${liveService?.currentSettings?.minimizeToTray})`,
    );
    if (!isQuitting && trayReady && liveService?.currentSettings?.minimizeToTray) {
      return;
    }
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* ignore */
    }
    cleanupSupervisedProcesses();
    trayManager?.destroy();
    controlServer?.stop?.();
    cdpClient?.stopTracking?.();
    liveService?.disconnect?.();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
