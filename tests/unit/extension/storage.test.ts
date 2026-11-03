import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '@gbl/shared';
import {
  normalizeBridgeUrl,
  sanitizeSettings,
} from '../../../apps/chrome-extension/src/sidepanel/storage.js';

describe('normalizeBridgeUrl', () => {
  it('accepts loopback origins and removes trailing slashes', () => {
    expect(normalizeBridgeUrl('http://127.0.0.1:47821')).toBe('http://127.0.0.1:47821');
    expect(normalizeBridgeUrl('http://127.0.0.1:47821/')).toBe('http://127.0.0.1:47821');
    expect(normalizeBridgeUrl('http://localhost:47821///')).toBe('http://localhost:47821');
    expect(normalizeBridgeUrl('  http://localhost:47821  ')).toBe('http://localhost:47821');
    expect(normalizeBridgeUrl('https://127.0.0.1:8443/api/')).toBe('https://127.0.0.1:8443/api');
  });

  it('drops query strings and fragments', () => {
    expect(normalizeBridgeUrl('http://127.0.0.1:47821/?token=abc#frag')).toBe(
      'http://127.0.0.1:47821',
    );
  });

  it('normalises case', () => {
    expect(normalizeBridgeUrl('HTTP://LOCALHOST:47821')).toBe('http://localhost:47821');
  });

  it('rejects non-loopback hosts, credentials, and non-http schemes', () => {
    for (const value of [
      'http://evil.example.com',
      'http://127.0.0.1.evil.com:47821',
      'http://user:pass@127.0.0.1:47821',
      'http://user@127.0.0.1:47821',
      'ftp://127.0.0.1:47821',
      'chrome-extension://hhbdkheccnmpbdadhhppbemcjkaimlob',
      'http://[::1]:47821',
      'not a url',
      '',
      '   ',
    ]) {
      expect(normalizeBridgeUrl(value), value).toBeNull();
    }
  });
});

describe('sanitizeSettings', () => {
  it('returns the documented defaults for empty input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the default model and thinking level for unknown values', () => {
    const settings = sanitizeSettings({
      modelId: 'gemini-9-ultra',
      thinkingLevel: 'MAXIMUM' as AppSettings['thinkingLevel'],
    });

    expect(settings.modelId).toBe('gemini-3.8-live');
    expect(settings.thinkingLevel).toBe('MEDIUM');
  });

  it('clamps numeric settings into safe ranges', () => {
    const settings = sanitizeSettings({
      vadSilenceMs: 10,
      vadPrefixMs: 9_999,
      inputGain: 99,
      outputVolume: -5,
      maxToolSteps: 0,
    });

    expect(settings.vadSilenceMs).toBe(200);
    expect(settings.vadPrefixMs).toBe(500);
    expect(settings.inputGain).toBe(3);
    expect(settings.outputVolume).toBe(0);
    expect(settings.maxToolSteps).toBe(1);
  });

  it('uses defaults for non-finite numeric input', () => {
    const settings = sanitizeSettings({
      vadSilenceMs: Number.NaN,
      inputGain: Number.POSITIVE_INFINITY,
    });

    expect(settings.vadSilenceMs).toBe(DEFAULT_SETTINGS.vadSilenceMs);
    expect(settings.inputGain).toBe(DEFAULT_SETTINGS.inputGain);
  });

  it('accepts only the documented retention mode', () => {
    expect(sanitizeSettings({ retention: 'local' }).retention).toBe('local');
    expect(sanitizeSettings({ retention: 'forever' as AppSettings['retention'] }).retention).toBe(
      'session',
    );
  });

  it('replaces a non-loopback bridge URL with the default', () => {
    expect(sanitizeSettings({ bridgeUrl: 'http://evil.example.com' }).bridgeUrl).toBe(
      DEFAULT_SETTINGS.bridgeUrl,
    );
  });

  it('coerces booleans and normalises optional device ids', () => {
    const settings = sanitizeSettings({
      browserControl: 0 as unknown as boolean,
      confirmRisky: 1 as unknown as boolean,
      includeContextOnStart: 0 as unknown as boolean,
      autoReconnect: 1 as unknown as boolean,
      audioCues: 1 as unknown as boolean,
      inputDeviceId: '',
      outputDeviceId: 'speaker-1',
    });

    expect(settings.browserControl).toBe(false);
    expect(settings.confirmRisky).toBe(true);
    expect(settings.includeContextOnStart).toBe(false);
    expect(settings.autoReconnect).toBe(true);
    expect(settings.audioCues).toBe(true);
    expect(settings.inputDeviceId).toBeNull();
    expect(settings.outputDeviceId).toBe('speaker-1');
  });

  it('bounds voice and language labels', () => {
    const settings = sanitizeSettings({
      voice: 'V'.repeat(100),
      language: 'L'.repeat(100),
    });

    expect(settings.voice).toHaveLength(64);
    expect(settings.language).toHaveLength(32);
    expect(sanitizeSettings({ voice: '' }).voice).toBe(DEFAULT_SETTINGS.voice);
    expect(sanitizeSettings({ language: '' }).language).toBe(DEFAULT_SETTINGS.language);
  });
});
