/**
 * Accessibility audit.
 *
 * Runs axe-core inside the real side-panel page (CDP evaluation bypasses the
 * extension CSP), plus keyboard checks that axe cannot make: focus moves into
 * a dialog, Tab and Shift+Tab cannot escape it, Escape closes it, and focus
 * returns to the control that opened it.
 */
import { test, expect, chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionDir = join(root, 'release', 'chrome-extension');
const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
const axeSource = readFileSync(join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

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

let context;
let panel;

async function audit(label) {
  const results = await panel.evaluate(async () => {
    // @ts-expect-error axe is injected by the test harness.
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  });

  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));

  expect(summary, `${label}: ${JSON.stringify(summary, null, 2)}`).toEqual([]);
  return results;
}

async function skipOnboarding() {
  if (await panel.locator('.onboarding-card').count()) {
    await panel.getByRole('button', { name: 'Skip' }).click();
  }
  await expect(panel.locator('.onboarding-card')).toHaveCount(0);
}

async function focusIsInsideDialog() {
  return panel.evaluate(() => {
    const active = document.activeElement;
    return Boolean(active && active.closest('[role="dialog"]'));
  });
}

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gbl-a11y-')), {
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
  await expect(panel.locator('.onboarding-card')).toBeVisible();
  await panel.evaluate(axeSource);
});

test.afterAll(async () => {
  await context?.close();
});

test('onboarding has no WCAG A/AA violations', async () => {
  await audit('onboarding');
});

test('the live panel has no WCAG A/AA violations', async () => {
  await skipOnboarding();
  await audit('live panel');
});

test('every settings tab has no WCAG A/AA violations', async () => {
  await skipOnboarding();
  await panel.getByRole('button', { name: 'Open settings' }).click();
  await expect(panel.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  for (const tab of ['Connection', 'Voice', 'Agent', 'Access', 'Privacy']) {
    await panel.getByRole('button', { name: tab, exact: true }).click();
    await audit(`settings: ${tab}`);
  }

  await panel.keyboard.press('Escape');
  await expect(panel.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
});

test('the settings dialog traps focus and restores it to the opener', async () => {
  await skipOnboarding();
  const opener = panel.getByRole('button', { name: 'Open settings' });
  await opener.focus();
  await opener.click();

  const dialog = panel.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(await focusIsInsideDialog()).toBe(true);

  // Ten tabs forward and ten back: focus must never reach the page behind.
  for (let index = 0; index < 10; index += 1) {
    await panel.keyboard.press('Tab');
    expect(await focusIsInsideDialog(), `Tab ${index + 1} escaped the dialog`).toBe(true);
  }
  for (let index = 0; index < 10; index += 1) {
    await panel.keyboard.press('Shift+Tab');
    expect(await focusIsInsideDialog(), `Shift+Tab ${index + 1} escaped the dialog`).toBe(true);
  }

  await panel.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('the onboarding dialog traps focus', async () => {
  // Reload with onboarding still unseen.
  await panel.evaluate(async () => {
    await chrome.storage.local.remove('gbl.onboarding.v1');
  });
  await panel.reload();
  await expect(panel.locator('.onboarding-card')).toBeVisible();
  await panel.evaluate(axeSource);

  expect(await focusIsInsideDialog()).toBe(true);
  for (let index = 0; index < 12; index += 1) {
    await panel.keyboard.press('Tab');
    expect(await focusIsInsideDialog(), `Tab ${index + 1} escaped onboarding`).toBe(true);
  }
  for (let index = 0; index < 12; index += 1) {
    await panel.keyboard.press('Shift+Tab');
    expect(await focusIsInsideDialog(), `Shift+Tab ${index + 1} escaped onboarding`).toBe(true);
  }
});

test('a settings dialog opened from onboarding owns focus, not the dialog beneath', async () => {
  // Continue from the onboarding state left by the previous test.
  await panel.getByRole('tab', { name: 'Step 2 · Pair' }).click();
  const opener = panel.getByRole('button', { name: 'Open connection settings' });
  await opener.click();

  const settings = panel.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  expect(await focusIsInsideDialog()).toBe(true);

  for (let index = 0; index < 10; index += 1) {
    await panel.keyboard.press('Tab');
    const insideSettings = await panel.evaluate(() =>
      Boolean(document.activeElement?.closest('[aria-labelledby="settings-title"]')),
    );
    expect(insideSettings, `Tab ${index + 1} escaped the stacked settings dialog`).toBe(true);
  }

  await panel.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(panel.locator('.onboarding-card')).toBeVisible();
  await expect(opener).toBeFocused();
});
