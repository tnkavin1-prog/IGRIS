/**
 * Real-time bidirectional Web Audio controller for Gemini Live:
 * - Captures mic audio at 16kHz PCM (mono, 16-bit little-endian) and emits base64 frames.
 * - Plays back incoming 24kHz PCM chunks sequentially with gapless scheduling.
 * - Supports instant cancellation / interruption clearing.
 */

class StreamingResampler {
  private carry = new Float32Array(0);
  private readPosition = 0;

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {}

  get passthrough(): boolean {
    return this.fromRate === this.toRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.passthrough) return input;
    if (input.length === 0) return new Float32Array(0);

    const combined = new Float32Array(this.carry.length + input.length);
    combined.set(this.carry, 0);
    combined.set(input, this.carry.length);

    const ratio = this.fromRate / this.toRate;
    const available = combined.length;
    const outputLength = Math.max(0, Math.floor((available - 1 - this.readPosition) / ratio));
    const out = new Float32Array(outputLength);
    let position = this.readPosition;
    for (let i = 0; i < outputLength; i += 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      const a = combined[index] ?? 0;
      const b = combined[index + 1] ?? a;
      out[i] = a + (b - a) * fraction;
      position += ratio;
    }

    const consumed = Math.floor(position);
    this.carry = combined.slice(consumed);
    this.readPosition = position - consumed;
    return out;
  }

  reset(): void {
    this.carry = new Float32Array(0);
    this.readPosition = 0;
  }
}

export class AudioController {
  private micStream: MediaStream | null = null;
  private audioCtxIn: AudioContext | null = null;
  private audioCtxOut: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private resampler: StreamingResampler | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private outputGain: GainNode | null = null;
  private outputVolume = 0.5;
  private outputMuted = false;
  private isCapturing = false;
  private captureGeneration = 0;
  private captureStart: Promise<boolean> | null = null;
  public lastError: string | null = null;
  public onError: ((message: string) => void) | null = null;
  private onChunkCallback: ((base64Pcm: string) => void) | null = null;

  constructor(onChunk?: (base64Pcm: string) => void) {
    if (onChunk) this.onChunkCallback = onChunk;
  }

  public setOnChunk(fn: (base64Pcm: string) => void): void {
    this.onChunkCallback = fn;
  }

  public startCapture(): Promise<boolean> {
    if (this.isCapturing) return Promise.resolve(true);
    if (this.captureStart) return this.captureStart;
    this.lastError = null;
    const generation = this.captureGeneration;
    const pending = this.openCapture(generation).finally(() => {
      if (this.captureStart === pending) this.captureStart = null;
    });
    this.captureStart = pending;
    return pending;
  }

  private async openCapture(generation: number): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (generation !== this.captureGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.micStream = stream;
      // Use the hardware clock; resampling avoids drivers that silently fail at 16 kHz.
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.audioCtxIn = context;
      await context.resume();
      if (generation !== this.captureGeneration) return false;

      const inRate = context.sampleRate;
      this.resampler = inRate === 16000 ? null : new StreamingResampler(inRate, 16000);

      await context.audioWorklet.addModule(new URL('./capture-worklet.js', document.baseURI).href);
      if (generation !== this.captureGeneration) return false;

      const source = context.createMediaStreamSource(stream);
      this.captureNode = new AudioWorkletNode(this.audioCtxIn, 'hud-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.captureNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.isCapturing) return;
        const resampled = this.resampler ? this.resampler.process(e.data) : e.data;
        if (resampled.length === 0) return;

        const pcm16 = this.float32ToInt16(resampled);
        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        if (this.onChunkCallback) {
          this.onChunkCallback(base64);
        }
      };

      // Chromium only pulls worklets that reach the destination; the muted sink keeps it live silently.
      const sink = this.audioCtxIn.createGain();
      sink.gain.value = 0;
      source.connect(this.captureNode);
      this.captureNode.connect(sink);
      sink.connect(this.audioCtxIn.destination);

      const reportFailure = (message: string) => {
        if (generation !== this.captureGeneration) return;
        this.lastError = message;
        this.stopCapture();
        this.onError?.(message);
      };
      this.captureNode.onprocessorerror = () =>
        reportFailure('Microphone processing stopped. Restart the voice session.');
      stream.getTracks().forEach((track) => {
        track.onended = () =>
          reportFailure('Microphone disconnected. Check your input device and restart.');
      });
      this.isCapturing = true;
      return true;
    } catch (err) {
      if (generation !== this.captureGeneration) return false;
      const name = err instanceof Error ? err.name : '';
      this.lastError =
        name === 'NotAllowedError'
          ? 'Microphone access denied. Allow microphone access in Windows privacy settings.'
          : name === 'NotFoundError'
            ? 'No microphone found. Connect an input device and restart.'
            : 'Microphone unavailable. Check the Windows input device and restart.';
      console.error('[AudioController] Failed to start microphone capture:', err);
      this.stopCapture();
      return false;
    }
  }

  public stopCapture(): void {
    this.captureGeneration++;
    this.captureStart = null;
    this.isCapturing = false;
    if (this.resampler) {
      this.resampler.reset();
      this.resampler = null;
    }
    if (this.captureNode) {
      try {
        this.captureNode.port.onmessage = null;
        this.captureNode.onprocessorerror = null;
        this.captureNode.disconnect();
      } catch {}
      this.captureNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.micStream = null;
    }
    if (this.audioCtxIn) {
      try {
        void this.audioCtxIn.close().catch(() => undefined);
      } catch {}
      this.audioCtxIn = null;
    }
  }

  public async unlock(): Promise<boolean> {
    const context = this.ensurePlaybackContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch (err) {
      console.error('[AudioController] Failed to unlock audio playback:', err);
      return false;
    }
  }

  public setVolume(volume: number): void {
    this.outputVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
    this.updateOutputGain();
  }

  public setMuted(muted: boolean): void {
    this.outputMuted = muted;
    this.updateOutputGain();
  }

  private updateOutputGain(): void {
    if (!this.outputGain || !this.audioCtxOut) return;
    this.outputGain.gain.setValueAtTime(
      this.outputMuted ? 0 : this.outputVolume,
      this.audioCtxOut.currentTime,
    );
  }

  private ensurePlaybackContext(): AudioContext | null {
    if (this.audioCtxOut && this.audioCtxOut.state !== 'closed') return this.audioCtxOut;

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      try {
        this.audioCtxOut = new AudioContextCtor({ sampleRate: 24000 });
      } catch {
        this.audioCtxOut = new AudioContextCtor();
      }
      this.outputGain = this.audioCtxOut.createGain();
      this.outputGain.connect(this.audioCtxOut.destination);
      this.updateOutputGain();
      this.nextPlayTime = this.audioCtxOut.currentTime;
      return this.audioCtxOut;
    } catch (err) {
      console.error('[AudioController] Failed to initialize audio playback:', err);
      this.audioCtxOut = null;
      this.outputGain = null;
      return null;
    }
  }

  public playChunk(base64Pcm: string): void {
    const context = this.ensurePlaybackContext();
    if (!context) return;

    if (context.state === 'suspended') {
      void context.resume().catch((err) => {
        console.error('[AudioController] Failed to resume audio playback:', err);
      });
    }

    try {
      const arrayBuffer = this.base64ToArrayBuffer(base64Pcm);
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        const val = int16Array[i] ?? 0;
        float32Array[i] = val / 32768;
      }

      const audioBuffer = context.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputGain ?? context.destination);

      const now = context.currentTime;
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + 0.02;
      }
      const startTime = Math.max(now, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
        source.disconnect();
      };
    } catch (err) {
      console.error('[AudioController] Error scheduling audio chunk:', err);
    }
  }

  public clearPlayback(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    }
    this.activeSources = [];
    if (this.audioCtxOut) {
      this.nextPlayTime = this.audioCtxOut.currentTime;
    }
  }

  private float32ToInt16(buffer: Float32Array): Int16Array {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const sample = buffer[i] ?? 0;
      const s = Math.max(-1, Math.min(1, sample));
      buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return buf;
  }

  private arrayBufferToBase64(buffer: ArrayBufferLike): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      const b = bytes[i] ?? 0;
      binary += String.fromCharCode(b);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
