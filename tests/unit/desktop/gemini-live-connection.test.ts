import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GeminiLiveService } from '../../../apps/desktop-hud/src/main/gemini-live.js';
import { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';
import { ComputerVisionService } from '../../../apps/desktop-hud/src/main/computer-vision.js';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';
import { AgenticWorkflowEngine } from '../../../apps/desktop-hud/src/main/agentic-workflow.js';
import type { JarvisMemoryStore } from '../../../apps/desktop-hud/src/main/jarvis-memory.js';

interface TestSocket extends EventEmitter {
  readyState: number;
  send: ReturnType<typeof vi.fn<(payload: string) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
  terminate: ReturnType<typeof vi.fn<() => void>>;
  open(): void;
  receive(message: Record<string, unknown>): void;
  serverClose(code: number, reason?: string): void;
}

const sockets = vi.hoisted(() => [] as TestSocket[]);

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');

  class MockWebSocket extends EventEmitter implements TestSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    send = vi.fn<(payload: string) => void>();
    // Closing is deliberately separate from the server's close event so tests
    // can deliver late events after disconnect or termination.
    close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSING;
    });
    terminate = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSING;
    });

    constructor() {
      super();
      this.on('error', () => undefined);
      sockets.push(this);
    }

    open(): void {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }

    receive(message: Record<string, unknown>): void {
      this.emit('message', Buffer.from(JSON.stringify(message)));
    }

    serverClose(code: number, reason = ''): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', code, Buffer.from(reason));
    }
  }

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// The imported singleton creates its download directory even when unused.
vi.mock('../../../apps/desktop-hud/src/main/download-manager.js', () => ({
  downloadManager: {},
}));

interface ConnectionState {
  socket: TestSocket | null;
  isSetupComplete: boolean;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  setupTimer: ReturnType<typeof setTimeout> | null;
  resumeHandle: string | null;
  stoppingOperations: Promise<unknown>;
}

describe('GeminiLiveService connection lifecycle', () => {
  let service: GeminiLiveService;
  let state: ConnectionState;
  let cdpClient: CDPClient;
  let nativeInput: NativeInputService;
  let errors: ReturnType<typeof vi.fn<() => void>>;
  let connected: ReturnType<typeof vi.fn<() => void>>;
  let disconnected: ReturnType<typeof vi.fn<() => void>>;
  let reconnectScheduled: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    // A nonempty placeholder prevents loadInitialSettings from reading .env.
    // The connection itself always uses the fake key set via updateSettings.
    vi.stubEnv('GEMINI_API_KEY', 'unused-connection-test-placeholder');
    vi.stubEnv('GEMATRON_STREAM_SCREEN', 'false');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network disabled in connection tests'),
    );

    cdpClient = new CDPClient(9222, '127.0.0.1');
    nativeInput = new NativeInputService({ mockMode: true });
    const computerVision = new ComputerVisionService({ mockMode: true });
    const appManager = new AppManagerService({ mockMode: true });
    // Keep memory and workflow checkpoints entirely off disk.
    const memoryStore = {
      getPreferences: () => ({}),
      buildSystemContextPrompt: () => '',
    } as unknown as JarvisMemoryStore;
    const workflowEngine = new AgenticWorkflowEngine({
      cdpClient,
      nativeInput,
      computerVision,
      appManager,
      memoryStore,
    });
    service = new GeminiLiveService(cdpClient, {
      nativeInput,
      computerVision,
      appManager,
      memoryStore,
      workflowEngine,
    });
    state = service as unknown as ConnectionState;
    errors = vi.fn();
    connected = vi.fn();
    disconnected = vi.fn();
    reconnectScheduled = vi.fn();
    service.on('error', errors);
    service.on('connected', connected);
    service.on('disconnected', disconnected);
    service.on('reconnect-scheduled', reconnectScheduled);
    service.updateSettings({ apiKey: 'fake-connection-test-key' });
  });

  afterEach(async () => {
    try {
      service?.dispose();
      await state?.stoppingOperations;
      nativeInput?.dispose();
      cdpClient?.stopTracking();
      for (const socket of sockets) socket.removeAllListeners();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      sockets.length = 0;
    }
  });

  async function connectSocket(): Promise<TestSocket> {
    const previousCount = sockets.length;
    expect(await service.connect()).toBe(true);
    expect(sockets).toHaveLength(previousCount + 1);
    return sockets[previousCount]!;
  }

  function sent(socket: TestSocket) {
    return socket.send.mock.calls.map(([payload]) => JSON.parse(payload));
  }

  async function reconnectAfterDrop(socket: TestSocket): Promise<TestSocket> {
    const previousCount = sockets.length;
    socket.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(previousCount + 1);
    return sockets[previousCount]!;
  }

  it('does not reset reconnect attempts or admit audio on transport open before setupComplete', async () => {
    const first = await connectSocket();
    const retry = await reconnectAfterDrop(first);
    expect(state.reconnectAttempts).toBe(1);

    retry.open();
    expect(state.reconnectAttempts).toBe(1);
    expect(state.isSetupComplete).toBe(false);
    expect(state.setupTimer).not.toBeNull();
    expect(service.currentStatus).toBe('connecting');
    expect(connected).not.toHaveBeenCalled();
    expect(sent(retry)).toEqual([expect.objectContaining({ setup: expect.any(Object) })]);

    service.sendAudioChunk('AQIDBA==');
    expect(retry.send).toHaveBeenCalledTimes(1);

    retry.serverClose(1006);
    expect(reconnectScheduled.mock.calls).toEqual([
      [{ attempt: 1, delayMs: 1_000 }],
      [{ attempt: 2, delayMs: 2_000 }],
    ]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('accepts setupComplete by clearing its deadline, resetting backoff, and entering listening', async () => {
    const first = await connectSocket();
    const retry = await reconnectAfterDrop(first);
    retry.open();
    expect(state.reconnectAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(14_999);

    retry.receive({ setupComplete: {} });
    expect(state.setupTimer).toBeNull();
    expect(state.reconnectAttempts).toBe(0);
    expect(state.isSetupComplete).toBe(true);
    expect(service.currentStatus).toBe('listening');
    expect(connected).toHaveBeenCalledExactlyOnceWith({ resumed: false });

    service.sendAudioChunk('AQIDBA==');
    expect(sent(retry)[1]).toEqual({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AQIDBA==' } },
    });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(retry.terminate).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();

    retry.serverClose(1006);
    expect(reconnectScheduled).toHaveBeenLastCalledWith({ attempt: 1, delayMs: 1_000 });
  });

  it.each(['connecting', 'open'] as const)(
    'terminates a %s socket at the 15-second setup deadline',
    async (phase) => {
      const socket = await connectSocket();
      await vi.advanceTimersByTimeAsync(5_000);
      if (phase === 'open') socket.open();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(socket.terminate).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(socket.terminate).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('within 15 seconds'));
      expect(connected).not.toHaveBeenCalled();
      expect(state.isSetupComplete).toBe(false);
      // Termination requests transport shutdown; reconnect is driven by close.
      expect(reconnectScheduled).not.toHaveBeenCalled();
      socket.serverClose(1006);
      expect(state.setupTimer).toBeNull();
      expect(reconnectScheduled).toHaveBeenCalledExactlyOnceWith({ attempt: 1, delayMs: 1_000 });
    },
  );

  it('disconnect clears resumption and ignores stale close, message, open, and error events', async () => {
    const stale = await connectSocket();
    stale.open();
    stale.receive({ setupComplete: {} });
    stale.receive({ sessionResumptionUpdate: { resumable: true, newHandle: 'old-handle' } });
    expect(state.resumeHandle).toBe('old-handle');

    service.disconnect();
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(state.socket).toBeNull();
    expect(state.resumeHandle).toBeNull();
    expect(state.setupTimer).toBeNull();
    expect(state.reconnectTimer).toBeNull();
    expect(state.isSetupComplete).toBe(false);
    expect(service.currentStatus).toBe('idle');
    connected.mockClear();
    const audio = vi.fn();
    service.on('audio-chunk', audio);

    const deliverStaleEvents = () => {
      stale.open();
      stale.receive({
        setupComplete: {},
        sessionResumptionUpdate: { resumable: true, newHandle: 'stale-handle' },
        serverContent: { modelTurn: { parts: [{ inlineData: { data: 'stale-audio' } }] } },
      });
      stale.emit('error', new Error('late transport error'));
      stale.serverClose(1008, 'late rejection');
    };
    deliverStaleEvents();
    expect(service.currentStatus).toBe('idle');
    expect(state.resumeHandle).toBeNull();
    expect(state.isSetupComplete).toBe(false);

    const current = await connectSocket();
    const currentDeadline = state.setupTimer;
    current.open();
    expect(sent(current)[0].setup.sessionResumption).toEqual({});
    deliverStaleEvents();
    expect(state.socket).toBe(current);
    expect(state.setupTimer).toBe(currentDeadline);
    expect(state.resumeHandle).toBeNull();
    expect(state.isSetupComplete).toBe(false);
    expect(service.currentStatus).toBe('connecting');
    expect(stale.send).toHaveBeenCalledTimes(1);
    expect(connected).not.toHaveBeenCalled();
    expect(disconnected).not.toHaveBeenCalled();
    expect(reconnectScheduled).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();

    current.receive({ setupComplete: {} });
    expect(connected).toHaveBeenCalledExactlyOnceWith({ resumed: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stale.terminate).not.toHaveBeenCalled();
    expect(current.terminate).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(2);
  });

  it('disconnect cancels a pending reconnect rather than creating another socket', async () => {
    const socket = await connectSocket();
    socket.serverClose(1006);
    expect(state.reconnectTimer).not.toBeNull();
    expect(state.reconnectAttempts).toBe(1);

    service.disconnect();
    expect(state.reconnectTimer).toBeNull();
    expect(state.reconnectAttempts).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(service.currentStatus).toBe('idle');
    expect(errors).not.toHaveBeenCalled();
  });

  it('treats close 1008 as terminal and clears resumption without reconnecting', async () => {
    const socket = await connectSocket();
    socket.open();
    socket.receive({ setupComplete: {} });
    socket.receive({ sessionResumptionUpdate: { resumable: true, newHandle: 'rejected-handle' } });
    socket.serverClose(1008, 'invalid session');

    expect(disconnected).toHaveBeenCalledExactlyOnceWith({ code: 1008, reason: 'invalid session' });
    expect(service.currentStatus).toBe('error');
    expect(state.socket).toBeNull();
    expect(state.isSetupComplete).toBe(false);
    expect(state.resumeHandle).toBeNull();
    expect(state.setupTimer).toBeNull();
    expect(state.reconnectTimer).toBeNull();
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'Gemini rejected the session (1008): invalid session',
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconnectScheduled).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
  });

  it('waits for close 1000 after goAway, then reconnects with the saved handle', async () => {
    const socket = await connectSocket();
    socket.open();
    socket.receive({ setupComplete: {} });
    socket.receive({
      sessionResumptionUpdate: { resumable: true, newHandle: 'resume-after-go-away' },
    });
    const goAway = vi.fn();
    service.on('session-go-away', goAway);
    socket.receive({ goAway: { timeLeft: '1s' } });
    expect(goAway).toHaveBeenCalledExactlyOnceWith({ timeLeft: '1s' });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(reconnectScheduled).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(service.currentStatus).toBe('listening');
    expect(state.socket).toBe(socket);

    socket.serverClose(1000, 'server rotation');
    expect(service.currentStatus).toBe('connecting');
    expect(reconnectScheduled).toHaveBeenCalledExactlyOnceWith({ attempt: 1, delayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    const retry = sockets[1]!;
    retry.open();
    expect(sent(retry)[0].setup.sessionResumption).toEqual({ handle: 'resume-after-go-away' });
    retry.receive({ setupComplete: {} });
    expect(connected).toHaveBeenLastCalledWith({ resumed: true });

    // goAway belongs to the old transport, not every later normal close.
    retry.serverClose(1000);
    expect(service.currentStatus).toBe('closed');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reconnectScheduled).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([undefined, 'must-not-be-saved'])(
    'clears a revoked resumption handle even when newHandle is %s',
    async (newHandle) => {
      const socket = await connectSocket();
      socket.open();
      socket.receive({ setupComplete: {} });
      const resumptionUpdated = vi.fn();
      service.on('session-resumption-update', resumptionUpdated);
      socket.receive({ sessionResumptionUpdate: { resumable: true, newHandle: 'valid-handle' } });
      expect(state.resumeHandle).toBe('valid-handle');
      expect(resumptionUpdated).toHaveBeenCalledExactlyOnceWith({
        handle: 'valid-handle',
        resumable: true,
      });

      socket.receive({ sessionResumptionUpdate: { resumable: false, newHandle } });
      expect(state.resumeHandle).toBeNull();
      expect(resumptionUpdated).toHaveBeenCalledTimes(1);
      const retry = await reconnectAfterDrop(socket);
      retry.open();
      expect(sent(retry)[0].setup.sessionResumption).toEqual({});
      retry.receive({ setupComplete: {} });
      expect(connected).toHaveBeenLastCalledWith({ resumed: false });
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it('does not duplicate a socket or extend its deadline when connect repeats while CONNECTING', async () => {
    const socket = await connectSocket();
    const deadline = state.setupTimer;
    expect(socket.readyState).toBe(WebSocket.CONNECTING);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await Promise.all([service.connect(), service.connect()])).toEqual([true, true]);
    expect(sockets).toHaveLength(1);
    expect(state.socket).toBe(socket);
    expect(state.setupTimer).toBe(deadline);
    expect(socket.send).not.toHaveBeenCalled();
    expect(service.currentStatus).toBe('connecting');

    await vi.advanceTimersByTimeAsync(9_999);
    expect(socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('within 15 seconds'));
    expect(sockets).toHaveLength(1);
  });
});
