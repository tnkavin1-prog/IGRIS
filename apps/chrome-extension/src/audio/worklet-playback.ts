/**
 * Playback worklet: a bounded ring buffer with instant flush.
 *
 * Instant flush is what makes barge-in feel responsive: when the user starts
 * speaking, the side panel posts `flush` and every buffered sample disappears
 * on the next audio quantum instead of finishing the sentence.
 */
const MAX_SECONDS = 2;
const TARGET_BUFFER_SECONDS = 0.45;

class GblPlaybackProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(Math.ceil(sampleRate * MAX_SECONDS));
  private readIndex = 0;
  private writeIndex = 0;
  private count = 0;
  private underrunReported = false;
  private levelAccumulator = 0;
  private levelBlocks = 0;
  private flushGeneration = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        { type: 'push'; samples: Float32Array } | { type: 'flush' } | { type: 'generation' };
      if (!data) return;
      if (data.type === 'push') this.push(data.samples);
      else if (data.type === 'flush') this.flush();
      else if (data.type === 'generation') this.flushGeneration += 1;
    };
  }

  private push(samples: Float32Array): void {
    if (samples.length === 0) return;
    const target = Math.ceil(sampleRate * TARGET_BUFFER_SECONDS);
    // Keep latency bounded: if the model bursts faster than real time, drop the
    // oldest audio rather than drifting further behind.
    if (this.count + samples.length > target) {
      const drop = Math.min(this.count, this.count + samples.length - target);
      this.advanceRead(drop);
    }

    for (let i = 0; i < samples.length; i += 1) {
      if (this.count >= this.buffer.length) {
        this.advanceRead(1);
      }
      this.buffer[this.writeIndex] = samples[i] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.count += 1;
    }
    this.underrunReported = false;
  }

  private advanceRead(amount: number): void {
    const drop = Math.min(amount, this.count);
    this.readIndex = (this.readIndex + drop) % this.buffer.length;
    this.count -= drop;
  }

  private flush(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.count = 0;
    this.underrunReported = false;
    this.levelAccumulator = 0;
    this.levelBlocks = 0;
    this.flushGeneration += 1;
    this.port.postMessage({ type: 'flushed', generation: this.flushGeneration });
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;

    let sum = 0;
    for (let i = 0; i < output.length; i += 1) {
      let sample = 0;
      if (this.count > 0) {
        sample = this.buffer[this.readIndex] ?? 0;
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
        this.count -= 1;
      } else if (!this.underrunReported) {
        this.underrunReported = true;
        this.port.postMessage({ type: 'underrun' });
      }
      output[i] = sample;
      sum += sample * sample;
    }

    // Duplicate to any additional channels (normally mono).
    for (let channel = 1; channel < (outputs[0]?.length ?? 0); channel += 1) {
      outputs[0]?.[channel]?.set(output);
    }

    this.levelAccumulator += Math.sqrt(sum / output.length);
    this.levelBlocks += 1;
    if (this.levelBlocks >= 4) {
      this.port.postMessage({
        type: 'level',
        value: this.levelAccumulator / this.levelBlocks,
        bufferedMs: Math.round((this.count / sampleRate) * 1000),
      });
      this.levelAccumulator = 0;
      this.levelBlocks = 0;
    }
    return true;
  }
}

registerProcessor('gbl-playback', GblPlaybackProcessor);
