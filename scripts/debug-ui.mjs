import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'release', 'chrome-extension');
const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest();
const alphabet = 'abcdefghijklmnopqrstuvwxyz';
let id = '';
for (let i = 0; i < 16; i += 1) id += alphabet[digest[i] >> 4] + alphabet[digest[i] & 15];

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gbl-debug-')), {
  headless: false,
  viewport: { width: 440, height: 940 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
const page = await context.newPage();
page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('PAGEERROR', err.message));
page.on('framenavigated', (frame) => console.log('NAV', frame.url()));
await page.goto(`chrome-extension://${id}/sidepanel.html`);
await page.waitForSelector('.onboarding-card');
console.log('before skip', await page.locator('.onboarding-overlay').count());
await page.getByRole('button', { name: 'Skip' }).click();
await page.waitForTimeout(1000);
console.log('after skip', await page.locator('.onboarding-overlay').count());
console.log('storage', await page.evaluate(() => chrome.storage.local.get(null)));
console.log('html', (await page.locator('.app-shell').innerHTML()).slice(0, 300));
await page.screenshot({ path: join(root, 'test-results', 'debug.png'), fullPage: false });
await context.close();
