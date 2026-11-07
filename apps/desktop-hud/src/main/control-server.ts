import { createServer, type Server } from 'node:http';
import type { BrowserWindow } from 'electron';
import type { CDPClient } from './cdp-client.js';

export class ControlServer {
  private server: Server | null = null;

  constructor(
    public readonly port = 9228,
    public readonly host = '127.0.0.1',
  ) {}

  public start(getWindow: () => BrowserWindow | null, cdpClient: CDPClient): Promise<void> {
    return new Promise((resolve) => {
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

        if (url.pathname === '/status') {
          const status = await cdpClient.getStatus();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.on('error', (err) => {
        console.warn(`[ControlServer] Failed to bind on port ${this.port}:`, err.message);
        resolve();
      });

      this.server.listen(this.port, this.host, () => {
        console.log(
          `[ControlServer] In-Chrome summon endpoint active at http://${this.host}:${this.port}/summon`,
        );
        resolve();
      });
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
