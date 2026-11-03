/**
 * Microphone capture pipeline.
 *
 * getUserMedia → AudioWorklet → (optional resample) → 32 ms PCM16 frames →
 * base64 for the Live `realtimeInput.audio` field.
 *
 * Local voice-activity detection is used for two things only: the UI's speaking
 * indicator and barge-in (flushing queued playback). Server-side VAD remains
 * authoritative for turn boundaries, so we never send a premature
 * `audioStreamEnd`.
 */
import { AUDIO_FRAME_MS, AUDIO_INPUT_FRAME_SAMPLES, AUDIO_INPUT_RATE } from '@gbl/shared';
import { floatToPcm16, int16ToBase64, rms } from './pcm.js';
import { StreamingResampler } from './resampler.js';

export interface CaptureCallbacks {
  onChunk: (base64: string, info: { rms: number; speaking: boolean }) => void;
  onLevel: (rms: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (error: Error) => void;
}

export interface CaptureOptions {
  deviceId?: string | null;
  gain: number;
  silenceMs: number;
}

const VAD_THRESHOLD = 0.014;
const MIN_SPEECH_MS = 90;

function frameSamples(): number {
  return AUDIO_INPUT_FRAME_SAMPLES;
}

export class MicrophoneCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private resampler: StreamingResampler | null = null;
  private pending = new Float32Array(0);
  private speaking = false;
  private voiceStartedAt = 0;
  private lastVoiceAt = 0;
  private muted = false;
  private gain = 1;
  private silenceMs = 600;
  private callbacks: CaptureCallbacks | null = null;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setGain(gain: number): void {
    this.gain = Math.min(Math.max(gain, 0.1), 3);
  }

  setSilenceMs(ms: number): void {
    this.silenceMs = Math.min(Math.max(ms, 250), 2_000);
  }

  async start(options: CaptureOptions, callbacks: CaptureCallbacks): Promise<void> {
    if (this.running) return;
    this.callbacks = callbacks;
    this.gain = Math.min(Math.max(options.gain, 0.1), 3);
    this.silenceMs = Math.min(Math.max(options.silenceMs, 250), 2_000);
    this.muted = false;
    this.speaking = false;
    this.pending = new Float32Array(0);

    const constraints: MediaStreamConstraints = {
      audio: {
        ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const name = (error as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error(
          'Microphone access was denied. Allow it in Chrome site settings for the extension.',
          { cause: error },
        );
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error(
          'No usable microphone was found. Choose a different input device in Settings.',
          { cause: error },
        );
      }
      throw new Error(`Could not open the microphone: ${(error as Error).message}`, {
        cause: error,
      });
    }

    this.stream = stream;
    const context = new AudioContext({
      sampleRate: AUDIO_INPUT_RATE,
      latencyHint: 'interactive',
    });
    this.context = context;
    await context.resume();

    const workletUrl = chrome.runtime.getURL('audio/worklet-capture.js');
    try {
      await context.audioWorklet.addModule(workletUrl);
    } catch (error) {
      this.cleanup();
      throw new Error(`Audio capture module failed to load: ${(error as Error).message}`, {
        cause: error,
      });
    }

    this.resampler =
      context.sampleRate === AUDIO_INPUT_RATE
        ? null
        : new StreamingResampler(context.sampleRate, AUDIO_INPUT_RATE);

    this.source = context.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(context, 'gbl-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.sink = context.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(context.destination);

    this.node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; samples?: Float32Array };
      if (data?.type !== 'samples' || !(data.samples instanceof Float32Array)) return;
      try {
        this.processSamples(data.samples);
      } catch (error) {
        this.callbacks?.onError(error as Error);
      }
    };

    this.node.onprocessorerror = () => {
      this.callbacks?.onError(new Error('The audio capture processor stopped unexpectedly.'));
    };

    this.running = true;
  }

  private processSamples(input: Float32Array): void {
    const resampled = this.resampler ? this.resampler.process(input) : input;
    if (resampled.length === 0) return;

    const gained = new Float32Array(resampled.length);
    for (let i = 0; i < resampled.length; i += 1) {
      const value = (resampled[i] ?? 0) * this.gain;
      gained[i] = value > 1 ? 1 : value < -1 ? -1 : value;
    }

    const level = rms(gained);
    this.callbacks?.onLevel(level);
    this.updateVoiceActivity(level);

    if (this.pending.length === 0) {
      this.pending = gained;
    } else {
      const merged = new Float32Array(this.pending.length + gained.length);
      merged.set(this.pending, 0);
      merged.set(gained, this.pending.length);
      this.pending = merged;
    }

    const size = frameSamples();
    while (this.pending.length >= size) {
      const frame = this.pending.slice(0, size);
      this.pending = this.pending.slice(size);
      if (!this.muted) {
        const pcm = floatToPcm16(frame);
        this.callbacks?.onChunk(int16ToBase64(pcm), {
          rms: level,
          speaking: this.speaking,
        });
      }
    }
  }

  private updateVoiceActivity(level: number): void {
    const now = performance.now();
    if (level >= VAD_THRESHOLD) {
      this.lastVoiceAt = now;
      if (!this.speaking) {
        this.speaking = true;
        this.voiceStartedAt = now;
        this.callbacks?.onSpeechStart();
      }
      return;
    }
    if (!this.speaking) return;
    if (now - this.voiceStartedAt < MIN_SPEECH_MS) return;
    if (now - this.lastVoiceAt >= this.silenceMs) {
      this.speaking = false;
      this.callbacks?.onSpeechEnd();
    }
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  private cleanup(): void {
    try {
      this.node?.port.close();
      this.node?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined);
    }
    this.node = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.context = null;
    this.resampler = null;
    this.pending = new Float32Array(0);
    this.speaking = false;
  }
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

export async function listAudioOutputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audiooutput');
}

export const AUDIO_FRAME_INFO = {
  frameMs: AUDIO_FRAME_MS,
  sampleRate: AUDIO_INPUT_RATE,
  samplesPerFrame: AUDIO_INPUT_FRAME_SAMPLES,
} as const;
