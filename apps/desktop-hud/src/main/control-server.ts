import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { CDPClient } from './cdp-client.js';
import { SCRIPTS_DIR, REPO_ROOT } from './runtime-paths.js';

export interface ControlServerOptions {
  onKimiDispatch?: (payload: {
    prompt?: string;
    files?: string[];
    dryRun?: boolean;
    maxChars?: number;
  }) => Promise<{
    ok: boolean;
    durationMs: number;
    filesModified: string[];
    backupPath?: string | null;
    manifest?: any;
    dryRun?: boolean;
    [key: string]: any;
  }>;
  onKimiStatus?: () => Promise<{
    ok: boolean;
    cdpConnected: boolean;
    arenaTabOpen: boolean;
    tab?: any;
    [key: string]: any;
  }>;
}

export class ControlServer {
  private server: Server | null = null;

  constructor(
    public readonly port = 9228,
    public readonly host = '127.0.0.1',
    private readonly options: ControlServerOptions = {},
  ) {}

  public start(getWindow: () => BrowserWindow | null, cdpClient: CDPClient): Promise<void> {
    return new Promise((resolve) => {
      const createAndListen = (retriesLeft = 10) => {
        this.server = createServer(async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);

          // --- In-Chrome summon / focus endpoints ---
          if (url.pathname === '/summon' || url.pathname === '/focus') {
            let prompt: string | undefined = url.searchParams.get('prompt') || undefined;
            if (req.method === 'POST') {
              try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) {
                  chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                }
                const bodyStr = Buffer.concat(chunks).toString('utf-8');
                if (bodyStr) {
                  const parsed = JSON.parse(bodyStr);
                  if (typeof parsed?.prompt === 'string') {
                    prompt = parsed.prompt;
                  }
                }
              } catch {
                /* ignore parse errors */
              }
            }

            const win = getWindow();
            if (win && (!win.isDestroyed || !win.isDestroyed())) {
              if (typeof win.isMinimized === 'function' && win.isMinimized()) {
                win.restore?.();
              }
              win.show?.();
              win.focus?.();
              if (typeof win.moveTop === 'function') {
                win.moveTop();
              }
              win.setAlwaysOnTop?.(true, 'screen-saver');
              if (
                prompt &&
                win.webContents &&
                (!win.webContents.isDestroyed || !win.webContents.isDestroyed())
              ) {
                win.webContents.send?.('ask-gemini:prompt', { prompt });
              }
            }

            let activeTab = null;
            try {
              activeTab = await cdpClient?.getActiveTab?.();
            } catch {
              /* ignore CDP connection errors when retrieving active tab */
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                activeTab,
                ...(prompt !== undefined ? { prompt } : {}),
              }),
            );
            return;
          }

          // --- General HUD status endpoint ---
          if (url.pathname === '/status') {
            const status = await cdpClient.getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, status }));
            return;
          }

          // --- Kimi K3 Arena Bridge Status endpoint ---
          if (url.pathname === '/kimi/status') {
            if (this.options.onKimiStatus) {
              try {
                const customStatus = await this.options.onKimiStatus();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(customStatus));
                return;
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
                return;
              }
            }

            let cdpConnected = false;
            let arenaTabOpen = false;
            let tab: any = null;

            try {
              let tabs: any[] | null = null;
              if (typeof cdpClient?.listTabs === 'function') {
                tabs = await cdpClient.listTabs().catch(() => null);
              }

              if (!Array.isArray(tabs)) {
                const resHttp = await fetch(`http://${this.host}:9222/json`, {
                  signal: AbortSignal.timeout(2000),
                }).catch(() => null);
                if (resHttp && resHttp.ok) {
                  tabs = (await resHttp.json().catch(() => null)) as any[];
                }
              }

              if (Array.isArray(tabs)) {
                cdpConnected = true;
                const found = tabs.find(
                  (t: any) =>
                    t.url &&
                    (t.url.includes('arena.ai') ||
                      t.url.includes('01a1c009-84f1-7542-be3f-6d258f0bb652')),
                );
                if (found) {
                  arenaTabOpen = true;
                  tab = {
                    id: String(found.id || ''),
                    title: String(found.title || ''),
                    url: String(found.url || ''),
                  };
                }
              } else {
                // Check if CDP version responds
                const vRes = await fetch(`http://${this.host}:9222/json/version`, {
                  signal: AbortSignal.timeout(1500),
                }).catch(() => null);
                if (vRes && vRes.ok) {
                  cdpConnected = true;
                }
              }
            } catch {
              cdpConnected = false;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                cdpConnected,
                arenaTabOpen,
                tab,
              }),
            );
            return;
          }

          // --- Kimi K3 Arena Autonomous Dispatch endpoint ---
          if (url.pathname === '/kimi/dispatch' && req.method === 'POST') {
            let body: any = {};
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              }
              const bodyStr = Buffer.concat(chunks).toString('utf-8');
              if (bodyStr.trim()) {
                body = JSON.parse(bodyStr);
              }
            } catch {
              /* ignore parse errors */
            }

            const prompt = body.prompt || url.searchParams.get('prompt') || '';
            const files = Array.isArray(body.files) ? body.files : [];
            const dryRun = Boolean(body.dryRun);
            const maxChars = typeof body.maxChars === 'number' ? body.maxChars : undefined;

            if (!prompt) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ok: false,
                  error: 'A prompt string is required in request body.',
                }),
              );
              return;
            }

            if (this.options.onKimiDispatch) {
              try {
                const customResult = await this.options.onKimiDispatch({
                  prompt,
                  files,
                  dryRun,
                  maxChars,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(customResult));
                return;
              } catch (err: any) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
                return;
              }
            }

            try {
              const { pathToFileURL } = await import('node:url');
              const path = await import('node:path');
              const scriptPath = path.resolve(join(SCRIPTS_DIR, 'kimi-bridge.mjs'));
              const bridgeUrl = pathToFileURL(scriptPath).href;
              const bridge = await import(bridgeUrl);

              const result = await bridge.runAutonomousLoop({
                prompt,
                files,
                dryRun,
                maxChars,
                projectRoot: REPO_ROOT,
              });

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ok: true,
                  durationMs: result.durationMs,
                  filesModified: result.filesModified,
                  backupPath: result.backupPath,
                  manifest: result.manifest,
                  dryRun: result.dryRun,
                }),
              );
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  ok: false,
                  error: err?.message || String(err),
                }),
              );
            }
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        });

        this.server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
            setTimeout(() => {
              createAndListen(retriesLeft - 1);
            }, 60);
            return;
          }
          console.warn(`[ControlServer] Failed to bind on port ${this.port}:`, err.message);
          resolve();
        });

        this.server.listen(this.port, this.host, () => {
          console.log(
            `[ControlServer] In-Chrome summon endpoint active at http://${this.host}:${this.port}/summon`,
          );
          resolve();
        });
      };

      createAndListen();
    });
  }

  public stop(): void {
    if (this.server) {
      try {
        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }
        this.server.close();
      } catch {}
      this.server = null;
    }
  }
}
