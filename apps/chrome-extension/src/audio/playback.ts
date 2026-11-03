/**
 * 24 kHz PCM playback through an AudioWorklet ring buffer.
 *
 * Why a worklet instead of scheduled AudioBufferSourceNodes:
 *   - barge-in can discard buffered audio in one message,
 *   - no scheduling drift or audible seams between chunks,
 *   - the buffered duration is observable, so latency can stay bounded.
 */
import { AUDIO_OUTPUT_RATE } from '@gbl/shared';
import { base64ToInt16, pcm16ToFloat } from './pcm.js';
import { StreamingResampler } from './resampler.js';

export interface PlaybackOptions {
  volume?: number;
  outputDeviceId?: string | null;
}

export class PcmPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private resampler: StreamingResampler | null = null;
  private volume = 0.9;
  private ready = false;
  private flushing = false;

  onLevel: ((level: number, bufferedMs: number) => void) | null = null;
  onUnderrun: (() => void) | null = null;

  get isReady(): boolean {
    return this.ready;
  }

  async init(options: PlaybackOptions = {}): Promise<void> {
    if (this.ready) return;
    this.volume = Math.min(Math.max(options.volume ?? 0.9, 0), 1);

    const context = new AudioContext({
      sampleRate: AUDIO_OUTPUT_RATE,
      latencyHint: 'interactive',
    });
    this.context = context;
    await context.resume();

    const workletUrl = chrome.runtime.getURL('audio/worklet-playback.js');
    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (error) {
      await context.close().catch(() => undefined);
      this.context = null;
      throw new Error(`Audio playback module failed to load: ${(error as Error).message}`, {
        cause: error,
      });
    }

    this.node = new AudioWorkletNode(context, 'gbl-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.gain = context.createGain();
    this.gain.gain.value = this.volume;
    this.node.connect(this.gain);
    this.gain.connect(context.destination);

    this.node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        value?: number;
        bufferedMs?: number;
      };
      if (data?.type === 'level') {
        this.onLevel?.(Number(data.value ?? 0), Number(data.bufferedMs ?? 0));
      } else if (data?.type === 'underrun') {
        this.onUnderrun?.();
      }
    };

    this.resampler =
      context.sampleRate === AUDIO_OUTPUT_RATE
        ? null
        : new StreamingResampler(AUDIO_OUTPUT_RATE, context.sampleRate);
    this.ready = true;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.gain) this.gain.gain.value = this.volume;
  }

  setOutputDevice(deviceId: string | null): void {
    // setSinkId is not available on all platforms; Chrome supports it on
    // AudioContext since 110. Failure is non-fatal (system default output).
    const context = this.context as
      (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (context?.setSinkId && deviceId) {
      void context.setSinkId(deviceId).catch(() => undefined);
    }
  }

  enqueueBase64(base64: string): void {
    if (!base64 || !this.ready) return;
    const pcm = base64ToInt16(base64);
    if (pcm.length === 0) return;
    this.enqueueFloat(pcm16ToFloat(pcm));
  }

  enqueueFloat(samples: Float32Array): void {
    if (!this.node || !this.ready || samples.length === 0) return;
    const resampled = this.resampler ? this.resampler.process(samples) : samples;
    if (resampled.length === 0) return;
    const copy = new Float32Array(resampled.length);
    copy.set(resampled);
    this.node.port.postMessage({ type: 'push', samples: copy }, [copy.buffer]);
  }

  /** Barge-in: discard everything buffered and currently sounding. */
  flush(): void {
    if (!this.node || !this.ready) return;
    this.flushing = true;
    this.resampler?.reset();
    this.node.port.postMessage({ type: 'flush' });
    // The flag clears on the next level message; it only prevents a queued
    // underrun notification from flashing the UI.
    queueMicrotask(() => {
      this.flushing = false;
    });
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  async close(): Promise<void> {
    this.ready = false;
    try {
      this.node?.port.close();
      this.node?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node = null;
    this.gain = null;
    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.resampler = null;
  }

  get bufferedHint(): boolean {
    return this.flushing;
  }
}

/** Short, pleasant session cues generated with an oscillator (no assets). */
export async function playCue(
  kind: 'start' | 'stop' | 'error',
  context?: AudioContext,
): Promise<void> {
  const ctx = context ?? new AudioContext();
  try {
    await ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const base = kind === 'start' ? 660 : kind === 'stop' ? 440 : 220;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * (kind === 'error' ? 0.6 : 1.25), now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } finally {
    if (!context) {
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, 300);
    }
  }
}
