/**
 * Live model registry.
 *
 * Capabilities below were verified empirically against the live API on
 * 2026-11-03 (see docs/TECHNICAL_RESEARCH.md and docs/probe-results-2.json):
 *
 * - `gemini-3.8-live` accepts asynchronous function declarations, emits
 *   tool calls, and honours FunctionResponse.scheduling (INTERRUPT / WHEN_IDLE
 *   / SILENT). This is the agent model.
 * - `gemini-3.8-live-extended-thinking` requires an explicit thinkingLevel,
 *   rejects BLOCKING function declarations, and in our repeated probes never
 *   emitted a tool call (it instead produced an apologetic "system error"
 *   utterance). It is therefore offered as a conversation-only model and is
 *   never used for browser control.
 *
 * Model ids live here and nowhere else.
 */

export type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LiveModelSpec {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  /** Whether verified browser tool calling works on this model. */
  toolCalling: boolean;
  /** Whether the model requires thinkingConfig. */
  requiresThinkingLevel: boolean;
  thinkingLevels: readonly ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel;
  /** Whether FunctionResponse.scheduling is accepted. */
  supportsScheduling: boolean;
  latency: 'low' | 'high';
  streaming: boolean;
}

export const LIVE_MODELS: readonly LiveModelSpec[] = [
  {
    id: 'gemini-3.8-live',
    label: 'Gemini 3.8 Live',
    shortLabel: '3.8 Live',
    description:
      'Default low-latency native-audio model. Verified asynchronous tool calling and response scheduling.',
    toolCalling: true,
    requiresThinkingLevel: false,
    thinkingLevels: [],
    supportsScheduling: true,
    latency: 'low',
    streaming: true,
  },
  {
    id: 'gemini-3.8-live-extended-thinking',
    label: 'Gemini 3.8 Live · Extended Thinking',
    shortLabel: '3.8 Extended',
    description:
      'Higher background reasoning for discussion. Tool calling is unavailable in the current API version, so browser control is disabled in this mode.',
    toolCalling: false,
    requiresThinkingLevel: true,
    thinkingLevels: ['LOW', 'MEDIUM', 'HIGH'],
    defaultThinkingLevel: 'MEDIUM',
    supportsScheduling: false,
    latency: 'high',
    streaming: true,
  },
] as const;

export const DEFAULT_MODEL_ID = 'gemini-3.8-live';

export function getModel(id: string | undefined | null): LiveModelSpec {
  return LIVE_MODELS.find((m) => m.id === id) ?? LIVE_MODELS[0]!;
}

export function isKnownModel(id: string): boolean {
  return LIVE_MODELS.some((m) => m.id === id);
}

/** Models the local bridge is willing to mint tokens for. */
export const ALLOWED_MODEL_IDS: readonly string[] = LIVE_MODELS.map((m) => m.id);

/**
 * Curated prebuilt voice list. The Live API accepts the TTS prebuilt voice
 * names; this subset is known-stable and each has a distinct character.
 * Users may also enter a custom voice name in Settings.
 */
export interface VoiceSpec {
  id: string;
  label: string;
}

export const VOICES: readonly VoiceSpec[] = [
  { id: 'Kore', label: 'Kore · clear, balanced' },
  { id: 'Puck', label: 'Puck · lively, upbeat' },
  { id: 'Aoede', label: 'Aoede · warm, expressive' },
  { id: 'Charon', label: 'Charon · deep, measured' },
  { id: 'Fenrir', label: 'Fenrir · bold, direct' },
  { id: 'Leda', label: 'Leda · soft, calm' },
  { id: 'Orus', label: 'Orus · firm, confident' },
  { id: 'Zephyr', label: 'Zephyr · bright, energetic' },
  { id: 'Alnilam', label: 'Alnilam · resonant, assured' },
  { id: 'Gacrux', label: 'Gacrux · mature, grounded' },
  { id: 'Sulafat', label: 'Sulafat · mellow, smooth' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix · gentle, precise' },
] as const;

export const DEFAULT_VOICE = 'Kore';

/** Languages offered in Settings. Native-audio models also switch naturally. */
export const LANGUAGES: readonly { id: string; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi', label: 'Hindi' },
  { id: 'ta', label: 'Tamil' },
  { id: 'te', label: 'Telugu' },
  { id: 'bn', label: 'Bengali' },
  { id: 'mr', label: 'Marathi' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ja', label: 'Japanese' },
  { id: 'zh-Hans', label: 'Chinese (Simplified)' },
  { id: 'ar', label: 'Arabic' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)' },
] as const;

export type ModelMode = 'fast' | 'extended';
