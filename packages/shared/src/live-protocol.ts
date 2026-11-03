/**
 * Gemini Live wire protocol (v1beta), limited to the messages this app uses.
 * Field names are lowerCamelCase exactly as the JSON API expects.
 */

export type LiveRole = 'user' | 'model';

export interface LiveBlob {
  data: string;
  mimeType: string;
}

export interface LiveFunctionDeclaration {
  name: string;
  description: string;
  behavior?: 'BLOCKING' | 'NON_BLOCKING';
  parameters: Record<string, unknown>;
}

export interface LiveGenerationConfig {
  responseModalities: Array<'AUDIO' | 'TEXT'>;
  speechConfig?: {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
  };
  thinkingConfig?: {
    thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    includeThoughts?: boolean;
  };
}

export interface LiveSetup {
  model: string;
  generationConfig: LiveGenerationConfig;
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<{ functionDeclarations: LiveFunctionDeclaration[] }>;
  inputAudioTranscription?: { customVocabulary?: string[] };
  outputAudioTranscription?: Record<string, never>;
  realtimeInputConfig?: {
    automaticActivityDetection?: {
      disabled?: boolean;
      startOfSpeechSensitivity?: 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_HIGH';
      endOfSpeechSensitivity?: 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_HIGH';
      prefixPaddingMs?: number;
      silenceDurationMs?: number;
    };
  };
  sessionResumption?: { handle?: string };
  contextWindowCompression?: { slidingWindow: Record<string, never>; triggerTokens?: string };
  historyConfig?: { initialHistoryInClientContent?: boolean };
}

export interface LiveFunctionCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

export type FunctionResponseScheduling = 'INTERRUPT' | 'WHEN_IDLE' | 'SILENT';

export interface LiveFunctionResponse {
  id: string;
  name: string;
  response: {
    result?: unknown;
    error?: { message: string; code?: string; hint?: string };
    scheduling?: FunctionResponseScheduling;
  };
}

export interface LivePart {
  text?: string;
  inlineData?: LiveBlob;
}

export interface LiveClientContent {
  turns: Array<{ role: LiveRole; parts: LivePart[] }>;
  turnComplete: boolean;
}

export type LiveClientMessage =
  | { setup: LiveSetup }
  | {
      realtimeInput: {
        audio?: LiveBlob;
        video?: LiveBlob;
        text?: string;
        audioStreamEnd?: boolean;
      };
    }
  | { toolResponse: { functionResponses: LiveFunctionResponse[] } }
  | { clientContent: LiveClientContent };

export interface LiveServerMessage {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: { parts?: Array<{ text?: string; inlineData?: LiveBlob }>; role?: string };
    turnComplete?: boolean;
    generationComplete?: boolean;
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: LiveFunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: { timeLeft?: string };
  usageMetadata?: {
    totalTokenCount?: number;
    promptTokenCount?: number;
    responseTokenCount?: number;
  };
  /** Extended-thinking only: IN_PROGRESS while background reasoning is running. */
  interactionStatus?: 'IN_PROGRESS' | 'IDLE';
  error?: { code?: number; message?: string; status?: string };
}

/** Close codes we care about, with operator-facing explanations. */
export const LIVE_CLOSE_REASONS: Record<number, string> = {
  1000: 'Session closed normally.',
  1006: 'Network connection dropped.',
  1007: 'The server rejected the session configuration.',
  1011: 'The server reported an internal error.',
  4000: 'Connection timed out.',
  4001: 'The Live setup handshake did not complete.',
  4003: 'The API key or ephemeral token was rejected.',
  4290: 'Rate limit or quota exceeded.',
};
