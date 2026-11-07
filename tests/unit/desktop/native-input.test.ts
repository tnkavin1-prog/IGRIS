import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NativeInputService } from '../../../apps/desktop-hud/src/main/native-input.js';

describe('NativeInputService', () => {
  let input: NativeInputService;

  beforeEach(() => {
    input = new NativeInputService({ mockMode: true });
  });

  it('moves cursor and updates position tracking', async () => {
    const moved = await input.mouseMove(450, 320);
    expect(moved).toBe(true);

    const pos = await input.getCursorPosition();
    expect(pos).toEqual({ x: 450, y: 320 });

    const last = input.getLastAction();
    expect(last?.type).toBe('move');
    expect(last?.x).toBe(450);
    expect(last?.y).toBe(320);
  });

  it('performs mouse click with options and emits action event', async () => {
    const actionListener = vi.fn();
    input.on('action', actionListener);

    const clicked = await input.mouseClick(800, 600, { button: 'right', double: true });
    expect(clicked).toBe(true);
    expect(actionListener).toHaveBeenCalledTimes(1);

    const last = input.getLastAction();
    expect(last?.type).toBe('click');
    expect(last?.button).toBe('right');
    expect(last?.double).toBe(true);
    expect(last?.x).toBe(800);
    expect(last?.y).toBe(600);
  });

  it('simulates mouse drag between two coordinates', async () => {
    const dragged = await input.mouseDrag(100, 100, 500, 500, 5);
    expect(dragged).toBe(true);

    const pos = await input.getCursorPosition();
    expect(pos).toEqual({ x: 500, y: 500 });
  });

  it('simulates vertical scroll', async () => {
    const scrolled = await input.mouseScroll(-120);
    expect(scrolled).toBe(true);

    const last = input.getLastAction();
    expect(last?.type).toBe('scroll');
  });

  it('types text into focused application', async () => {
    const typed = await input.typeText('Hello Jarvis autonomous agent!');
    expect(typed).toBe(true);

    const last = input.getLastAction();
    expect(last?.type).toBe('type');
    expect(last?.text).toBe('Hello Jarvis autonomous agent!');
  });

  it('types multiline text and complex symbols without errors', async () => {
    const complexText =
      'Line 1: Special symbols: @#$%^&*()\nLine 2: "Quotes" & apostrophe\'s\nLine 3: \tIndented line\n';
    const typed = await input.typeText(complexText);
    expect(typed).toBe(true);

    const last = input.getLastAction();
    expect(last?.type).toBe('type');
    expect(last?.text).toBe(complexText);
  });

  it('sends keyboard hotkey chord from string and array', async () => {
    const chord1 = await input.sendHotkey('Ctrl+Shift+Escape');
    expect(chord1).toBe(true);
    expect(input.getLastAction()?.keys).toBe('Ctrl+Shift+Escape');

    const chord2 = await input.sendHotkey(['Control', 'c']);
    expect(chord2).toBe(true);
    expect(input.getLastAction()?.keys).toBe('Control+c');
  });

  it('tracks history and allows clearing', async () => {
    await input.mouseMove(10, 20);
    await input.mouseClick(10, 20);
    await input.typeText('test');

    expect(input.getHistory().length).toBe(3);
    input.clearHistory();
    expect(input.getHistory().length).toBe(0);
  });
});
