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
  private scriptNode: ScriptProcessorNode | null = null;
  private resampler: StreamingResampler | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isCapturing = false;
  private onChunkCallback: ((base64Pcm: string) => void) | null = null;

  constructor(onChunk?: (base64Pcm: string) => void) {
    if (onChunk) this.onChunkCallback = onChunk;
  }

  public setOnChunk(fn: (base64Pcm: string) => void): void {
    this.onChunkCallback = fn;
  }

  public async startCapture(): Promise<boolean> {
    if (this.isCapturing) return true;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Try 16000 Hz AudioContext; if sound driver rejects it, use hardware rate with resampler
      try {
        this.audioCtxIn = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
        });
      } catch {
        this.audioCtxIn = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const inRate = this.audioCtxIn.sampleRate;
      this.resampler = inRate === 16000 ? null : new StreamingResampler(inRate, 16000);

      const source = this.audioCtxIn.createMediaStreamSource(this.micStream);
      // Buffer size 1024 or 2048 provides ~64ms low-latency frames
      const bufferSize = inRate >= 44100 ? 2048 : 1024;
      this.scriptNode = this.audioCtxIn.createScriptProcessor(bufferSize, 1, 1);

      this.scriptNode.onaudioprocess = (e) => {
        if (!this.isCapturing) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const resampled = this.resampler ? this.resampler.process(inputData) : inputData;
        if (resampled.length === 0) return;
        const pcm16 = this.float32ToInt16(resampled);
        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        if (this.onChunkCallback) {
          this.onChunkCallback(base64);
        }
      };

      source.connect(this.scriptNode);
      this.scriptNode.connect(this.audioCtxIn.destination);

      this.isCapturing = true;
      return true;
    } catch (err) {
      console.error('[AudioController] Failed to start microphone capture:', err);
      return false;
    }
  }

  public stopCapture(): void {
    this.isCapturing = false;
    if (this.resampler) {
      this.resampler.reset();
      this.resampler = null;
    }
    if (this.scriptNode) {
      try {
        this.scriptNode.disconnect();
      } catch {}
      this.scriptNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtxIn) {
      try {
        void this.audioCtxIn.close();
      } catch {}
      this.audioCtxIn = null;
    }
  }

  public playChunk(base64Pcm: string): void {
    if (!this.audioCtxOut) {
      try {
        this.audioCtxOut = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
      } catch {
        this.audioCtxOut = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      this.nextPlayTime = this.audioCtxOut.currentTime;
    }

    if (this.audioCtxOut.state === 'suspended') {
      void this.audioCtxOut.resume();
    }

    try {
      const arrayBuffer = this.base64ToArrayBuffer(base64Pcm);
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        const val = int16Array[i] ?? 0;
        float32Array[i] = val / 32768;
      }

      const audioBuffer = this.audioCtxOut.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioCtxOut.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioCtxOut.destination);

      const now = this.audioCtxOut.currentTime;
      const startTime = Math.max(now, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;

      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
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
