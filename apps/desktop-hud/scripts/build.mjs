import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), '..');
const dist = join(root, 'dist');
const isProd = process.env.NODE_ENV === 'production';

function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function generateManifest() {
  if (!isProd) return;
  try {
    const commitSha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const shortSha = commitSha.substring(0, 7);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const version = pkg.version;

    const files = readdirSync(dist, { recursive: true });
    const entries = {};

    for (const file of files) {
      const fullPath = join(dist, file);
      const stat = await import('node:fs/promises').then((fs) => fs.stat(fullPath));
      if (stat.isDirectory()) continue;
      const sha256 = await sha256File(fullPath);
      entries[file] = { size: stat.size, sha256 };
    }

    const manifest = {
      commit: commitSha,
      shortCommit: shortSha,
      version,
      platform: process.platform,
      arch: process.arch,
      nodeEnv: process.env.NODE_ENV,
      builtAt: new Date().toISOString(),
      files: entries,
    };

    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    );
    console.log(`Manifest generated: ${shortSha}, ${version}, ${Object.keys(entries).length} files`);
  } catch (err) {
    console.warn(`Manifest generation failed: ${err}`);
  }
}

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

  // 6. Generate release manifest (production only)
  await generateManifest();

  console.log(
    `Desktop HUD built successfully in ${((Date.now() - startedAt) / 1000).toFixed(2)}s.`,
  );
}

main().catch((err) => {
  console.error('Desktop HUD build failed:', err);
  process.exit(1);
});
