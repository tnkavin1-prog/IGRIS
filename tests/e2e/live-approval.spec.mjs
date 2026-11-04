/**
 * Offline Live + approval end-to-end test.
 *
 * No Google traffic and no real bridge: a loopback HTTP server mints fake
 * ephemeral tokens, and Playwright's WebSocket router plays the Live server.
 * That lets us drive the real side panel, real content script, real executor,
 * and real approval UI through the exact protocol path used in production.
 */
import { test, expect, chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
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

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>GBL Live Fixture</title></head>
  <body>
    <h1>Approval fixture</h1>
    <button id="continue" type="button" onclick="window.__clicked = true">Show details</button>
    <form action="/submit" method="post" onsubmit="event.preventDefault(); window.__submitted = true;">
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" autocomplete="email" />
      <button type="submit">Send request</button>
    </form>
  </body>
</html>`;

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(body));
}

let context;
let panel;
let bridgeServer;
let bridgeUrl;
let fixturePage;
let fixtureTabId;
let live;

function recordLiveMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  live.messages.push(message);
  if (message.setup) {
    live.setup = message.setup;
    live.socket?.send(JSON.stringify({ setupComplete: {} }));
  }
  for (const waiter of [...live.waiters]) waiter(message);
}

function sendToolCall(calls) {
  if (!live.socket) throw new Error('The mocked Live socket is not connected.');
  live.socket.send(JSON.stringify({ toolCall: { functionCalls: calls } }));
}

async function waitForToolResponse(callId) {
  await expect
    .poll(
      () =>
        live.messages.find((message) =>
          message.toolResponse?.functionResponses?.some((item) => item.id === callId),
        ),
      { timeout: 30_000 },
    )
    .toBeTruthy();
  const message = live.messages.find((entry) =>
    entry.toolResponse?.functionResponses?.some((item) => item.id === callId),
  );
  return message.toolResponse.functionResponses.find((item) => item.id === callId);
}

test.beforeAll(async () => {
  const contentServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE);
  });
  await new Promise((done) => contentServer.listen(0, '127.0.0.1', done));
  const contentAddress = contentServer.address();
  const contentUrl = `http://127.0.0.1:${contentAddress.port}/`;

  bridgeServer = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      response.end();
      return;
    }
    if (request.url === '/api/health') {
      json(response, 200, {
        ok: true,
        service: 'gbl-test-bridge',
        version: 'test',
        configured: true,
        keyConfigured: true,
        secretConfigured: true,
        originsConfigured: true,
        allowedModels: ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking'],
        serverTime: new Date().toISOString(),
      });
      return;
    }
    if (request.url === '/api/token' && request.method === 'POST') {
      json(response, 200, {
        token: 'auth_tokens/test-ephemeral-token',
        model: 'gemini-3.8-live',
        newSessionExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        singleUse: true,
      });
      return;
    }
    json(response, 404, { error: 'not found', code: 'invalid_request' });
  });
  await new Promise((done) => bridgeServer.listen(0, '127.0.0.1', done));
  bridgeUrl = `http://127.0.0.1:${bridgeServer.address().port}`;

  live = { socket: null, setup: null, messages: [], waiters: [] };

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gbl-live-e2e-')), {
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

  await context.routeWebSocket(/generativelanguage\.googleapis\.com/, (socket) => {
    live.socket = socket;
    socket.onMessage((raw) => recordLiveMessage(raw));
    socket.onClose(() => {
      if (live.socket === socket) live.socket = null;
    });
  });

  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(
    async ({ bridgeUrl: url, secret }) => {
      await chrome.storage.local.set({
        'gbl.settings.v1': {
          bridgeUrl: url,
          browserControl: true,
          confirmRisky: true,
          includeContextOnStart: false,
          audioCues: false,
          autoReconnect: false,
        },
        'gbl.bridgeSecret.v1': secret,
        'gbl.onboarding.v1': { seen: true },
      });
    },
    { bridgeUrl, secret: 'test-gate-secret' },
  );
  await panel.reload();
  await expect(panel.getByRole('button', { name: 'Start live', exact: true })).toBeVisible();

  fixturePage = await context.newPage();
  await fixturePage.goto(contentUrl);
  await expect(fixturePage).toHaveTitle('GBL Live Fixture');
  fixtureTabId = await panel.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url?.startsWith(url));
    return tab?.id ?? -1;
  }, contentUrl);
  expect(fixtureTabId).toBeGreaterThan(0);

  await startLiveSession();
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((done) => bridgeServer?.close(done));
});

async function startLiveSession() {
  if (await panel.locator('.onboarding-card').count()) {
    await panel.getByRole('button', { name: 'Skip' }).click();
  }
  await panel.getByRole('button', { name: 'Start live', exact: true }).click();
  await expect.poll(() => Boolean(live.setup), { timeout: 30_000 }).toBe(true);
  await expect(panel.getByText('Listening', { exact: true }).first()).toBeVisible();
}

async function activateFixtureTab() {
  await panel.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureTabId);
}

test('mints a token and completes a real Live setup handshake offline', async () => {
  expect(live.setup.model).toBe('models/gemini-3.8-live');
  expect(live.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
  expect(live.setup.tools?.[0]?.functionDeclarations?.length).toBeGreaterThan(10);
  expect(live.setup.sessionResumption).toBeDefined();
  expect(live.messages.some((message) => message.realtimeInput)).toBe(true);
});

test('gates a submit-like click behind approval, then acts on the approved tab', async () => {
  await activateFixtureTab();
  await fixturePage.evaluate(() => {
    window.__submitted = false;
  });

  sendToolCall([{ id: 'call-approve', name: 'click_element', args: { text: 'Send request' } }]);

  const dialog = panel.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator('#approval-title')).toHaveText('Click');
  await expect(dialog.locator('.risk-badge')).toHaveText('Submit form');
  await expect(dialog).toContainText('Send request');

  // Switch away after approval was prepared: execution must still target the
  // tab the user saw, not whatever is active when they click Allow.
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Allow once' }).click();

  await expect.poll(() => fixturePage.evaluate(() => window.__submitted)).toBe(true);
  const response = await waitForToolResponse('call-approve');
  expect(response.response.result.ok).toBe(true);
  expect(response.response.error).toBeUndefined();
});

test('a denied action sends USER_DENIED and causes no side effect', async () => {
  await activateFixtureTab();
  await fixturePage.evaluate(() => {
    window.__submitted = false;
  });

  sendToolCall([{ id: 'call-deny', name: 'click_element', args: { text: 'Send request' } }]);
  const dialog = panel.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await panel.getByRole('button', { name: 'Deny' }).click();

  const response = await waitForToolResponse('call-deny');
  expect(response.response.error.code).toBe('USER_DENIED');
  expect(await fixturePage.evaluate(() => window.__submitted)).toBe(false);
});

test('a benign click runs without an approval prompt', async () => {
  await activateFixtureTab();
  await fixturePage.evaluate(() => {
    window.__clicked = false;
  });

  sendToolCall([{ id: 'call-benign', name: 'click_element', args: { text: 'Show details' } }]);

  const response = await waitForToolResponse('call-benign');
  expect(response.response.result.ok).toBe(true);
  await expect.poll(() => fixturePage.evaluate(() => window.__clicked)).toBe(true);
  expect(panel.getByRole('dialog')).toHaveCount(0);
});
