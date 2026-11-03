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

/** Chrome derives the extension id from the SHA-256 of the DER public key. */
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
  <head><meta charset="utf-8"><title>GBL Fixture</title></head>
  <body>
    <header><h1>Quarterly Report</h1><p>Revenue grew 18% across the quarter.</p></header>
    <main>
      <button id="continue" type="button" onclick="window.__clicked = true">Continue</button>
      <form action="/submit" method="post" onsubmit="event.preventDefault(); window.__submitted = true;">
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" autocomplete="email" />
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes"></textarea>
        <button type="submit">Send request</button>
      </form>
      <a href="/docs/report.pdf">Download report</a>
      <table>
        <caption>Regions</caption>
        <tr><th>Region</th><th>Revenue</th></tr>
        <tr><td>North</td><td>120</td></tr>
        <tr><td>South</td><td>90</td></tr>
      </table>
    </main>
  </body>
</html>`;

let context;
let panel;
let server;
let baseUrl;
let fixturePage;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE);
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/`;

  const userDataDir = mkdtempSync(join(tmpdir(), 'gbl-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 440, height: 940 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolveClose) => server?.close(resolveClose));
});

test('extension loads and first-run onboarding renders', async () => {
  await expect(panel.locator('.onboarding-card')).toBeVisible();
  await expect(panel.locator('#onboarding-title')).toHaveText('Your browser, in conversation');
  await expect(panel.locator('.onboarding-card .brand-subtitle')).toHaveText(
    'voice · vision · action',
  );
  await panel.screenshot({ path: join(root, 'test-results', 'onboarding.png') });
});

test('onboarding can be skipped and the live panel is usable', async () => {
  if (await panel.locator('.onboarding-card').count()) {
    await panel.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(panel.locator('.onboarding-card')).toHaveCount(0);
  await expect(panel.locator('.session-card')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Start live', exact: true })).toBeVisible();
  await expect(panel.locator('.composer input')).toBeVisible();
  await expect(panel.getByText('Key stays in the local bridge')).toBeVisible();
  await panel.screenshot({ path: join(root, 'test-results', 'panel.png') });
});

test('settings expose connection, access, and privacy controls', async () => {
  if (await panel.locator('.onboarding-card').count()) {
    await panel.getByRole('button', { name: 'Skip' }).click();
  }
  await panel.getByRole('button', { name: 'Open settings' }).click();
  await expect(panel.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Test connection' })).toBeVisible();

  await panel.getByRole('button', { name: 'Access' }).click();
  await expect(panel.getByText('Optional capabilities')).toBeVisible();
  await expect(panel.getByText('Downloads', { exact: true })).toBeVisible();
  await expect(panel.getByText('Bookmarks', { exact: true })).toBeVisible();
  await expect(panel.getByText('History', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Privacy' }).click();
  await expect(panel.getByText('What leaves this device')).toBeVisible();
  await expect(panel.getByText('The API key', { exact: false })).toBeVisible();

  await panel.screenshot({ path: join(root, 'test-results', 'settings.png') });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
});

test('content script snapshots and operates a real page', async () => {
  fixturePage = await context.newPage();
  await fixturePage.goto(baseUrl);
  await expect(fixturePage).toHaveTitle('GBL Fixture');

  const result = await panel.evaluate(
    async ({ pageUrl }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith(pageUrl));
      if (!tab?.id) return { error: 'fixture tab not found' };
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js'],
      });
      const snapshot = await chrome.tabs.sendMessage(tab.id, {
        type: 'GBL_CONTENT_OP',
        op: 'snapshot',
        args: { maxTextChars: 2000, maxElements: 40 },
      });
      return { tabId: tab.id, snapshot };
    },
    { pageUrl: baseUrl },
  );

  expect(result.error).toBeUndefined();
  expect(result.snapshot.ok).toBe(true);
  expect(result.snapshot.data.title).toBe('GBL Fixture');
  expect(result.snapshot.data.text).toContain('Revenue grew 18%');
  expect(result.snapshot.data.elements.length).toBeGreaterThan(0);

  const click = await panel.evaluate(
    async ({ tabId }) => {
      return chrome.tabs.sendMessage(tabId, {
        type: 'GBL_CONTENT_OP',
        op: 'click',
        args: { text: 'Continue' },
      });
    },
    { tabId: result.tabId },
  );
  expect(click.ok).toBe(true);
  expect(await fixturePage.evaluate(() => window.__clicked === true)).toBe(true);
});

test('a full-page read is bounded and framed as data', async () => {
  const read = await panel.evaluate(
    async ({ pageUrl }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.url?.startsWith(pageUrl));
      if (!tab?.id) return { error: 'fixture tab not found' };
      return chrome.tabs.sendMessage(tab.id, {
        type: 'GBL_CONTENT_OP',
        op: 'visibleText',
        args: { maxChars: 500 },
      });
    },
    { pageUrl: baseUrl },
  );
  expect(read.ok).toBe(true);
  expect(typeof read.data).toBe('string');
  expect(read.data.length).toBeLessThanOrEqual(500);
});
