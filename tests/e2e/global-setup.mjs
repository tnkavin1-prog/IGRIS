import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = spawnSync(process.execPath, ['scripts/build.mjs', '--extension-only'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('Extension build failed; E2E tests cannot run.');
}
