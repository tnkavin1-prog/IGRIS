import { describe, expect, it, vi } from 'vitest';
import { ExecutionGuard } from '../../../apps/desktop-hud/src/main/execution-guard.js';

describe('ExecutionGuard', () => {
  it('shares concurrent identical mutations and suppresses immediate duplicates', async () => {
    const guard = new ExecutionGuard();
    let finish: ((value: Record<string, unknown>) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finish = resolve;
        }),
    );

    const first = guard.execute('browser_open_tab', {}, action);
    const concurrent = guard.execute('browser_open_tab', {}, action);
    finish?.({ success: true, tabId: 'one' });

    await expect(first).resolves.toMatchObject({ success: true, tabId: 'one' });
    await expect(concurrent).resolves.toMatchObject({ deduplicated: true, tabId: 'one' });
    await expect(guard.execute('browser_open_tab', {}, action)).resolves.toMatchObject({
      deduplicated: true,
      tabId: 'one',
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed side effect within the deduplication window', async () => {
    const guard = new ExecutionGuard();
    const action = vi.fn(async () => ({ success: false, error: 'outcome unknown' }));

    await guard.execute('launch_application', { app_name: 'chrome' }, action);
    const duplicate = await guard.execute('launch_application', { app_name: 'chrome' }, action);

    expect(duplicate).toMatchObject({ success: false, deduplicated: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('serializes input while allowing intentional repeated key presses', async () => {
    const guard = new ExecutionGuard();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = guard.execute('computer_use_hotkey', { keys: ['Ctrl', 'T'] }, async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
      return { success: true };
    });
    const second = guard.execute('computer_use_hotkey', { keys: ['Ctrl', 'T'] }, async () => {
      events.push('second');
      return { success: true };
    });

    await Promise.resolve();
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });
});
