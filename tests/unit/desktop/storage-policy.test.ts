import { describe, it, expect } from 'vitest';
import { pickDataRoot } from '../../../apps/desktop-hud/src/main/runtime-paths.js';

/**
 * The storage policy: the application must not write its data, caches,
 * models, downloads or monitoring to the C: drive.
 */
describe('pickDataRoot', () => {
  it('keeps a development build inside the repository', () => {
    const root = pickDataRoot({
      env: {},
      packaged: false,
      repoRoot: 'E:\\Gemetron',
      execPath: 'E:\\Gemetron\\node_modules\\electron\\dist\\electron.exe',
    });
    expect(root).toBe('E:\\Gemetron');
  });

  it('places an installed build on the drive the application lives on', () => {
    const root = pickDataRoot({
      env: {},
      packaged: true,
      repoRoot: 'E:\\Gemetron',
      execPath: 'E:\\Apps\\Gemetron\\Gemetron.exe',
      localAppData: 'C:\\Users\\tester\\AppData\\Local',
    });
    expect(root.toLowerCase()).toBe('e:\\gemetrondata');
    expect(root.toLowerCase().startsWith('c:')).toBe(false);
  });

  it('falls back to the system drive only when the application is installed there', () => {
    const root = pickDataRoot({
      env: {},
      packaged: true,
      repoRoot: 'E:\\Gemetron',
      execPath: 'C:\\Program Files\\Gemetron\\Gemetron.exe',
      localAppData: 'C:\\Users\\tester\\AppData\\Local',
    });
    expect(root).toBe('C:\\Users\\tester\\AppData\\Local\\Gemetron');
  });

  it('lets an explicit override win over every default', () => {
    const root = pickDataRoot({
      env: { GEMATRON_DATA_DIR: 'E:\\GemetronData' },
      packaged: true,
      repoRoot: 'E:\\Gemetron',
      execPath: 'C:\\Program Files\\Gemetron\\Gemetron.exe',
      localAppData: 'C:\\Users\\tester\\AppData\\Local',
    });
    expect(root).toBe('E:\\GemetronData');
  });

  it('ignores an empty override', () => {
    const root = pickDataRoot({
      env: { GEMATRON_DATA_DIR: '   ' },
      packaged: false,
      repoRoot: 'E:\\Gemetron',
      execPath: 'E:\\Gemetron\\electron.exe',
    });
    expect(root).toBe('E:\\Gemetron');
  });
});
