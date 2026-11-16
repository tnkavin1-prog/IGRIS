import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), '..');
const dist = join(root, 'dist');
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  console.log('Building Standalone Native Desktop HUD (Electron)...');
  const startedAt = Date.now();

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const commonOptions = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'ws', 'electron-updater'],
    logLevel: 'warning',
    sourcemap: isProd ? 'external' : false,
    minify: isProd,
  };

  // 1. Bundle Electron Main Process
  await build({
    ...commonOptions,
    entryPoints: [join(root, 'src', 'main', 'index.ts')],
    outfile: join(dist, 'main.cjs'),
  });

  // 2. Bundle Preload Script
  await build({
    ...commonOptions,
    entryPoints: [join(root, 'src', 'main', 'preload.ts')],
    outfile: join(dist, 'preload.cjs'),
    external: ['electron'],
  });

  // 3. Bundle React Renderer
  await build({
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'esm',
    logLevel: 'warning',
    sourcemap: isProd ? 'external' : false,
    minify: isProd,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    entryPoints: [join(root, 'src', 'renderer', 'main.tsx')],
    outfile: join(dist, 'renderer.js'),
  });

  // 4. Bundle mic capture AudioWorklet (separate file: CSP forbids blob: worklets)
  await build({
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    logLevel: 'warning',
    sourcemap: isProd ? 'external' : false,
    minify: isProd,
    entryPoints: [join(root, 'src', 'renderer', 'capture-worklet.ts')],
    outfile: join(dist, 'capture-worklet.js'),
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
