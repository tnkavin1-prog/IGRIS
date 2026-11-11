export interface HudAccent {
  id: string;
  a1: string;
  a2: string;
  rgb: string;
  a1b: string;
}

export interface HudAppearance {
  accentId: string;
  opacity: number;
}

export const HUD_ACCENTS: HudAccent[] = [
  { id: 'violet', a1: '#7c5cff', a2: '#22d3ee', rgb: '124,92,255', a1b: '#4f7bff' },
  { id: 'cyan', a1: '#06b6d4', a2: '#34d399', rgb: '6,182,212', a1b: '#0ea5e9' },
  { id: 'emerald', a1: '#10b981', a2: '#a3e635', rgb: '16,185,129', a1b: '#059669' },
  { id: 'rose', a1: '#f43f5e', a2: '#fb923c', rgb: '244,63,94', a1b: '#e11d48' },
  { id: 'amber', a1: '#f59e0b', a2: '#f472b6', rgb: '245,158,11', a1b: '#f97316' },
];

export const DEFAULT_APPEARANCE: HudAppearance = { accentId: 'violet', opacity: 0.78 };

const STORAGE_KEY = 'gematron.appearance';

export function loadAppearance(): HudAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<HudAppearance>;
    const accentId = HUD_ACCENTS.some((accent) => accent.id === parsed.accentId)
      ? (parsed.accentId as string)
      : DEFAULT_APPEARANCE.accentId;
    const opacity =
      typeof parsed.opacity === 'number' && Number.isFinite(parsed.opacity)
        ? Math.min(0.98, Math.max(0.35, parsed.opacity))
        : DEFAULT_APPEARANCE.opacity;
    return { accentId, opacity };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(appearance: HudAppearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* ignore storage failures */
  }
}

export function appearanceStyle(appearance: HudAppearance): Record<string, string> {
  const accent = HUD_ACCENTS.find((item) => item.id === appearance.accentId) ?? HUD_ACCENTS[0]!;
  return {
    '--a1': accent.a1,
    '--a2': accent.a2,
    '--a1b': accent.a1b,
    '--rgb': accent.rgb,
    '--op': String(appearance.opacity),
  };
}
