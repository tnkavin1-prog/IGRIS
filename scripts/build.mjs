#!/usr/bin/env node
/**
 * Production build.
 *
 *   side panel  → Vite (React + CSS, hashed assets)
 *   background  → esbuild ESM
 *   content     → esbuild IIFE (injected with chrome.scripting)
 *   worklets    → esbuild IIFE (AudioWorklet modules)
 *   bridge      → esbuild ESM (Node 20+)
 *
 * Everything lands in release/chrome-extension so the unpacked folder can be
 * loaded directly. The bridge is separate because it is not shipped to Chrome.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'apps', 'chrome-extension');
const bridgeDir = join(root, 'apps', 'local-bridge');
const outDir = join(root, 'release', 'chrome-extension');
const extensionOnly = process.argv.includes('--extension-only');

const startedAt = Date.now();

function log(message) {
  process.stdout.write(`\n▸ ${message}\n`);
}

function assertFile(path) {
  if (!existsSync(path)) throw new Error(`Expected build output is missing: ${path}`);
  const size = statSync(path).size;
  if (size === 0) throw new Error(`Build output is empty: ${path}`);
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function buildSidePanel() {
  log('Building the React side panel with Vite');
  await viteBuild({
    root: extensionDir,
    base: './',
    publicDir: false,
    configFile: false,
    plugins: [react()],
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      sourcemap: false,
      minify: 'esbuild',
      cssMinify: true,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          sidepanel: resolve(extensionDir, 'sidepanel.html'),
          overlay: resolve(extensionDir, 'overlay.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  });
  assertFile(join(outDir, 'sidepanel.html'));
  assertFile(join(outDir, 'overlay.html'));
}

async function buildScripts() {
  log('Bundling background, content script, and audio worklets');
  const common = {
    bundle: true,
    platform: 'browser',
    target: 'chrome116',
    logLevel: 'warning',
    legalComments: 'none',
  };

  await Promise.all([
    esbuild({
      ...common,
      entryPoints: [join(extensionDir, 'src', 'background.ts')],
      outfile: join(outDir, 'background.js'),
      format: 'esm',
    }),
    esbuild({
      ...common,
      entryPoints: [join(extensionDir, 'src', 'content', 'content-script.ts')],
      outfile: join(outDir, 'content-script.js'),
      format: 'iife',
    }),
    esbuild({
      ...common,
      entryPoints: [join(extensionDir, 'src', 'overlay', 'host.ts')],
      outfile: join(outDir, 'overlay-host.js'),
      format: 'iife',
    }),
    esbuild({
      ...common,
      entryPoints: [join(extensionDir, 'src', 'audio', 'worklet-capture.ts')],
      outfile: join(outDir, 'audio', 'worklet-capture.js'),
      format: 'iife',
    }),
    esbuild({
      ...common,
      entryPoints: [join(extensionDir, 'src', 'audio', 'worklet-playback.ts')],
      outfile: join(outDir, 'audio', 'worklet-playback.js'),
      format: 'iife',
    }),
  ]);

  for (const file of [
    'background.js',
    'content-script.js',
    'overlay-host.js',
    'audio/worklet-capture.js',
    'audio/worklet-playback.js',
  ]) {
    assertFile(join(outDir, file));
  }
}

function copyManifest() {
  log('Copying the manifest');
  const manifest = readFileSync(join(extensionDir, 'manifest.json'), 'utf8');
  JSON.parse(manifest); // Fail the build on malformed JSON.
  cpSync(join(extensionDir, 'manifest.json'), join(outDir, 'manifest.json'));
}

function buildIcons() {
  log('Drawing icons');
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'make-icons.mjs'), join(outDir, 'icons')],
    {
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) throw new Error('Icon generation failed.');
  for (const size of [16, 32, 48, 128]) assertFile(join(outDir, 'icons', `icon${size}.png`));
}

async function buildBridge() {
  log('Bundling the local bridge');
  await esbuild({
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    logLevel: 'warning',
    legalComments: 'none',
    entryPoints: [join(bridgeDir, 'src', 'server.ts')],
    outfile: join(bridgeDir, 'dist', 'server.mjs'),
    banner: {
      js: "import { createRequire as __gblCreateRequire } from 'node:module';\nconst require = __gblCreateRequire(import.meta.url);",
    },
  });
  assertFile(join(bridgeDir, 'dist', 'server.mjs'));
}

function report() {
  log('Build artifacts');
  const files = [
    'manifest.json',
    'sidepanel.html',
    'background.js',
    'content-script.js',
    'audio/worklet-capture.js',
    'audio/worklet-playback.js',
    'icons/icon128.png',
  ];
  for (const file of files) {
    const path = join(outDir, file);
    process.stdout.write(`  ${file.padEnd(34)} ${formatKb(statSync(path).size)}\n`);
  }
  if (!extensionOnly) {
    process.stdout.write(
      `  ${'bridge/dist/server.mjs'.padEnd(34)} ${formatKb(statSync(join(bridgeDir, 'dist', 'server.mjs')).size)}\n`,
    );
  }
  process.stdout.write(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
  process.stdout.write(`Load unpacked: ${outDir}\n`);
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await buildSidePanel();
  await buildScripts();
  copyManifest();
  buildIcons();
  if (!extensionOnly) await buildBridge();
  report();
}

main().catch((error) => {
  console.error('\nBuild failed:', error);
  process.exitCode = 1;
});
