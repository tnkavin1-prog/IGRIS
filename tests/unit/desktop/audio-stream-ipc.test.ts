import { describe, expect, it, vi } from 'vitest';
import {
  createAudioStreamHandler,
  isTrustedAudioStreamEvent,
  isValidAudioChunkPayload,
} from '../../../apps/desktop-hud/src/main/audio-stream-ipc.js';

const trustedUrl = 'file:///E:/Gematron/apps/desktop-hud/dist/index.html';

function createEvent(url = trustedUrl) {
  const mainFrame = { url };
  const sender = { mainFrame };
  return { sender, senderFrame: mainFrame };
}

describe('trusted Gemini audio stream IPC', () => {
  it('accepts continuous trusted audio packets without the invoke-channel rate limiter', () => {
    const event = createEvent();
    const sendAudioChunk = vi.fn();
    const handler = createAudioStreamHandler({
      getTrustedSender: () => event.sender,
      trustedUrl,
      sendAudioChunk,
    });

    for (let index = 0; index < 1_500; index += 1) {
      handler(event, 'AQIDBA==');
    }

    expect(sendAudioChunk).toHaveBeenCalledTimes(1_500);
    expect(sendAudioChunk).toHaveBeenLastCalledWith('AQIDBA==');
  });

  it('rejects a different WebContents even when it loads the same local file', () => {
    const trusted = createEvent();
    const foreign = createEvent();
    const sendAudioChunk = vi.fn();
    const onRejected = vi.fn();
    const handler = createAudioStreamHandler({
      getTrustedSender: () => trusted.sender,
      trustedUrl,
      sendAudioChunk,
      onRejected,
    });

    handler(foreign, 'AQIDBA==');

    expect(sendAudioChunk).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith('untrusted-sender');
  });

  it('rejects subframes and non-local or different file URLs', () => {
    const trusted = createEvent();
    const foreignOrigin = createEvent('https://example.com/index.html');
    const differentFile = createEvent('file:///E:/Gematron/other.html');
    const childFrame = { url: trustedUrl };
    const childEvent = { sender: trusted.sender, senderFrame: childFrame };

    expect(isTrustedAudioStreamEvent(foreignOrigin, trusted.sender, trustedUrl)).toBe(false);
    expect(isTrustedAudioStreamEvent(differentFile, trusted.sender, trustedUrl)).toBe(false);
    expect(isTrustedAudioStreamEvent(childEvent, trusted.sender, trustedUrl)).toBe(false);
    expect(isTrustedAudioStreamEvent(trusted, trusted.sender, trustedUrl)).toBe(true);
  });

  it('rejects malformed, empty, non-string, and oversized PCM payloads', () => {
    expect(isValidAudioChunkPayload('AQIDBA==')).toBe(true);
    expect(isValidAudioChunkPayload('')).toBe(false);
    expect(isValidAudioChunkPayload(null)).toBe(false);
    expect(isValidAudioChunkPayload('not base64!')).toBe(false);
    expect(isValidAudioChunkPayload('AQID')).toBe(true);
    expect(isValidAudioChunkPayload('A'.repeat(64 * 1024 + 4))).toBe(false);
  });

  it('does not forward invalid payloads from an otherwise trusted sender', () => {
    const event = createEvent();
    const sendAudioChunk = vi.fn();
    const onRejected = vi.fn();
    const handler = createAudioStreamHandler({
      getTrustedSender: () => event.sender,
      trustedUrl,
      sendAudioChunk,
      onRejected,
    });

    handler(event, 'not base64!');

    expect(sendAudioChunk).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith('invalid-payload');
  });
});
