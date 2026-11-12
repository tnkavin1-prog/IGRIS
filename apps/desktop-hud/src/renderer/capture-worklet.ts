declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

// Batches 128-frame render quanta into ~64 ms chunks so the renderer forwards ~16 frames/s over IPC.
class HudCaptureProcessor extends AudioWorkletProcessor {
  private readonly size = Math.round(sampleRate / 16);
  private chunk = new Float32Array(this.size);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.size - this.filled);
      this.chunk.set(channel.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled === this.size) {
        const full = this.chunk;
        this.chunk = new Float32Array(this.size);
        this.filled = 0;
        this.port.postMessage(full, [full.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('hud-capture', HudCaptureProcessor);

export {};
