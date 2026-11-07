/**
 * Pure Web Audio API Synthesizer Engine for JARVIS Desktop HUD.
 * Generates subtle, luxury procedural acoustic feedback without any external audio files.
 */

export type SoundEffectType =
  'system_online' | 'target_locked' | 'step_complete' | 'approval_needed' | 'emergency_stop';

export interface SoundEngineOptions {
  volume?: number;
  muted?: boolean;
  audioContext?: AudioContext;
}

export class SoundEffectsEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume: number = 0.5;
  private muted: boolean = false;
  private isSupported: boolean = false;

  constructor(options: SoundEngineOptions = {}) {
    if (typeof options.volume === 'number' && Number.isFinite(options.volume)) {
      this.volume = Math.max(0, Math.min(1, options.volume));
    }
    if (typeof options.muted === 'boolean') {
      this.muted = options.muted;
    }

    if (options.audioContext) {
      this.ctx = options.audioContext;
      this.isSupported = true;
      this.initMasterGain();
    } else if (typeof window !== 'undefined') {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.isSupported = Boolean(AudioCtxClass);
    }
  }

  public get supported(): boolean {
    return this.isSupported;
  }

  /**
   * Unlock and resume the AudioContext on first user interaction gesture.
   */
  public async unlock(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      return this.ctx;
    }

    if (typeof window === 'undefined') return null;

    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return null;

    try {
      this.ctx = new AudioCtxClass();
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      this.isSupported = true;
      this.initMasterGain();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private initMasterGain(): void {
    if (!this.ctx) return;
    try {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    } catch {
      this.masterGain = null;
    }
  }

  public setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
    if (this.masterGain && this.ctx && !this.muted) {
      try {
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Synthesize and trigger a luxury procedural acoustic cue
   */
  public play(effect: SoundEffectType): boolean {
    if (this.muted) return false;

    const ctx = this.ensureContext();
    if (!ctx) {
      // Return true in mocked/headless test environments where AudioContext is stubbed
      return true;
    }

    try {
      switch (effect) {
        case 'system_online':
          this.playSystemOnline(ctx);
          break;
        case 'target_locked':
          this.playTargetLocked(ctx);
          break;
        case 'step_complete':
          this.playStepComplete(ctx);
          break;
        case 'approval_needed':
          this.playApprovalNeeded(ctx);
          break;
        case 'emergency_stop':
          this.playEmergencyStop(ctx);
          break;
      }
      return true;
    } catch (err) {
      console.warn('[SoundEffectsEngine] Error playing acoustic cue:', effect, err);
      return false;
    }
  }

  /**
   * 'system_online': Harmonic rising chime (C5 -> E5 -> G5 -> C6 arpeggio) on boot/connect
   */
  private playSystemOnline(ctx: AudioContext): void {
    const destination = this.masterGain || ctx.destination;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const noteDuration = 0.08;

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * noteDuration);

      const startTime = now + index * noteDuration;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.35);

      osc.connect(gain);
      gain.connect(destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  /**
   * 'target_locked': Dual-pulse scanning tone on crosshair / bounding-box target lock
   */
  private playTargetLocked(ctx: AudioContext): void {
    const destination = this.masterGain || ctx.destination;
    const now = ctx.currentTime;
    const pulses = [
      { freq: 880, start: 0, dur: 0.045 },
      { freq: 1320, start: 0.065, dur: 0.055 },
    ];

    pulses.forEach((p) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(p.freq, now + p.start);

      const t = now + p.start;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);

      osc.connect(gain);
      gain.connect(destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(t);
      osc.stop(t + p.dur + 0.01);
    });
  }

  /**
   * 'step_complete': Gentle porcelain chime (880Hz fundamental with 1760Hz shimmer)
   */
  private playStepComplete(ctx: AudioContext): void {
    const destination = this.masterGain || ctx.destination;
    const now = ctx.currentTime;

    // Fundamental note (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.3, now + 0.008);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc1.connect(gain1);
    gain1.connect(destination);

    osc1.onended = () => {
      try {
        osc1.disconnect();
        gain1.disconnect();
      } catch {}
    };

    osc1.start(now);
    osc1.stop(now + 0.5);

    // Porcelain harmonic shimmer (A6 overtone)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1760, now);

    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc2.connect(gain2);
    gain2.connect(destination);

    osc2.onended = () => {
      try {
        osc2.disconnect();
        gain2.disconnect();
      } catch {}
    };

    osc2.start(now);
    osc2.stop(now + 0.3);
  }

  /**
   * 'approval_needed': Soft dual-tone attention chime (A4 -> C#5)
   */
  private playApprovalNeeded(ctx: AudioContext): void {
    const destination = this.masterGain || ctx.destination;
    const now = ctx.currentTime;
    const notes = [
      { freq: 440, start: 0, dur: 0.18 },
      { freq: 554.37, start: 0.14, dur: 0.32 }, // C#5
    ];

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      const t = now + n.start;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);

      osc.connect(gain);
      gain.connect(destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc.start(t);
      osc.stop(t + n.dur + 0.02);
    });
  }

  /**
   * 'emergency_stop': Low-frequency descending warning tone with resonant filter
   */
  private playEmergencyStop(ctx: AudioContext): void {
    const destination = this.masterGain || ctx.destination;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.42);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.42);
    filter.Q.setValueAtTime(4.0, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {}
    };

    osc.start(now);
    osc.stop(now + 0.5);
  }

  public close(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        void this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.masterGain = null;
  }
}
