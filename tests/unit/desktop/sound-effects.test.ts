import { describe, it, expect, vi } from 'vitest';
import {
  SoundEffectsEngine,
  type SoundEffectType,
} from '../../../apps/desktop-hud/src/renderer/sound-effects.js';

function createMockAudioContext() {
  const createdNodes: {
    oscillators: any[];
    gains: any[];
    filters: any[];
  } = {
    oscillators: [],
    gains: [],
    filters: [],
  };

  const destination = { tag: 'destination' };

  const ctx: any = {
    currentTime: 0.1,
    state: 'running',
    destination,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockImplementation(() => {
      ctx.state = 'closed';
      return Promise.resolve();
    }),
    createGain: vi.fn().mockImplementation(() => {
      const gainNode: any = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      createdNodes.gains.push(gainNode);
      return gainNode;
    }),
    createOscillator: vi.fn().mockImplementation(() => {
      const oscNode: any = {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      createdNodes.oscillators.push(oscNode);
      return oscNode;
    }),
    createBiquadFilter: vi.fn().mockImplementation(() => {
      const filterNode: any = {
        type: 'lowpass',
        frequency: {
          value: 350,
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        Q: {
          value: 1,
          setValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      createdNodes.filters.push(filterNode);
      return filterNode;
    }),
  };

  return { ctx: ctx as AudioContext, createdNodes };
}

describe('SoundEffectsEngine', () => {
  it('initializes with default volume and unmuted state', () => {
    const engine = new SoundEffectsEngine();
    expect(engine.getVolume()).toBe(0.5);
    expect(engine.isMuted()).toBe(false);
  });

  it('respects custom volume and muted state in constructor', () => {
    const engine = new SoundEffectsEngine({ volume: 0.8, muted: true });
    expect(engine.getVolume()).toBe(0.8);
    expect(engine.isMuted()).toBe(true);
  });

  it('clamps volume to [0, 1] range', () => {
    const engine = new SoundEffectsEngine();
    engine.setVolume(1.5);
    expect(engine.getVolume()).toBe(1.0);

    engine.setVolume(-0.5);
    expect(engine.getVolume()).toBe(0.0);

    engine.setVolume(0.35);
    expect(engine.getVolume()).toBe(0.35);
  });

  it('toggles mute correctly', () => {
    const engine = new SoundEffectsEngine({ muted: false });
    expect(engine.toggleMute()).toBe(true);
    expect(engine.isMuted()).toBe(true);

    expect(engine.toggleMute()).toBe(false);
    expect(engine.isMuted()).toBe(false);
  });

  it('does not play sounds when muted', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx, muted: true });

    const played = engine.play('system_online');
    expect(played).toBe(false);
    // Only master gain was created during initialization, no oscillators
    expect(createdNodes.oscillators.length).toBe(0);
  });

  it('synthesizes "system_online" harmonic rising chime with 4 arpeggio notes', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const ok = engine.play('system_online');
    expect(ok).toBe(true);
    // 4 notes: C5, E5, G5, C6
    expect(createdNodes.oscillators.length).toBe(4);
    for (const osc of createdNodes.oscillators) {
      expect(osc.type).toBe('sine');
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    }
  });

  it('synthesizes "target_locked" dual-pulse scanning tone', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const ok = engine.play('target_locked');
    expect(ok).toBe(true);
    // 2 pulses: 880Hz and 1320Hz
    expect(createdNodes.oscillators.length).toBe(2);
    expect(createdNodes.oscillators[0].type).toBe('triangle');
    expect(createdNodes.oscillators[1].type).toBe('triangle');
  });

  it('synthesizes "step_complete" gentle porcelain chime with fundamental and shimmer overtone', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const ok = engine.play('step_complete');
    expect(ok).toBe(true);
    // 2 sine oscillators: A5 (880Hz) and A6 (1760Hz shimmer)
    expect(createdNodes.oscillators.length).toBe(2);
    expect(createdNodes.oscillators[0].type).toBe('sine');
    expect(createdNodes.oscillators[1].type).toBe('sine');
  });

  it('synthesizes "approval_needed" dual-tone attention chime', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const ok = engine.play('approval_needed');
    expect(ok).toBe(true);
    // 2 attention notes: A4 (440Hz) and C#5 (554.37Hz)
    expect(createdNodes.oscillators.length).toBe(2);
  });

  it('synthesizes "emergency_stop" low-frequency warning tone with resonant lowpass filter', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const ok = engine.play('emergency_stop');
    expect(ok).toBe(true);
    expect(createdNodes.oscillators.length).toBe(1);
    expect(createdNodes.oscillators[0].type).toBe('sawtooth');
    expect(createdNodes.filters.length).toBe(1);
    expect(createdNodes.filters[0].type).toBe('lowpass');
  });

  it('handles closing the audio context cleanly', () => {
    const { ctx } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });
    engine.close();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('operates safely when AudioContext is missing in headless/node environments', () => {
    const engine = new SoundEffectsEngine();
    const cues: SoundEffectType[] = [
      'system_online',
      'target_locked',
      'step_complete',
      'approval_needed',
      'emergency_stop',
    ];
    for (const cue of cues) {
      expect(() => engine.play(cue)).not.toThrow();
    }
  });

  it('resumes suspended AudioContext when unlock() is called', async () => {
    const { ctx } = createMockAudioContext();
    (ctx as any).state = 'suspended';
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    const unlocked = await engine.unlock();
    expect(unlocked).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('handles unlock() gracefully in headless environment', async () => {
    const engine = new SoundEffectsEngine();
    const unlocked = await engine.unlock();
    expect(typeof unlocked).toBe('boolean');
  });

  it('unplugs and disconnects oscillator and gain nodes on note completion to prevent memory leaks', () => {
    const { ctx, createdNodes } = createMockAudioContext();
    const engine = new SoundEffectsEngine({ audioContext: ctx });

    engine.play('system_online');
    expect(createdNodes.oscillators.length).toBe(4);

    // Trigger onended on each oscillator
    for (let i = 0; i < createdNodes.oscillators.length; i++) {
      const osc = createdNodes.oscillators[i];
      const gain = createdNodes.gains[i + 1]; // +1 because index 0 is masterGain
      expect(typeof osc.onended).toBe('function');
      osc.onended();
      expect(osc.disconnect).toHaveBeenCalled();
      expect(gain.disconnect).toHaveBeenCalled();
    }
  });

  it('handles NaN or invalid volume gracefully by falling back to safe range', () => {
    const engine = new SoundEffectsEngine();
    engine.setVolume(NaN);
    expect(engine.getVolume()).toBe(0.5);
  });
});
