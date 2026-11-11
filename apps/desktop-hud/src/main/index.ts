import { app, ipcMain, globalShortcut, shell } from 'electron';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { CDPClient } from './cdp-client.js';
import { LOGS_DIR, NOTES_DIR } from './runtime-paths.js';

function logLine(file: 'hud-startup' | 'electron-error', msg: string): void {
  try {
    appendFileSync(join(LOGS_DIR, `${file}.log`), `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
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

  app.on('before-quit', () => {
    logLine('hud-startup', `app before-quit fired (isQuitting: ${isQuitting})`);
    isQuitting = true;
    trayManager?.destroy();
  });

  app.on('will-quit', () => {
    logLine('hud-startup', 'app will-quit fired');
  });

  app.on('quit', (_, exitCode) => {
    logLine('hud-startup', `app quit fired (exitCode: ${exitCode})`);
  });

  const cdpClient = new CDPClient(9222, '127.0.0.1');
  let liveService: GeminiLiveService;
  let controlServer: ControlServer;

  app.whenReady().then(async () => {
    try {
      logLine('hud-startup', 'app.whenReady started');
      liveService = new GeminiLiveService(cdpClient);
      logLine('hud-startup', 'GeminiLiveService created');
      controlServer = new ControlServer(9228, '127.0.0.1');
      logLine('hud-startup', 'ControlServer created');

      const preloadPath = join(__dirname, 'preload.cjs');
      const htmlPath = join(__dirname, 'index.html');

      const win = createMainWindow(preloadPath, htmlPath);
      logLine('hud-startup', 'MainWindow created');
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
        iconPath: join(__dirname, '../../../../assets/icons/jarvis.ico'),
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
      await controlServer.start(() => getMainWindow(), cdpClient);
      logLine('hud-startup', 'ControlServer started on port 9228');

      // Do not open Chrome when the HUD starts: only the Gematron HUD should appear.
      // Chrome can be launched explicitly from the HUD ("Open Chrome").
      // Set GEMATRON_AUTOLAUNCH_CHROME=1 to opt back into the old auto-launch behaviour.
      if (process.env.GEMATRON_AUTOLAUNCH_CHROME === '1') {
        const isChromeActive = await ChromeLauncher.isPortAvailable();
        if (!isChromeActive) {
          console.log(
            '[ChromeLauncher] Chrome remote debugging port 9222 not detected. Spawning Chrome...',
          );
          void ChromeLauncher.launch();
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

  // CDP IPC Handlers (Retain HUD focus on browser operations)
  /**
   * Ensures Chrome is running with remote debugging before executing a CDP action.
   * If Chrome is not available, launches it automatically and waits for the port.
   */
  async function ensureChrome(url?: string): Promise<{ ok: boolean; message?: string }> {
    const isActive = await ChromeLauncher.isPortAvailable();
    if (isActive) return { ok: true };

    const launched = await ChromeLauncher.launch(url);
    if (!launched.ok) {
      return { ok: false, message: launched.message || 'Failed to launch Chrome.' };
    }

    // Wait up to 8 seconds for Chrome's remote debugging port to respond
    for (let i = 0; i < 16; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (await ChromeLauncher.isPortAvailable()) {
        return { ok: true };
      }
    }
    return { ok: false, message: 'Chrome launched but remote debugging port did not respond.' };
  }

  ipcMain.handle('cdp:get-status', async () => {
    const status = await cdpClient.getStatus();
    if (!status.connected) {
      const launched = await ensureChrome();
      if (launched.ok) {
        return await cdpClient.getStatus();
      }
      return {
        connected: false,
        port: 9222,
        activeTab: null,
        tabs: [],
        error: launched.message || 'Chrome remote debugging is not available.',
      };
    }
    return status;
  });
  ipcMain.handle('cdp:list-tabs', async () => {
    const tabs = await cdpClient.listTabs();
    if (tabs.length === 0) {
      const launched = await ensureChrome();
      if (launched.ok) {
        return await cdpClient.listTabs();
      }
    }
    return tabs;
  });
  ipcMain.handle('cdp:get-active-tab', async () => {
    const tab = await cdpClient.getActiveTab();
    if (!tab) {
      const launched = await ensureChrome();
      if (launched.ok) {
        return await cdpClient.getActiveTab();
      }
    }
    return tab;
  });
  ipcMain.handle('cdp:switch-tab', async (_, tabId: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) return false;
    const ok = await cdpClient.switchTab(tabId);
    getMainWindow()?.focus();
    return ok;
  });
  ipcMain.handle('cdp:create-tab', async (_, url: string) => {
    const launched = await ensureChrome(url);
    if (!launched.ok) return null;
    const tab = await cdpClient.createTab(url);
    getMainWindow()?.focus();
    return tab;
  });
  ipcMain.handle('cdp:close-tab', async (_, tabId: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) return false;
    return await cdpClient.closeTab(tabId);
  });
  ipcMain.handle('cdp:capture-screenshot', async (_, tabId?: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) throw new Error(launched.message || 'Chrome is not available.');
    return await cdpClient.captureScreenshot(tabId);
  });
  ipcMain.handle('cdp:navigate', async (_, url: string, tabId?: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) throw new Error(launched.message || 'Chrome is not available.');
    const res = await cdpClient.navigate(url, tabId);
    getMainWindow()?.focus();
    return res;
  });
  ipcMain.handle('cdp:open-youtube', async (_, query?: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) return null;
    const tab = await cdpClient.openYouTube(query);
    getMainWindow()?.focus();
    return tab;
  });
  ipcMain.handle('cdp:launch-chrome', async (_, url?: string) => await ChromeLauncher.launch(url));
  ipcMain.handle('cdp:duplicate-tab', async (_, tabId?: string) => {
    const launched = await ensureChrome();
    if (!launched.ok) return null;
    const tab = await cdpClient.duplicateTab(tabId);
    getMainWindow()?.focus();
    return tab;
  });
  ipcMain.handle('cdp:reload-tab', async (_, tabId?: string, ignoreCache?: boolean) => {
    const launched = await ensureChrome();
    if (!launched.ok) return false;
    return await cdpClient.reloadTab(tabId, ignoreCache);
  });
  ipcMain.handle(
    'cdp:search-tab-content',
    async (_, query: string, options?: { caseSensitive?: boolean }) => {
      const launched = await ensureChrome();
      if (!launched.ok) {
        return { query, totalTabs: 0, matchedTabs: [] };
      }
      return await cdpClient.searchTabContent(query, options);
    },
  );
  ipcMain.handle('cdp:close-duplicate-tabs', async () => {
    const launched = await ensureChrome();
    if (!launched.ok) {
      return { closedCount: 0, closedTabs: [], remainingCount: 0 };
    }
    return await cdpClient.closeDuplicateTabs();
  });

  // Gemini Live IPC Handlers
  ipcMain.handle('gemini:connect', async () => await liveService.connect());
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
