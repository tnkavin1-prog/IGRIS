import { describe, expect, it } from 'vitest';
import { isTrustedHudIpcEvent } from '../../../apps/desktop-hud/src/main/ipc-security.js';

function context(url = 'file:///C:/Program%20Files/IGRIS/index.html') {
  const mainFrame = { url };
  const sender = { getURL: () => url, mainFrame };
  return { mainFrame, sender, event: { sender, senderFrame: mainFrame } };
}

describe('trusted HUD IPC sender validation', () => {
  it('accepts only the active HUD webContents main frame on its local file page', () => {
    const ctx = context();
    expect(isTrustedHudIpcEvent(ctx.event as never, ctx.sender as never)).toBe(true);
  });

  it('rejects a different webContents even when it loads the same local page', () => {
    const ctx = context();
    const foreign = { getURL: ctx.sender.getURL, mainFrame: ctx.mainFrame };
    expect(
      isTrustedHudIpcEvent({ ...ctx.event, sender: foreign } as never, ctx.sender as never),
    ).toBe(false);
  });

  it('rejects a child frame from the trusted webContents', () => {
    const ctx = context();
    const childFrame = { url: ctx.mainFrame.url };
    expect(
      isTrustedHudIpcEvent({ ...ctx.event, senderFrame: childFrame } as never, ctx.sender as never),
    ).toBe(false);
  });

  it.each([
    'https://example.com/app',
    'data:text/html,hello',
    'about:blank',
    'file://remote-host/app',
  ])('rejects an untrusted URL: %s', (url) => {
    const ctx = context(url);
    expect(isTrustedHudIpcEvent(ctx.event as never, ctx.sender as never)).toBe(false);
  });

  it('fails closed when the frame, sender or expected webContents is missing', () => {
    const ctx = context();
    expect(isTrustedHudIpcEvent({ sender: ctx.sender } as never, ctx.sender as never)).toBe(false);
    expect(isTrustedHudIpcEvent(ctx.event as never, null as never)).toBe(false);
    expect(
      isTrustedHudIpcEvent({ sender: null, senderFrame: null } as never, ctx.sender as never),
    ).toBe(false);
  });
});
