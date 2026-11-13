import { app, ipcMain, globalShortcut, shell } from 'electron';
import { join } from 'node:path';
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { CDPClient } from './cdp-client.js';
import { DATA_ROOT, ICON_PATH, LOGS_DIR, NOTES_DIR, TEMP_DIR } from './runtime-paths.js';
import { WakeWordService } from './wake-word.js';
import { startAutoUpdates } from './auto-update.js';

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
  getMainWindow,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  toggleAlwaysOnTop,
  setDisplayMode,
  getDisplayMode,
} from './window.js';
import type {
  FindTextOptions,
  SessionExportPayload,
  TileWindowsOptions,
  WindowTilingLayout,
} from './types.js';
import { screenGrounding } from './screen-grounding.js';

// Electron keeps its own caches, cookies and local storage under the
// userData directory. Both it and the temporary directory must follow the
// configured data root, otherwise a development run writes Chromium caches
// and the updater staging area to the system drive.
{
  const electronDir = join(DATA_ROOT, 'electron');
  try {
    mkdirSync(electronDir, { recursive: true });
    app.setPath('userData', electronDir);
    app.setPath('temp', TEMP_DIR);
  } catch {
    /* read-only media: Electron falls back to its own defaults */
  }
}

// Register custom Windows URI protocol (e.g. gematron://summon)
for (const protocol of ['gematron', 'gemetron']) {
  if (process.defaultApp) {
    if (process.argv.length >= 2 && process.argv[1]) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient(protocol);
  }
}

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

  app.whenReady().then(async () => {
    try {
      logLine('hud-startup', 'app.whenReady started');
      liveService = new GeminiLiveService(cdpClient);
      logLine('hud-startup', 'GeminiLiveService created');
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
            if (liveService.currentSettings.minimizeToTray) {
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
      trayManager.init();

      // Minimize-to-tray window event hooks
      win.on('close', (e) => {
        if (!isQuitting && liveService.currentSettings.minimizeToTray) {
          // End the Gemini Live session before hiding: a hidden HUD must not
          // keep listening to the microphone or speaking replies from the tray.
          try {
            liveService.disconnect();
          } catch {}
          e.preventDefault();
          win.hide();
        }
      });

      win.on('minimize', () => {
        if (liveService.currentSettings.minimizeToTray) {
          win.hide();
        }
      });

      // Start background tracking of Chrome tabs
      cdpClient.startTracking(1500);

      // Start in-Chrome loopback summon server (http://127.0.0.1:9228/summon)
      const controlPort = Number(process.env.GEMATRON_CONTROL_PORT ?? 9228);
      const controlBound = await controlServer.start(() => getMainWindow(), cdpClient);
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

  // Setup IPC Handlers
  ipcMain.handle('window:minimize', () => minimizeWindow());
  ipcMain.handle('window:toggle-maximize', () => toggleMaximize());
  ipcMain.handle('window:is-maximized', () => getMainWindow()?.isMaximized() ?? false);
  ipcMain.handle('window:close', () => closeWindow());
  ipcMain.handle('window:toggle-pin', () => toggleAlwaysOnTop());
  ipcMain.handle('window:is-pinned', () => getMainWindow()?.isAlwaysOnTop() ?? true);
  ipcMain.handle('window:set-display-mode', (_, mode: string) =>
    setDisplayMode(mode as 'orb' | 'bar' | 'full' | 'console'),
  );
  ipcMain.handle('window:get-display-mode', () => getDisplayMode());

  // Read-only CDP queries never launch Chrome. Mutations that create or navigate
  // tabs use the same attach-first gateway as voice commands.
  ipcMain.handle('cdp:get-status', async () => await cdpClient.getStatus());
  ipcMain.handle('cdp:list-tabs', async () => await cdpClient.listTabs());
  ipcMain.handle('cdp:get-active-tab', async () => await cdpClient.getActiveTab());
  ipcMain.handle('cdp:switch-tab', async (_, tabId: string) => {
    const ok = await cdpClient.switchTab(tabId);
    getMainWindow()?.focus();
    return ok;
  });
  ipcMain.handle('cdp:create-tab', async (_, url?: string) => {
    const result = await liveService.browser.openTab(url);
    getMainWindow()?.focus();
    return result;
  });
  ipcMain.handle('cdp:close-tab', async (_, tabId: string) => {
    return await cdpClient.closeTab(tabId);
  });
  ipcMain.handle('cdp:capture-screenshot', async (_, tabId?: string) => {
    return await cdpClient.captureScreenshot(tabId);
  });
  ipcMain.handle('cdp:navigate', async (_, url: string, tabId?: string) => {
    const result = await liveService.browser.navigate(url, tabId);
    getMainWindow()?.focus();
    return { ok: result.success, url: result.url, error: result.error };
  });
  ipcMain.handle('cdp:open-youtube', async (_, query?: string) => {
    const url = query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      : 'https://www.youtube.com';
    const result = await liveService.browser.openTab(url);
    getMainWindow()?.focus();
    return result;
  });
  ipcMain.handle('cdp:launch-chrome', async (_, url?: string) => {
    const result = url
      ? await liveService.browser.openTab(url)
      : await liveService.browser.focusOrLaunch();
    return {
      ok: result.success,
      message: result.message ?? result.error ?? 'Chrome command completed.',
    };
  });
  ipcMain.handle('cdp:duplicate-tab', async (_, tabId?: string) => {
    const tab = await cdpClient.duplicateTab(tabId);
    getMainWindow()?.focus();
    return tab;
  });
  ipcMain.handle('cdp:reload-tab', async (_, tabId?: string, ignoreCache?: boolean) => {
    return await cdpClient.reloadTab(tabId, ignoreCache);
  });
  ipcMain.handle(
    'cdp:search-tab-content',
    async (_, query: string, options?: { caseSensitive?: boolean }) => {
      return await cdpClient.searchTabContent(query, options);
    },
  );
  ipcMain.handle('cdp:close-duplicate-tabs', async () => {
    return await cdpClient.closeDuplicateTabs();
  });

  // Gemini Live IPC Handlers
  ipcMain.handle('gemini:connect', async () => {
    await wakeWord.setPaused(true);
    const connected = await liveService.connect();
    if (!connected) await wakeWord.setPaused(false);
    return connected;
  });
  ipcMain.handle('gemini:disconnect', () => liveService.disconnect());
  ipcMain.handle('gemini:send-text', (_, text: string) => liveService.sendText(text));
  ipcMain.handle('gemini:send-audio-chunk', (_, base64: string) =>
    liveService.sendAudioChunk(base64),
  );
  ipcMain.handle('gemini:send-frame', (_, base64: string) => liveService.sendImageFrame(base64));
  ipcMain.handle('gemini:get-settings', () => liveService.currentSettings);
  ipcMain.handle('gemini:update-settings', (_, settings) => liveService.updateSettings(settings));

  // OS Computer Vision & Input Handlers
  ipcMain.handle(
    'computer:capture-screen',
    async (_, sourceId?: string) => await liveService.vision.captureScreen(sourceId),
  );
  ipcMain.handle(
    'computer:capture-window',
    async (_, windowTitle: string) => await liveService.vision.captureWindow(windowTitle),
  );
  ipcMain.handle('computer:list-sources', async () => await liveService.vision.listSources());
  ipcMain.handle('computer:get-display-metrics', () => liveService.vision.getDisplayMetrics());
  ipcMain.handle(
    'computer:find-text-on-screen',
    async (_, text: string, options?: FindTextOptions) =>
      await liveService.vision.findTextOnScreen(text, options),
  );

  ipcMain.handle(
    'computer:mouse-move',
    async (_, x: number, y: number) => await liveService.input.mouseMove(x, y),
  );
  ipcMain.handle(
    'computer:mouse-click',
    async (
      _,
      x: number,
      y: number,
      options?: { button?: 'left' | 'right' | 'middle'; double?: boolean },
    ) => await liveService.input.mouseClick(x, y, options),
  );
  ipcMain.handle(
    'computer:mouse-drag',
    async (_, startX: number, startY: number, endX: number, endY: number, steps?: number) =>
      await liveService.input.mouseDrag(startX, startY, endX, endY, steps),
  );
  ipcMain.handle(
    'computer:mouse-scroll',
    async (_, deltaY: number) => await liveService.input.mouseScroll(deltaY),
  );
  ipcMain.handle('computer:get-cursor', async () => await liveService.input.getCursorPosition());
  ipcMain.handle(
    'computer:type-text',
    async (_, text: string) => await liveService.input.typeText(text),
  );
  ipcMain.handle(
    'computer:send-hotkey',
    async (_, keys: string | string[]) => await liveService.input.sendHotkey(keys),
  );

  // Application Lifecycle & Windows Management Handlers
  ipcMain.handle('apps:list-windows', async () => await liveService.apps.listRunningWindows());
  ipcMain.handle(
    'apps:launch',
    async (_, appName: string, args?: string[]) =>
      await liveService.apps.launchApplication(appName, args),
  );
  ipcMain.handle(
    'apps:focus-window',
    async (_, query: string | number) => await liveService.apps.focusWindow(query),
  );
  ipcMain.handle(
    'apps:minimize-window',
    async (_, query: string | number) => await liveService.apps.minimizeWindow(query),
  );
  ipcMain.handle(
    'apps:maximize-window',
    async (_, query: string | number) => await liveService.apps.maximizeWindow(query),
  );
  ipcMain.handle(
    'apps:close-window',
    async (_, query: string | number) => await liveService.apps.closeWindow(query),
  );
  ipcMain.handle(
    'apps:run-command',
    async (_, command: string, options?: { timeoutMs?: number; requiresApproval?: boolean }) =>
      await liveService.apps.runSystemCommand(command, options),
  );
  ipcMain.handle(
    'apps:tile-windows',
    async (_, layout: WindowTilingLayout, options?: TileWindowsOptions) =>
      await liveService.apps.tileWindows(layout, options),
  );
  ipcMain.handle(
    'telemetry:get-hardware-metrics',
    async () => await liveService.hardware.sampleMetrics(),
  );

  // Autonomous Workflow Handlers
  ipcMain.handle('workflow:create-task', (_, goal: string, steps?: any) =>
    liveService.workflow.createTask(goal, steps),
  );
  ipcMain.handle(
    'workflow:start-task',
    async (_, taskId?: string) => await liveService.workflow.startTask(taskId),
  );
  ipcMain.handle('workflow:pause-task', (_, taskId: string) =>
    liveService.workflow.pauseTask(taskId),
  );
  ipcMain.handle('workflow:pause-current', () => liveService.workflow.pauseCurrentTask());
  ipcMain.handle(
    'workflow:resume-task',
    async (_, taskId: string) => await liveService.workflow.resumeTask(taskId),
  );
  ipcMain.handle(
    'workflow:resume-current',
    async () => await liveService.workflow.resumeCurrentTask(),
  );
  ipcMain.handle('workflow:cancel-task', (_, taskId: string) =>
    liveService.workflow.cancelTask(taskId),
  );
  ipcMain.handle(
    'workflow:emergency-stop',
    async (_, reason?: string) => await liveService.emergencyStop(reason),
  );
  ipcMain.handle(
    'workflow:approve-step',
    async (_, taskId: string, stepId: string) =>
      await liveService.workflow.approveStep(taskId, stepId),
  );
  ipcMain.handle(
    'workflow:reject-step',
    async (_, taskId: string, stepId: string, reason?: string) =>
      await liveService.workflow.rejectStep(taskId, stepId, reason),
  );
  ipcMain.handle('workflow:get-current-task', () => liveService.workflow.getCurrentTask());

  // Persistent Memory Handlers
  ipcMain.handle('memory:get-preferences', () => liveService.memory.getPreferences());
  ipcMain.handle('memory:update-preferences', (_, partial) =>
    liveService.memory.updatePreferences(partial),
  );
  ipcMain.handle('memory:get-alias', (_, name: string) => liveService.memory.getAlias(name));
  ipcMain.handle('memory:set-alias', (_, name: string, targetApp: string, args?: string[]) =>
    liveService.memory.setAlias(name, targetApp, args),
  );
  ipcMain.handle('memory:list-aliases', () => liveService.memory.listAliases());
  ipcMain.handle('memory:get-recipes', () => liveService.memory.getTaskRecipes());
  ipcMain.handle('memory:get-recent-context', (_, limit?: number) =>
    liveService.memory.getRecentContext(limit),
  );

  // Autonomous Execution Dossier & Session Export to Markdown & HTML
  ipcMain.handle('session:export', async (_, payload: SessionExportPayload) => {
    return exportAuditSession(payload);
  });

  // OS Native Clipboard Handlers
  ipcMain.handle('clipboard:read-text', () => liveService.clipboardService.readText());
  ipcMain.handle('clipboard:write-text', (_, text: string) =>
    liveService.clipboardService.writeText(text),
  );
  ipcMain.handle('clipboard:has-text', () => liveService.clipboardService.hasText());
  ipcMain.handle('clipboard:read-html', () => liveService.clipboardService.readHtml());
  ipcMain.handle('clipboard:write-html', (_, html: string) =>
    liveService.clipboardService.writeHtml(html),
  );
  ipcMain.handle('clipboard:clear', () => liveService.clipboardService.clear());

  app.on('window-all-closed', () => {
    logLine(
      'hud-startup',
      `app window-all-closed fired (minimizeToTray: ${liveService?.currentSettings?.minimizeToTray})`,
    );
    if (!isQuitting && liveService?.currentSettings?.minimizeToTray) {
      return;
    }
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* ignore */
    }
    trayManager?.destroy();
    controlServer?.stop?.();
    cdpClient?.stopTracking?.();
    liveService?.disconnect?.();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
