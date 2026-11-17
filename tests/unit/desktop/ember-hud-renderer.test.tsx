// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmberHUD, type EmberHUDProps } from '../../../apps/desktop-hud/src/renderer/EmberHUD.js';
import type { HUDSettings } from '../../../apps/desktop-hud/src/main/types.js';

// Canvas animation is unrelated to the settings and session controls under test.
vi.mock('../../../apps/desktop-hud/src/renderer/EmberOrb.js', () => ({
  EmberOrb: () => null,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const settings: HUDSettings = {
  apiKey: '',
  modelId: 'gemini-3.8-live',
  voice: 'Kore',
  autoApprove: false,
  alwaysOnTop: true,
  soundEffectsEnabled: true,
  soundVolume: 0.5,
};

function makeProps(overrides: Partial<EmberHUDProps> = {}): EmberHUDProps {
  return {
    status: 'idle',
    conversation: [],
    settings: { ...settings },
    soundMuted: false,
    soundVolume: 0.5,
    isPinned: true,
    onTogglePin: vi.fn(),
    onMinimize: vi.fn(),
    onClose: vi.fn(),
    onStartSession: vi.fn(),
    onStopSession: vi.fn(),
    onToggleSoundMute: vi.fn(),
    onSoundVolumeChange: vi.fn(),
    onAutoApproveChange: vi.fn(),
    onWakeWordChange: vi.fn(),
    onCollapseToBar: vi.fn(),
    onCollapseToOrb: vi.fn(),
    onOpenConsole: vi.fn(),
    ...overrides,
  };
}

function expectSessionUnchanged(props: EmberHUDProps) {
  expect(props.onStartSession).not.toHaveBeenCalled();
  expect(props.onStopSession).not.toHaveBeenCalled();
}

function expectPressed(button: HTMLButtonElement, pressed: boolean) {
  expect(button.getAttribute('aria-pressed')).toBe(String(pressed));
  expect(button.classList.contains('on')).toBe(pressed);
}

describe('EmberHUD settings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const render = (props: EmberHUDProps) => {
    act(() => {
      root.render(<EmberHUD {...props} />);
    });
  };

  const buttonByLabel = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button, `button labelled ${label}`).not.toBeNull();
    return button!;
  };

  const buttonByText = (text: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(text),
    );
    expect(button, `button containing ${text}`).toBeDefined();
    return button!;
  };

  const click = (button: HTMLButtonElement) => {
    act(() => {
      button.click();
    });
  };

  const openSettings = () => {
    click(buttonByLabel('Open settings'));
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    return dialog!;
  };

  const expectSettingsClosed = () => {
    expect(container.querySelector('dialog')).toBeNull();
    expect(buttonByLabel('Open settings').getAttribute('aria-expanded')).toBe('false');
  };

  it('opens the labelled settings dialog modally from the utility control', () => {
    // Spy on happy-dom's native methods without replacing their behavior.
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const props = makeProps();
    render(props);

    const trigger = buttonByLabel('Open settings');
    expect(container.querySelector('.em-util button')).toBe(trigger);
    expect(container.querySelector('.win-controls')?.contains(trigger)).toBe(false);
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expectSettingsClosed();
    expect(showModal).not.toHaveBeenCalled();

    const dialog = openSettings();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.contexts[0]).toBe(dialog);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
    expect(dialog.querySelector('h2')?.id).toBe(dialog.getAttribute('aria-labelledby'));
    expect(dialog.querySelector('h2')?.textContent).toBe('Settings');
    expectSessionUnchanged(props);
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();
  });

  it('closes only settings, cleans up the modal, and can reopen it', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const props = makeProps({ status: 'listening' });
    render(props);
    const dialog = openSettings();

    click(buttonByLabel('Close settings'));

    expectSettingsClosed();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.contexts[0]).toBe(dialog);
    expect(dialog.open).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onMinimize).not.toHaveBeenCalled();
    expectSessionUnchanged(props);
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();
    expect(openSettings()).not.toBe(dialog);
  });

  it('contains Escape keydown and dismisses settings on the native cancel event', () => {
    const props = makeProps({ status: 'speaking' });
    render(props);
    const dialog = openSettings();
    const outsideKeydown = vi.fn();
    document.addEventListener('keydown', outsideKeydown);

    try {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        buttonByLabel('Close settings').dispatchEvent(escape);
      });
      expect(outsideKeydown).not.toHaveBeenCalled();
      // Do not prevent the browser's default Escape-to-cancel behavior.
      expect(escape.defaultPrevented).toBe(false);

      // Synthetic keydown does not perform native keyboard default actions.
      act(() => {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      });
      expectSettingsClosed();
      expect(dialog.open).toBe(false);
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onAutoApproveChange).not.toHaveBeenCalled();
      expectSessionUnchanged(props);
      openSettings();
    } finally {
      document.removeEventListener('keydown', outsideKeydown);
    }
  });

  it('shows the three window sizes with Full selected and closes settings on Full', () => {
    const props = makeProps({ status: 'listening' });
    render(props);
    const dialog = openSettings();
    const choices = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Window size"] button'),
    );
    expect(choices.map((button) => button.querySelector('span')?.textContent)).toEqual([
      'Full window',
      'Compact bar',
      'Mini orb',
    ]);
    expect(choices.map((button) => button.querySelector('small')?.textContent)).toEqual([
      '400 × 600',
      '420 × 62',
      '74 × 74',
    ]);
    choices.forEach((button, index) => expectPressed(button, index === 0));

    click(buttonByText('Full window'));

    expectSettingsClosed();
    expect(dialog.open).toBe(false);
    expect(props.onCollapseToBar).not.toHaveBeenCalled();
    expect(props.onCollapseToOrb).not.toHaveBeenCalled();
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();
    expectSessionUnchanged(props);
  });

  describe.each([
    ['Compact bar', 'onCollapseToBar', 'onCollapseToOrb'],
    ['Mini orb', 'onCollapseToOrb', 'onCollapseToBar'],
  ] as const)('%s selection', (label, callback, otherCallback) => {
    it.each(['connecting', 'listening', 'speaking', 'thinking'] as const)(
      'requests the size without stopping a %s session',
      (status) => {
        const props = makeProps({ status });
        render(props);
        const dialog = openSettings();
        expect(dialog.textContent).toContain('Live session active');

        click(buttonByText(label));

        expect(props[callback]).toHaveBeenCalledTimes(1);
        expect(props[callback]).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
        expect(props[otherCallback]).not.toHaveBeenCalled();
        expect(props.onMinimize).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(props.onAutoApproveChange).not.toHaveBeenCalled();
        expectSessionUnchanged(props);
        expect(
          container.querySelector('[role="button"][aria-label="Stop session"]'),
        ).not.toBeNull();
      },
    );
  });

  it('keeps automatic approval off when settings are opened, rerendered, or reopened', () => {
    const props = makeProps();
    render(props);
    expect(props.settings.autoApprove).toBe(false);
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();

    openSettings();
    expectPressed(buttonByLabel('Toggle smart approve'), false);
    expectPressed(buttonByLabel('Toggle wake word'), false);
    render({ ...props, status: 'listening', soundVolume: 0.75 });
    expectPressed(buttonByLabel('Toggle smart approve'), false);
    click(buttonByLabel('Close settings'));
    openSettings();

    expectPressed(buttonByLabel('Toggle smart approve'), false);
    expect(props.settings.autoApprove).toBe(false);
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();
    expect(props.onWakeWordChange).not.toHaveBeenCalled();
    expect(props.onTogglePin).not.toHaveBeenCalled();
    expect(props.onToggleSoundMute).not.toHaveBeenCalled();
    expect(props.onSoundVolumeChange).not.toHaveBeenCalled();
    expectSessionUnchanged(props);
  });

  it('uses the controlled pin prop and requests pin changes without mutating it', () => {
    const props = makeProps({ status: 'listening', isPinned: false });
    render(props);
    openSettings();
    const pin = buttonByLabel('Toggle always on top');
    // isPinned, not the persisted alwaysOnTop setting, controls this switch.
    expect(props.settings.alwaysOnTop).toBe(true);
    expectPressed(pin, false);

    click(pin);
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    expect(props.onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
    expectPressed(pin, false);

    render({ ...props, isPinned: true });
    expectPressed(pin, true);
    click(pin);
    expect(props.onTogglePin).toHaveBeenCalledTimes(2);
    expectPressed(pin, true);
    render(props);
    expectPressed(pin, false);
    expectSessionUnchanged(props);
  });

  it('reflects controlled sound mute state without stopping the microphone', () => {
    const props = makeProps({ status: 'listening' });
    render(props);
    openSettings();
    const sound = buttonByLabel('Toggle acoustic sound');
    expectPressed(sound, true);

    click(sound);
    expect(props.onToggleSoundMute).toHaveBeenCalledTimes(1);
    expect(props.onToggleSoundMute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
    );
    expectPressed(sound, true);

    render({ ...props, soundMuted: true });
    expectPressed(sound, false);
    click(sound);
    expect(props.onToggleSoundMute).toHaveBeenCalledTimes(2);
    expectPressed(sound, false);
    render(props);
    expectPressed(sound, true);
    expect(props.onSoundVolumeChange).not.toHaveBeenCalled();
    expectSessionUnchanged(props);
  });

  it.each([undefined, false, true])(
    'requests the inverse wake-word setting from %s and waits for controlled updates',
    (wakeWordEnabled) => {
      const props = makeProps({ settings: { ...settings, wakeWordEnabled } });
      render(props);
      openSettings();
      const wakeWord = buttonByLabel('Toggle wake word');
      expectPressed(wakeWord, wakeWordEnabled === true);

      click(wakeWord);
      expect(props.onWakeWordChange).toHaveBeenCalledTimes(1);
      expect(props.onWakeWordChange).toHaveBeenLastCalledWith(!wakeWordEnabled);
      expectPressed(wakeWord, wakeWordEnabled === true);
      expect(props.settings.wakeWordEnabled).toBe(wakeWordEnabled);

      render({ ...props, settings: { ...props.settings, wakeWordEnabled: !wakeWordEnabled } });
      expectPressed(wakeWord, !wakeWordEnabled);
      click(wakeWord);
      expect(props.onWakeWordChange).toHaveBeenCalledTimes(2);
      expect(props.onWakeWordChange).toHaveBeenLastCalledWith(Boolean(wakeWordEnabled));
      expect(props.onAutoApproveChange).not.toHaveBeenCalled();
      expectSessionUnchanged(props);
    },
  );

  it.each([false, true])(
    'requests approval changes only on click with the controlled state initially %s',
    (autoApprove) => {
      const props = makeProps({ settings: { ...settings, autoApprove } });
      render(props);
      openSettings();
      const approval = buttonByLabel('Toggle smart approve');
      expectPressed(approval, autoApprove);
      expect(props.onAutoApproveChange).not.toHaveBeenCalled();

      click(approval);
      expect(props.onAutoApproveChange).toHaveBeenCalledTimes(1);
      expect(props.onAutoApproveChange).toHaveBeenLastCalledWith(!autoApprove);
      expectPressed(approval, autoApprove);
      expect(props.settings.autoApprove).toBe(autoApprove);

      render({ ...props, settings: { ...props.settings, autoApprove: !autoApprove } });
      expectPressed(approval, !autoApprove);
      expect(props.onAutoApproveChange).toHaveBeenCalledTimes(1);
      click(approval);
      expect(props.onAutoApproveChange).toHaveBeenCalledTimes(2);
      expect(props.onAutoApproveChange).toHaveBeenLastCalledWith(autoApprove);
      expect(props.onWakeWordChange).not.toHaveBeenCalled();
      expectSessionUnchanged(props);
    },
  );

  it.each([0, 0.35, 1])(
    'reports numeric volume %s and reflects controlled range updates',
    (volume) => {
      const props = makeProps({ status: 'listening' });
      render(props);
      const dialog = openSettings();
      const input = dialog.querySelector<HTMLInputElement>('input[aria-label="Volume"]');
      expect(input).not.toBeNull();
      expect(input?.type).toBe('range');
      expect(input?.min).toBe('0');
      expect(input?.max).toBe('1');
      expect(input?.step).toBe('0.05');
      expect(input?.value).toBe('0.5');
      expect(input?.parentElement?.querySelector('b')?.textContent).toBe('50%');

      // Bypass React's value tracker to model a user changing the native range.
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setValue.call(input, String(volume));
        input!.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(props.onSoundVolumeChange).toHaveBeenCalledTimes(1);
      expect(props.onSoundVolumeChange).toHaveBeenCalledWith(volume);
      expect(input?.value).toBe('0.5');
      expect(input?.parentElement?.querySelector('b')?.textContent).toBe('50%');

      render({ ...props, soundVolume: volume });
      expect(input?.value).toBe(String(volume));
      expect(input?.parentElement?.querySelector('b')?.textContent).toBe(
        `${Math.round(volume * 100)}%`,
      );
      expect(props.onSoundVolumeChange).toHaveBeenCalledTimes(1);
      expect(props.onToggleSoundMute).not.toHaveBeenCalled();
      expect(props.onAutoApproveChange).not.toHaveBeenCalled();
      expectSessionUnchanged(props);
    },
  );

  it('opens the advanced console through its callback without changing session or approval', () => {
    const props = makeProps({ status: 'speaking' });
    render(props);
    openSettings();

    click(buttonByText('Open advanced console'));

    expect(props.onOpenConsole).toHaveBeenCalledTimes(1);
    expect(props.onOpenConsole).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
    expect(props.onCollapseToBar).not.toHaveBeenCalled();
    expect(props.onCollapseToOrb).not.toHaveBeenCalled();
    expect(props.onAutoApproveChange).not.toHaveBeenCalled();
    expectSessionUnchanged(props);
  });
});
