/**
 * Capture worklet: forwards mono float frames to the side panel.
 * Running in the audio thread keeps the UI thread free while the model speaks.
 */
class GblCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage({ type: 'samples', samples: copy }, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('gbl-capture', GblCaptureProcessor);
