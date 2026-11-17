/**
 * Trusted, high-frequency PCM ingress for Gemini Live.
 *
 * AudioWorklet packets are realtime stream data, not discrete privileged
 * commands. They must not use the invoke-channel request limiter or create
 * one renderer promise per audio frame.
 */
export interface AudioStreamFrame {
  url: string;
}

export interface AudioStreamContents {
  mainFrame?: AudioStreamFrame;
}

export interface AudioStreamEvent {
  sender: AudioStreamContents;
  senderFrame?: AudioStreamFrame | null;
}

export interface AudioStreamHandlerOptions {
  getTrustedSender: () => AudioStreamContents | null;
  trustedUrl: string;
  sendAudioChunk: (base64Pcm: string) => void;
  onRejected?: (reason: 'untrusted-sender' | 'invalid-payload') => void;
}

const MAX_AUDIO_CHUNK_BASE64_CHARS = 64 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isValidAudioChunkPayload(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AUDIO_CHUNK_BASE64_CHARS &&
    value.length % 4 === 0 &&
    BASE64_PATTERN.test(value)
  );
}

export function isTrustedAudioStreamEvent(
  event: AudioStreamEvent,
  trustedSender: AudioStreamContents | null,
  trustedUrl: string,
): boolean {
  if (!trustedSender || event.sender !== trustedSender) return false;
  const mainFrame = trustedSender.mainFrame;
  if (!mainFrame || !event.senderFrame || event.senderFrame !== mainFrame) return false;

  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(trustedUrl);
    return (
      actual.protocol === 'file:' &&
      expected.protocol === 'file:' &&
      actual.href === expected.href
    );
  } catch {
    return false;
  }
}

/**
 * Returns an event listener that accepts packets only from the current HUD
 * main frame. It deliberately has no per-packet rate limit: PCM audio is a
 * continuous stream. The strict payload cap prevents abuse of that exception.
 */
export function createAudioStreamHandler(options: AudioStreamHandlerOptions) {
  return (event: AudioStreamEvent, payload: unknown): void => {
    if (!isTrustedAudioStreamEvent(event, options.getTrustedSender(), options.trustedUrl)) {
      options.onRejected?.('untrusted-sender');
      return;
    }
    if (!isValidAudioChunkPayload(payload)) {
      options.onRejected?.('invalid-payload');
      return;
    }
    options.sendAudioChunk(payload);
  };
}
