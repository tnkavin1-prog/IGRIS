import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), '..');
const dist = join(root, 'dist');

async function main() {
  console.log('Building Standalone Native Desktop HUD (Electron)...');
  const startedAt = Date.now();

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // 1. Bundle Electron Main Process
  await build({
    entryPoints: [join(root, 'src', 'main', 'index.ts')],
    outfile: join(dist, 'main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'ws', 'electron-updater'],
    logLevel: 'warning',
  });

  // 2. Bundle Preload Script
  await build({
    entryPoints: [join(root, 'src', 'main', 'preload.ts')],
    outfile: join(dist, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'warning',
  });

  // 3. Bundle React Renderer
  await build({
    entryPoints: [join(root, 'src', 'renderer', 'main.tsx')],
    outfile: join(dist, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'esm',
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  // 4. Bundle mic capture AudioWorklet (separate file: CSP forbids blob: worklets)
  await build({
    entryPoints: [join(root, 'src', 'renderer', 'capture-worklet.ts')],
    outfile: join(dist, 'capture-worklet.js'),
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    logLevel: 'warning',
  });

  // 5. Copy HTML & CSS assets
  cpSync(join(root, 'src', 'renderer', 'index.html'), join(dist, 'index.html'));
  cpSync(join(root, 'src', 'renderer', 'styles'), join(dist, 'styles'), { recursive: true });

  console.log(
    `Desktop HUD built successfully in ${((Date.now() - startedAt) / 1000).toFixed(2)}s.`,
  );
}

main().catch((err) => {
  console.error('Desktop HUD build failed:', err);
  process.exit(1);
});
