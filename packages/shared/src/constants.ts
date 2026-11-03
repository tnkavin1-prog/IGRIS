/**
 * Product-wide constants. Anything a user might reasonably need to change at
 * runtime lives in settings/storage instead; this module is for fixed
 * protocol-level values.
 */

export const PRODUCT_NAME = 'Gemini Browser Live';
export const PRODUCT_VERSION = '1.0.0';
export const PROTOCOL_VERSION = 1;

/** Local bridge defaults. The bridge only ever binds to loopback. */
export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_PORT = 47_821;
export const BRIDGE_ORIGIN = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;
export const BRIDGE_HEALTH_PATH = '/api/health';
export const BRIDGE_TOKEN_PATH = '/api/token';
export const BRIDGE_CONFIG_PATH = '/api/config';

/** Gemini Live wire protocol. */
export const LIVE_WS_ORIGIN =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService';
export const LIVE_WS_DIRECT = `${LIVE_WS_ORIGIN}.BidiGenerateContent`;
export const LIVE_WS_CONSTRAINED = `${LIVE_WS_ORIGIN}.BidiGenerateContentConstrained`;
export const GEMINI_REST_ORIGIN = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Audio contract.
 * - Gemini expects raw signed 16-bit little-endian PCM, mono, 16 kHz in.
 * - Gemini emits raw signed 16-bit little-endian PCM, mono, 24 kHz out.
 * - 32 ms frames keep latency low without excessive WebSocket overhead.
 */
export const AUDIO_INPUT_RATE = 16_000;
export const AUDIO_OUTPUT_RATE = 24_000;
export const AUDIO_FRAME_MS = 32;
export const AUDIO_INPUT_FRAME_SAMPLES = (AUDIO_INPUT_RATE * AUDIO_FRAME_MS) / 1000;
export const AUDIO_INPUT_FRAME_BYTES = AUDIO_INPUT_FRAME_SAMPLES * 2;

/** Storage keys (chrome.storage.local). */
export const STORAGE_KEYS = {
  settings: 'gbl.settings.v1',
  bridgeSecret: 'gbl.bridgeSecret.v1',
  conversation: 'gbl.conversation.v1',
  onboarding: 'gbl.onboarding.v1',
  siteGrant: 'gbl.siteGrant.v1',
} as const;

/** Runtime message namespaces between extension surfaces. */
export const MSG = {
  contentPing: 'GBL_CONTENT_PING',
  contentOp: 'GBL_CONTENT_OP',
  captureViewport: 'GBL_CAPTURE_VIEWPORT',
  executeTool: 'GBL_EXECUTE_TOOL',
  cancelTool: 'GBL_CANCEL_TOOL',
  getStatus: 'GBL_GET_STATUS',
} as const;

/** Bounds that keep one bad tool call from exhausting the context window. */
export const LIMITS = {
  snapshotTextChars: 9_000,
  snapshotMaxElements: 120,
  fullTextChars: 30_000,
  maxLinks: 100,
  toolTimeoutMs: 20_000,
  navigationTimeoutMs: 25_000,
  screenshotMaxWidth: 1_280,
  /** Tool responses above this size get truncated before reaching Gemini. */
  toolResponseChars: 14_000,
  conversationMessages: 120,
} as const;
