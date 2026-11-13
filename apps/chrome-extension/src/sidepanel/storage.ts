/**
 * Persistence for the side panel.
 *
 * Settings and the bridge secret live in chrome.storage.local. The secret is
 * the *gate* secret, not the Gemini API key; the API key never enters Chrome.
 * Conversation persistence is opt-in ("Keep on this device").
 */
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  getModel,
  type AppSettings,
  type ConversationEntry,
  type RetentionMode,
} from '@gbl/shared';

export interface StoredOnboarding {
  seen: boolean;
  completedAt?: number;
}

/** Storage key for the optional native desktop control token. */
export const CONTROL_TOKEN_KEY = 'gematronControlToken';

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

/**
 * Accept only loopback origins. This prevents a pasted URL from turning the
 * bridge secret into a request to an attacker-controlled host.
 */
export function normalizeBridgeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    return null;
  }
  if (url.username || url.password) return null;
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function sanitizeSettings(input: Partial<AppSettings> | undefined | null): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const model = getModel(merged.modelId);
  const retention: RetentionMode = merged.retention === 'local' ? 'local' : 'session';
  return {
    ...merged,
    bridgeUrl: normalizeBridgeUrl(merged.bridgeUrl) ?? DEFAULT_SETTINGS.bridgeUrl,
    modelId: model.id,
    voice: String(merged.voice || DEFAULT_SETTINGS.voice).slice(0, 64),
    language: String(merged.language || DEFAULT_SETTINGS.language).slice(0, 32),
    thinkingLevel: ['LOW', 'MEDIUM', 'HIGH'].includes(merged.thinkingLevel)
      ? merged.thinkingLevel
      : DEFAULT_SETTINGS.thinkingLevel,
    browserControl: Boolean(merged.browserControl),
    confirmRisky: Boolean(merged.confirmRisky),
    autoApprove: Boolean(merged.autoApprove),
    includeContextOnStart: Boolean(merged.includeContextOnStart),
    autoReconnect: Boolean(merged.autoReconnect),
    vadSilenceMs: Math.round(clamp(merged.vadSilenceMs, 200, 2_000, DEFAULT_SETTINGS.vadSilenceMs)),
    vadPrefixMs: Math.round(clamp(merged.vadPrefixMs, 0, 500, DEFAULT_SETTINGS.vadPrefixMs)),
    inputDeviceId: merged.inputDeviceId ? String(merged.inputDeviceId) : null,
    outputDeviceId: merged.outputDeviceId ? String(merged.outputDeviceId) : null,
    inputGain: clamp(merged.inputGain, 0.1, 3, DEFAULT_SETTINGS.inputGain),
    outputVolume: clamp(merged.outputVolume, 0, 1, DEFAULT_SETTINGS.outputVolume),
    retention,
    maxToolSteps: Math.round(clamp(merged.maxToolSteps, 1, 24, DEFAULT_SETTINGS.maxToolSteps)),
    audioCues: Boolean(merged.audioCues),
    downloadDirectory:
      typeof merged.downloadDirectory === 'string' ? merged.downloadDirectory.trim() : '',
  };
}

async function getRaw(key: string): Promise<unknown> {
  const record = await chrome.storage.local.get(key);
  return record[key];
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = (await getRaw(STORAGE_KEYS.settings)) as Partial<AppSettings> | null;
    // Automatic approval is opt-in. A missing or unreadable value must never
    // enable it, otherwise a fresh install (or a storage failure) would run
    // consequential browser actions without asking the user.
    return sanitizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function loadSecret(): Promise<string> {
  try {
    const value = await getRaw(STORAGE_KEYS.bridgeSecret);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

export async function saveSecret(secret: string): Promise<void> {
  const value = secret.trim();
  if (!value) {
    await chrome.storage.local.remove(STORAGE_KEYS.bridgeSecret);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.bridgeSecret]: value });
}

/**
 * Control token for the native desktop HUD.
 *
 * The desktop control API accepts a per-install shared secret. The desktop
 * app is normally recognised by its first-party extension origin, so the
 * token is optional, but a locked-down installation can require it.
 */
export async function loadControlToken(): Promise<string> {
  try {
    const value = await chrome.storage.local.get(CONTROL_TOKEN_KEY);
    const token = value?.[CONTROL_TOKEN_KEY];
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

export async function saveControlToken(token: string): Promise<void> {
  const value = token.trim();
  if (!value) {
    await chrome.storage.local.remove(CONTROL_TOKEN_KEY);
    return;
  }
  await chrome.storage.local.set({ [CONTROL_TOKEN_KEY]: value });
}

export async function loadConversation(): Promise<ConversationEntry[]> {
  try {
    const raw = await getRaw(STORAGE_KEYS.conversation);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isConversationEntry).slice(-120);
  } catch {
    return [];
  }
}

export async function saveConversation(entries: ConversationEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.conversation]: entries.slice(-120) });
}

export async function removeConversation(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.conversation);
}

export async function loadOnboarding(): Promise<StoredOnboarding> {
  try {
    const raw = (await getRaw(STORAGE_KEYS.onboarding)) as Partial<StoredOnboarding> | null;
    return {
      seen: Boolean(raw?.seen),
      ...(raw?.completedAt ? { completedAt: raw.completedAt } : {}),
    };
  } catch {
    return { seen: false };
  }
}

export async function saveOnboarding(value: StoredOnboarding): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.onboarding]: value });
}

function isConversationEntry(value: unknown): value is ConversationEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ConversationEntry>;
  if (typeof entry.id !== 'string' || typeof entry.at !== 'number') return false;
  switch (entry.kind) {
    case 'user':
    case 'assistant':
      return typeof entry.text === 'string' && typeof entry.final === 'boolean';
    case 'system':
      return (
        typeof entry.text === 'string' && ['info', 'warn', 'error'].includes(String(entry.level))
      );
    case 'tool':
      return typeof entry.name === 'string' && typeof entry.title === 'string';
    default:
      return false;
  }
}
