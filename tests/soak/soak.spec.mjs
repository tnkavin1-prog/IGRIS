import { test, expect, chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionDir = join(root, 'release', 'chrome-extension');
const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));

function extensionIdFromKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let index = 0; index < 16; index += 1) {
    const byte = digest[index];
    id += alphabet[byte >> 4] + alphabet[byte & 0x0f];
  }
  return id;
}

const extensionId = extensionIdFromKey(manifest.key);
const FIXTURE = `<!doctype html><html lang="en"><head><title>Soak Fixture</title></head><body><h1>Soak</h1><button id="b">Show details</button></body></html>`;

let context;
let panel;
let bridgeServer;
let bridgeUrl;
let live;
let fixturePage;
let fixtureTabId;
const secret = 'test-gate-secret';

function encodePcmTone(seconds, sampleRate = 24_000) {
  const samples = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.25 * 32_767);
    buffer.writeInt16LE(value, index * 2);
  }
  return buffer.toString('base64');
}

test.beforeAll(async () => {
  bridgeServer = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      response.end();
      return;
    }
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
      return;
    }
    if (request.url === '/api/config') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          version: '1.0.0',
          allowedModels: ['gemini-3.8-live'],
          tokenTtlMs: 600_000,
          newSessionTtlMs: 300_000,
          rateLimitPerMinute: 1000,
        }),
      );
      return;
    }
    if (request.url === '/api/token' && request.method === 'POST') {
      const auth = request.headers.authorization || '';
      if (auth !== `Bearer ${secret}`) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          token: 'auth_tokens/soak-ephemeral-token',
          expiresAt: Date.now() + 600_000,
          model: 'gemini-3.8-live',
          isNewSession: true,
        }),
      );
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found', code: 'not_found' }));
  });
  await new Promise((done) => bridgeServer.listen(0, '127.0.0.1', done));
  const addr = bridgeServer.address();
  bridgeUrl = `http://127.0.0.1:${addr.port}`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gbl-soak-')), {
    headless: false,
    viewport: { width: 440, height: 940 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  if (await panel.locator('.onboarding-card').count()) {
    await panel.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(panel.locator('.onboarding-card')).toHaveCount(0);

  // Configure bridge + secret.
  await panel.evaluate(
    async ({ bridgeUrl, secret }) => {
      await chrome.storage.local.set({
        'gbl.settings.v1': {
          bridgeUrl,
          secretPresent: true,
          audioCues: false,
        },
        'gbl.bridgeSecret.v1': secret,
        'gbl.onboarding.v1': { seen: true },
      });
    },
    { bridgeUrl, secret },
  );
  await panel.reload();
  await expect(panel.getByRole('button', { name: 'Start live', exact: true })).toBeVisible();

  // Fake Live server via WebSocket routing.
  live = { socket: null, messages: [] };
  await panel.routeWebSocket('wss://generativelanguage.googleapis.com/**', async (ws) => {
    live.socket = ws;
    ws.onMessage((raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      live.messages.push(parsed);
      if (parsed.setup) {
        ws.send(JSON.stringify({ setupComplete: {} }));
      }
    });
  });

  // Fixture page.
  const contentServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((done) => contentServer.listen(0, '127.0.0.1', done));
  const contentUrl = `http://127.0.0.1:${contentServer.address().port}/`;
  fixturePage = await context.newPage();
  await fixturePage.goto(contentUrl);
  fixtureTabId = await panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url?.startsWith(url))?.id ?? -1;
  }, contentUrl);
  expect(fixtureTabId).toBeGreaterThan(0);

  // Start session.
  await panel.getByRole('button', { name: 'Start live', exact: true }).click();
  await expect(panel.getByText('Listening', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((done) => bridgeServer?.close(done));
});

test('stays live and stable across repeated tool calls and audio', async () => {
  const errors = [];
  panel.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const sendToolCall = (calls) => {
    if (!live.socket) throw new Error('no socket');
    live.socket.send(JSON.stringify({ toolCall: { functionCalls: calls } }));
  };

  // Warm up: snapshot.
  sendToolCall([
    { id: 'warmup', name: 'get_page_snapshot', args: { maxTextChars: 1000, maxElements: 20 } },
  ]);
  await expect
    .poll(
      () =>
        live.messages.some((m) =>
          m.toolResponse?.functionResponses?.some((r) => r.id === 'warmup'),
        ),
      {
        timeout: 30_000,
      },
    )
    .toBe(true);

  // SOAK_ROUNDS overrides the round count. One round is roughly 0.6 s, so
  // SOAK_ROUNDS=6000 is about an hour. Default stays small for CI.
  const rounds = Number(process.env.SOAK_ROUNDS ?? 5);
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`SOAK_ROUNDS must be a positive integer, got ${process.env.SOAK_ROUNDS}`);
  }
  for (let round = 0; round < rounds; round += 1) {
    // Audio burst.
    live.socket.send(
      JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { data: encodePcmTone(0.3), mimeType: 'audio/pcm;rate=24000' } }],
          },
          turnComplete: false,
        },
      }),
    );
    await panel.waitForTimeout(200);
    live.socket.send(JSON.stringify({ serverContent: { interrupted: true } }));
    await panel.waitForTimeout(200);

    // Tool call.
    const callId = `soak-${round}`;
    sendToolCall([
      { id: callId, name: 'get_page_snapshot', args: { maxTextChars: 500, maxElements: 10 } },
    ]);
    await expect
      .poll(
        () =>
          live.messages.some((m) =>
            m.toolResponse?.functionResponses?.some((r) => r.id === callId),
          ),
        {
          timeout: 30_000,
        },
      )
      .toBe(true);
  }

  const devtoolsRe = /Download the React DevTools/i;
  const realErrors = errors.filter((e) => !devtoolsRe.test(e));
  expect(realErrors.length).toBe(0);
});
