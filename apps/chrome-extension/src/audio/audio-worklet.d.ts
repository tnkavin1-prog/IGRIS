/**
 * Minimal AudioWorklet global declarations.
 * TypeScript's DOM lib does not include the AudioWorkletGlobalScope.
 */
declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
