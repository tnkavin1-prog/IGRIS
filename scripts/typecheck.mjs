#!/usr/bin/env node
/**
 * Typecheck every workspace that owns TypeScript sources.
 *
 * We deliberately run one tsc process per project instead of a single solution
 * build: the bridge is NodeNext, while the extension is DOM + Bundler. A shared
 * build would force one lib set on both and hide real errors.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const onlyExtension = process.argv.includes('--extension-only');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(tsc)) {
  console.error('TypeScript is not installed. Run: npm install');
  process.exit(1);
}

const projects = onlyExtension
  ? [{ name: 'chrome-extension', dir: 'apps/chrome-extension' }]
  : [
      { name: 'shared', dir: 'packages/shared' },
      { name: 'local-bridge', dir: 'apps/local-bridge' },
      { name: 'chrome-extension', dir: 'apps/chrome-extension' },
      { name: 'desktop-hud', dir: 'apps/desktop-hud' },
    ];

let failed = 0;
for (const project of projects) {
  const cwd = join(root, project.dir);
  process.stdout.write(`\n▶ typecheck ${project.name}\n`);
  const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`✖ ${project.name} failed`);
  } else {
    console.log(`✔ ${project.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} project(s) failed typechecking.`);
  process.exit(1);
}
console.log('\nAll projects typecheck cleanly.');
