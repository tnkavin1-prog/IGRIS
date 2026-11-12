import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
import { WakeWordService } from '../../../apps/desktop-hud/src/main/wake-word.js';

function child() {
  const process = new EventEmitter() as any;
  process.stdout = new EventEmitter();
  process.stdout.setEncoding = vi.fn();
  process.stderr = new EventEmitter();
  process.stdin = new EventEmitter();
  process.stdin.end = vi.fn(() => queueMicrotask(() => process.emit('exit', 0)));
  process.kill = vi.fn();
  return process;
}
beforeEach(() => spawn.mockReset());
describe('WakeWordService', () => {
  it('is opt-in and decodes split notifications', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const service = new WakeWordService();
    const wake = vi.fn();
    service.on('wake', wake);
    expect(spawn).not.toHaveBeenCalled();
    await service.setEnabled(true);
    process.stdout.emit('data', 'ready\r\nwa');
    process.stdout.emit('data', 'ke\r\n');
    expect(wake).toHaveBeenCalledOnce();
    await service.dispose();
    expect(process.stdin.end).toHaveBeenCalledWith('stop\n');
  });
  it('releases the microphone before foreground capture and ignores stale events', async () => {
    const first = child(),
      second = child();
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const service = new WakeWordService();
    const wake = vi.fn();
    service.on('wake', wake);
    await service.setEnabled(true);
    await service.setPaused(true);
    first.stdout.emit('data', 'wake\n');
    expect(wake).not.toHaveBeenCalled();
    await service.setPaused(false);
    expect(spawn).toHaveBeenCalledTimes(2);
    await service.setEnabled(false);
    await service.setPaused(false);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable recognition without automatic retry loops', async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const service = new WakeWordService();
    const unavailable = vi.fn();
    service.on('unavailable', unavailable);
    await service.setEnabled(true);
    process.emit('error', new Error('unavailable'));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
    await service.dispose();
  });
});
