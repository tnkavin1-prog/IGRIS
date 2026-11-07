/**
 * Overlay surface.
 *
 * The overlay is what makes the assistant feel like the Gemini Live pill: a
 * floating frame pinned over the page instead of a side panel. These tests
 * inject the same host script the toolbar action injects, then drive the real
 * extension page inside the frame.
 */
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
const FIXTURE = `<!doctype html><html lang="en"><head><title>Overlay Fixture</title></head>
<body style="margin:0;font-family:system-ui;background:#f6f7fb">
<h1 id="heading">Overlay fixture</h1><p>Page content stays interactive.</p>
<button id="page-button">Page button</button></body></html>`;

let context;
let panel;
let page;
let server;
let tabId;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(FIXTURE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gbl-overlay-')), {
    headless: false,
    viewport: { width: 1000, height: 900 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
    ],
  });

  // An extension page is the only place chrome.scripting is available.
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(async () => {
    await chrome.storage.local.set({ 'gbl.onboarding.v1': { seen: true } });
  });

  page = await context.newPage();
  await page.goto(url);
  tabId = await panel.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith(target))?.id ?? -1;
  }, url);
  expect(tabId).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((done) => server?.close(done));
});

async function injectOverlay() {
  await panel.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['overlay-host.js'] });
  }, tabId);
}

async function removeOverlay() {
  await page.evaluate(() => document.getElementById('gbl-overlay-host')?.remove());
}

test.beforeEach(async () => {
  // Start every test from a fresh host so the default pill state is exercised
  // rather than whatever view the previous test left behind.
  await removeOverlay();
  await injectOverlay();
});

const hostBox = (locator) =>
  locator.evaluate((element) => {
    const wrap = element.shadowRoot.querySelector('.wrap');
    const rect = wrap.getBoundingClientRect();
    return {
      view: wrap.dataset.view,
      position: getComputedStyle(wrap).position,
      right: Math.round(window.innerWidth - rect.right),
      bottom: Math.round(window.innerHeight - rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      zIndex: getComputedStyle(element).zIndex,
    };
  });

test('injects a compact pill by default and expands to the full panel', async () => {
  const host = page.locator('#gbl-overlay-host');
  await expect(host).toHaveCount(1);

  const frame = page.frameLocator('#gbl-overlay-host iframe');
  await expect(frame.locator('.overlay-pill[data-ready="true"]')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Open the Gemini assistant' })).toBeVisible();

  const pill = await hostBox(host);
  expect(pill.view).toBe('pill');
  expect(pill.position).toBe('fixed');
  expect(pill.right).toBe(20);
  expect(pill.bottom).toBe(20);
  expect(pill.width).toBe(360);
  expect(pill.height).toBe(64);
  expect(pill.zIndex).toBe('2147483647');

  await frame.getByRole('button', { name: 'Open the Gemini assistant' }).click();
  console.log(
    'click probe',
    await frame.locator('body').evaluate(() => ({
      clicks: window.__gblClicks ?? 0,
      view: document.querySelector('.overlay-pill') ? 'pill' : 'panel',
    })),
  );
  await expect(frame.getByRole('button', { name: 'Open settings' })).toBeVisible();
  await expect
    .poll(async () => {
      const box = await hostBox(host);
      return `${box.view} ${box.width}x${box.height}`;
    })
    .toBe('panel 404x648');

  // The page underneath still works.
  await page.locator('#page-button').click();
});

test('minimizes to an orb and expands back', async () => {
  const host = page.locator('#gbl-overlay-host');
  const frame = page.frameLocator('#gbl-overlay-host iframe');

  await frame.getByRole('button', { name: 'Open the Gemini assistant' }).click();
  await expect.poll(async () => (await hostBox(host)).view).toBe('panel');
  await expect(frame.getByRole('button', { name: 'Minimize to an orb' })).toBeVisible();

  await frame.getByRole('button', { name: 'Minimize to an orb' }).click();

  await expect.poll(async () => (await hostBox(host)).view).toBe('orb');
  await expect
    .poll(async () => {
      const box = await hostBox(host);
      return `${box.width}x${box.height}`;
    })
    .toBe('64x64');

  await frame.getByRole('button', { name: 'Open the Gemini assistant' }).click();

  await expect.poll(async () => (await hostBox(host)).view).toBe('panel');
});

test('closes and leaves the page untouched', async () => {
  const frame = page.frameLocator('#gbl-overlay-host iframe');
  await expect(frame.locator('.overlay-pill[data-ready="true"]')).toBeVisible();
  await frame.getByRole('button', { name: 'Close the assistant' }).click();

  await expect(page.locator('#gbl-overlay-host')).toHaveCount(0);
  await expect(page.locator('#heading')).toHaveText('Overlay fixture');
});

test('a second request re-focuses the existing frame instead of stacking', async () => {
  await injectOverlay();
  await injectOverlay();
  await expect(page.locator('#gbl-overlay-host')).toHaveCount(1);

  // Re-injection means "show me the assistant", so it opens the panel.
  await expect
    .poll(async () => (await hostBox(page.locator('#gbl-overlay-host'))).view)
    .toBe('panel');
});
