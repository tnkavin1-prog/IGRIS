/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioController } from '../../../apps/desktop-hud/src/renderer/audio-controller.js';

function installAudioContext(context: AudioContext) {
  const AudioContextMock = vi.fn(function () {
    return context;
  });
  vi.stubGlobal('AudioContext', AudioContextMock);
  Object.defineProperty(window, 'AudioContext', {
    value: AudioContextMock,
    configurable: true,
  });
  return AudioContextMock;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices');
const originalAudioContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');

function installCaptureMocks(sampleRate = 16000) {
  const track = {
    readyState: 'live',
    onended: null as ((event: Event) => void) | null,
    // Calling MediaStreamTrack.stop() does not dispatch an ended event.
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  };
  const stream = { getTracks: vi.fn(() => [track]) };
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  const node = {
    port: { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null },
    onprocessorerror: null as ((event: Event) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    sampleRate,
    state: 'suspended' as AudioContextState,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
    audioWorklet: { addModule: vi.fn(async (): Promise<void> => undefined) },
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  };
  const contextConstructor = installAudioContext(context as unknown as AudioContext);
  const workletConstructor = vi.fn(function () {
    return node;
  });
  vi.stubGlobal('AudioWorkletNode', workletConstructor);
  return { track, stream, getUserMedia, node, context, contextConstructor, workletConstructor };
}

function decodePcm(base64: string): number[] {
  const bytes = Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true));
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalMediaDevices) {
    Object.defineProperty(window.navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(window.navigator, 'mediaDevices');
  }
  if (originalAudioContext) {
    Object.defineProperty(window, 'AudioContext', originalAudioContext);
  } else {
    Reflect.deleteProperty(window, 'AudioContext');
  }
});

describe('AudioController', () => {
  it('resumes capture and forwards leading and trailing silence for server VAD', async () => {
    const chunks: string[] = [];
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });

    const captureNode = {
      port: { onmessage: null as null | ((event: MessageEvent<Float32Array>) => void) },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const context: any = {
      sampleRate: 16000,
      state: 'suspended',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      close: vi.fn(async () => undefined),
      audioWorklet: { addModule: vi.fn(async () => undefined) },
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
    };
    vi.stubGlobal(
      'AudioWorkletNode',
      vi.fn(function () {
        return captureNode;
      }),
    );
    installAudioContext(context);

    const controller = new AudioController((chunk) => chunks.push(chunk));
    await expect(controller.startCapture()).resolves.toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);

    const onMessage = captureNode.port.onmessage;
    expect(onMessage).not.toBeNull();
    onMessage?.({ data: new Float32Array(16) } as MessageEvent<Float32Array>);
    onMessage?.({ data: new Float32Array(16).fill(0.5) } as MessageEvent<Float32Array>);
    onMessage?.({ data: new Float32Array(16) } as MessageEvent<Float32Array>);
    expect(chunks).toHaveLength(3);

    controller.stopCapture();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('shares one permission request and capture setup across concurrent starts', async () => {
    const mocks = installCaptureMocks();
    const permission = deferred<typeof mocks.stream>();
    mocks.getUserMedia.mockReturnValue(permission.promise);
    const controller = new AudioController();

    const first = controller.startCapture();
    const second = controller.startCapture();
    expect(second).toBe(first);
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mocks.contextConstructor).not.toHaveBeenCalled();

    permission.resolve(mocks.stream);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(mocks.contextConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(mocks.workletConstructor).toHaveBeenCalledTimes(1);
    await expect(controller.startCapture()).resolves.toBe(true);
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    controller.stopCapture();
  });

  it('stops a late permission stream without creating an audio context after cancellation', async () => {
    const mocks = installCaptureMocks();
    const permission = deferred<typeof mocks.stream>();
    mocks.getUserMedia.mockReturnValue(permission.promise);
    const controller = new AudioController();
    controller.onError = vi.fn();

    const pending = controller.startCapture();
    controller.stopCapture();
    expect(mocks.track.stop).not.toHaveBeenCalled();
    permission.resolve(mocks.stream);

    await expect(pending).resolves.toBe(false);
    expect(mocks.track.stop).toHaveBeenCalledTimes(1);
    expect(mocks.track.readyState).toBe('ended');
    expect(mocks.contextConstructor).not.toHaveBeenCalled();
    expect(mocks.workletConstructor).not.toHaveBeenCalled();
    expect(controller.lastError).toBeNull();
    expect(controller.onError).not.toHaveBeenCalled();
  });

  it.each(['pending', 'active'] as const)(
    'does not tear down a %s restarted capture when an earlier permission request rejects',
    async (restartedState) => {
      const mocks = installCaptureMocks();
      const earlierPermission = deferred<typeof mocks.stream>();
      const currentPermission = deferred<typeof mocks.stream>();
      mocks.getUserMedia
        .mockReturnValueOnce(earlierPermission.promise)
        .mockReturnValueOnce(currentPermission.promise);
      const onChunk = vi.fn();
      const controller = new AudioController(onChunk);
      controller.onError = vi.fn();

      const earlier = controller.startCapture();
      controller.stopCapture();
      const current = controller.startCapture();
      if (restartedState === 'active') {
        currentPermission.resolve(mocks.stream);
        await expect(current).resolves.toBe(true);
      }

      earlierPermission.reject(new DOMException('Permission denied', 'NotAllowedError'));
      await expect(earlier).resolves.toBe(false);
      if (restartedState === 'pending') {
        // The stale promise's finally handler must not clear the new in-flight start.
        expect(controller.startCapture()).toBe(current);
        currentPermission.resolve(mocks.stream);
        await expect(current).resolves.toBe(true);
      }

      expect(mocks.getUserMedia).toHaveBeenCalledTimes(2);
      expect(mocks.contextConstructor).toHaveBeenCalledTimes(1);
      expect(mocks.track.stop).not.toHaveBeenCalled();
      expect(mocks.context.close).not.toHaveBeenCalled();
      expect(mocks.node.disconnect).not.toHaveBeenCalled();
      expect(controller.lastError).toBeNull();
      expect(controller.onError).not.toHaveBeenCalled();
      mocks.node.port.onmessage?.(new MessageEvent('message', { data: new Float32Array([0.5]) }));
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(decodePcm(onChunk.mock.calls[0]![0])).toEqual([16383]);
      controller.stopCapture();
    },
  );

  it.each([48000, 44100])(
    'resamples %i Hz hardware input to continuous 16 kHz PCM across worklet messages',
    async (sampleRate) => {
      const mocks = installCaptureMocks(sampleRate);
      const chunks: string[] = [];
      const controller = new AudioController((chunk) => chunks.push(chunk));
      await expect(controller.startCapture()).resolves.toBe(true);
      expect(mocks.contextConstructor).toHaveBeenCalledWith({ latencyHint: 'interactive' });

      const input = Float32Array.from(
        { length: sampleRate / 10 },
        (_, index) => (2 * index) / (sampleRate / 10 - 1) - 1,
      );
      for (let offset = 0; offset < input.length; offset += 128) {
        mocks.node.port.onmessage?.(
          new MessageEvent('message', { data: input.slice(offset, offset + 128) }),
        );
      }

      const samples = chunks.flatMap(decodePcm);
      // A streaming interpolator may retain one output sample for the next input block.
      expect(samples.length).toBeGreaterThanOrEqual(1599);
      expect(samples.length).toBeLessThanOrEqual(1600);
      samples.forEach((sample, index) => {
        const value = (2 * index * sampleRate) / (16000 * (input.length - 1)) - 1;
        const expected = Math.trunc(value * (value < 0 ? 32768 : 32767));
        expect(Math.abs(sample - expected), `PCM sample ${index}`).toBeLessThanOrEqual(1);
      });
      controller.stopCapture();
    },
  );

  it.each(['resolves', 'rejects'] as const)(
    'ignores a cancelled worklet load that %s after capture has restarted',
    async (outcome) => {
      const earlierMocks = installCaptureMocks();
      const moduleLoad = deferred<void>();
      const moduleRequested = deferred<void>();
      earlierMocks.context.audioWorklet.addModule.mockImplementation(() => {
        moduleRequested.resolve(undefined);
        return moduleLoad.promise;
      });
      const onChunk = vi.fn();
      const controller = new AudioController(onChunk);
      controller.onError = vi.fn();
      const earlier = controller.startCapture();
      await moduleRequested.promise;

      controller.stopCapture();
      expect(earlierMocks.track.stop).toHaveBeenCalledTimes(1);
      expect(earlierMocks.context.close).toHaveBeenCalledTimes(1);
      const currentMocks = installCaptureMocks();
      await expect(controller.startCapture()).resolves.toBe(true);
      if (outcome === 'resolves') {
        moduleLoad.resolve(undefined);
      } else {
        moduleLoad.reject(new Error('Worklet load cancelled'));
      }
      await expect(earlier).resolves.toBe(false);

      expect(earlierMocks.context.createMediaStreamSource).not.toHaveBeenCalled();
      expect(earlierMocks.workletConstructor).not.toHaveBeenCalled();
      expect(earlierMocks.track.stop).toHaveBeenCalledTimes(1);
      expect(earlierMocks.context.close).toHaveBeenCalledTimes(1);
      expect(currentMocks.workletConstructor).toHaveBeenCalledTimes(1);
      expect(currentMocks.track.stop).not.toHaveBeenCalled();
      expect(currentMocks.context.close).not.toHaveBeenCalled();
      expect(currentMocks.node.disconnect).not.toHaveBeenCalled();
      expect(controller.lastError).toBeNull();
      expect(controller.onError).not.toHaveBeenCalled();
      currentMocks.node.port.onmessage?.(
        new MessageEvent('message', { data: new Float32Array([0.5]) }),
      );
      expect(onChunk).toHaveBeenCalledTimes(1);
      controller.stopCapture();
    },
  );

  it.each([
    ['device ended', 'Microphone disconnected. Check your input device and restart.'],
    ['processor error', 'Microphone processing stopped. Restart the voice session.'],
  ])('cleans up capture and reports %s through onError', async (failure, message) => {
    const mocks = installCaptureMocks();
    const controller = new AudioController();
    controller.onError = vi.fn(() => {
      // Consumers must only be notified after capture resources have been released.
      expect(mocks.track.readyState).toBe('ended');
      expect(mocks.context.close).toHaveBeenCalledTimes(1);
      expect(mocks.node.disconnect).toHaveBeenCalledTimes(1);
    });
    await expect(controller.startCapture()).resolves.toBe(true);
    expect(mocks.track.onended).toBeTypeOf('function');
    expect(mocks.node.onprocessorerror).toBeTypeOf('function');

    if (failure === 'device ended') {
      mocks.track.readyState = 'ended';
      mocks.track.onended?.(new Event('ended'));
    } else {
      mocks.node.onprocessorerror?.(new Event('processorerror'));
    }

    expect(controller.lastError).toBe(message);
    expect(controller.onError).toHaveBeenCalledExactlyOnceWith(message);
    expect(mocks.track.onended).toBeNull();
    expect(mocks.node.port.onmessage).toBeNull();
    expect(mocks.node.onprocessorerror).toBeNull();
    controller.stopCapture();
    expect(mocks.track.stop).toHaveBeenCalledTimes(1);
    expect(mocks.context.close).toHaveBeenCalledTimes(1);
    expect(mocks.node.disconnect).toHaveBeenCalledTimes(1);
    expect(controller.onError).toHaveBeenCalledTimes(1);
  });

  it('keeps more than 0.3 seconds of buffered playback sequential and resets it on clear', () => {
    const outputGain = {
      gain: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const context = {
      state: 'running',
      currentTime: 1,
      destination: {},
      createGain: vi.fn(() => outputGain),
      createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
        duration: length / sampleRate,
        copyToChannel: vi.fn(),
      })),
      // Buffer sources are one-shot: the browser creates a distinct node for every chunk.
      createBufferSource: vi.fn(() => ({
        buffer: null,
        onended: null as ((event: Event) => void) | null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
    installAudioContext(context as unknown as AudioContext);
    const controller = new AudioController();
    const chunk = window.btoa('\0'.repeat(4800 * 2)); // 0.2 seconds of 24 kHz PCM16.
    for (let index = 0; index < 4; index += 1) controller.playChunk(chunk);

    const sources = context.createBufferSource.mock.results.map((result) => result.value);
    expect(sources).toHaveLength(4);
    expect(context.createBuffer).toHaveBeenCalledTimes(4);
    expect(context.createBuffer).toHaveBeenCalledWith(1, 4800, 24000);
    sources.forEach((source, index) => {
      expect(source.connect).toHaveBeenCalledWith(outputGain);
      expect(source.start).toHaveBeenCalledTimes(1);
      expect(source.start.mock.calls[0]![0]).toBeCloseTo(1 + index * 0.2, 8);
      expect(source.stop).not.toHaveBeenCalled();
    });

    context.currentTime = 1.25;
    sources[0]!.onended?.(new Event('ended'));
    expect(sources[0]!.disconnect).toHaveBeenCalledTimes(1);
    controller.clearPlayback();
    expect(sources[0]!.stop).not.toHaveBeenCalled();
    sources.slice(1).forEach((source) => {
      expect(source.stop).toHaveBeenCalledTimes(1);
      expect(source.disconnect).toHaveBeenCalledTimes(1);
    });

    controller.playChunk(chunk);
    const nextSource = context.createBufferSource.mock.results[4]!.value;
    expect(nextSource.start).toHaveBeenCalledExactlyOnceWith(1.25);
    // stop() queues ended events; old events must not remove newly scheduled sources.
    sources.slice(1).forEach((source) => source.onended?.(new Event('ended')));
    expect(nextSource.stop).not.toHaveBeenCalled();
    controller.clearPlayback();
    controller.clearPlayback();
    expect(nextSource.stop).toHaveBeenCalledTimes(1);
    expect(nextSource.disconnect).toHaveBeenCalledTimes(1);
    sources.slice(1).forEach((source) => expect(source.stop).toHaveBeenCalledTimes(1));
  });

  it('unlocks playback and applies mute and volume to Gemini voice audio', async () => {
    const gain = { value: 1, setValueAtTime: vi.fn() };
    const outputGain = { gain, connect: vi.fn() };
    const source = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    const context: any = {
      sampleRate: 24000,
      state: 'suspended',
      currentTime: 1,
      destination: {},
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      createGain: vi.fn(() => outputGain),
      createBuffer: vi.fn(() => ({ duration: 1 / 24000, copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => source),
    };
    installAudioContext(context);

    const controller = new AudioController();
    controller.setVolume(0.35);
    controller.setMuted(true);
    await expect(controller.unlock()).resolves.toBe(true);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 1);

    controller.setMuted(false);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0.35, 1);
    controller.playChunk('AAA=');
    expect(source.connect).toHaveBeenCalledWith(outputGain);
    expect(source.start).toHaveBeenCalledTimes(1);
  });
});
