import { describe, expect, it } from 'vitest';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import { buildDefaultAdapterRegistry } from '../../../apps/desktop-hud/src/main/application-adapters.js';

describe('application adapters', () => {
  it('resolves every default adapter by id and alias', () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);

    for (const name of [
      'chrome',
      'notepad',
      'explorer',
      'word',
      'excel',
      'powerpoint',
      'vscode',
      'edge',
    ]) {
      expect(registry.has(name), name).toBe(true);
      expect(registry.resolve(name)?.id).toBe(name);
    }
    // An alias resolves to the same adapter instance.
    expect(registry.resolve('notepad.exe')?.id).toBe('notepad');
    expect(registry.resolve('msedge')?.id).toBe('edge');
  });

  it('lists each application only once', () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    const ids = registry.list().map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('launches through the adapter when AppManagerService is given a registry', async () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    appManager.setAdapterRegistry(registry);

    const launched = await appManager.launchApplication('notepad');
    expect(launched.ok).toBe(true);
    expect(launched.appName).toBe('notepad');
  });

  it('verifies a window by visibility and title', async () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    const notepad = registry.resolve('notepad')!;
    const good = await notepad.verify({
      hwnd: 1,
      title: 'Untitled - Notepad',
      processName: 'notepad',
      pid: 1,
      isVisible: true,
      isIconic: false,
    });
    expect(good).toBe(true);
    const bad = await notepad.verify({
      hwnd: 1,
      title: '',
      processName: 'notepad',
      pid: 1,
      isVisible: false,
      isIconic: false,
    });
    expect(bad).toBe(false);
  });

  it('falls back to the legacy resolver when no adapter is registered', async () => {
    const appManager = new AppManagerService({ mockMode: true });
    const launched = await appManager.launchApplication('notepad');
    expect(launched.ok).toBe(true);
  });

  it('observes a running, healthy window', () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    const notepad = registry.resolve('notepad')!;
    const observation = notepad.observe([
      {
        hwnd: 1,
        title: 'Untitled - Notepad',
        processName: 'notepad',
        pid: 1,
        isVisible: true,
        isIconic: false,
      },
    ]);
    expect(observation.running).toBe(true);
    expect(observation.healthy).toBe(true);
    expect(observation.window?.title).toBe('Untitled - Notepad');
  });

  it('reports not running when the window is gone', () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    const notepad = registry.resolve('notepad')!;
    const observation = notepad.observe([]);
    expect(observation.running).toBe(false);
    expect(observation.healthy).toBe(false);
    expect(observation.window).toBeUndefined();
  });

  it('recovers a missing application by relaunching it', async () => {
    const appManager = new AppManagerService({ mockMode: true });
    const registry = buildDefaultAdapterRegistry(appManager, undefined);
    const notepad = registry.resolve('notepad')!;
    const recovered = await notepad.recover('window disappeared', appManager);
    expect(recovered).toBe(true);
  });
});
