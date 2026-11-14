/**
 * Provider-independent model transport.
 *
 * Every model call in the HUD used to be a hand-written `fetch` against the
 * Gemini REST API with generic `Error` throws, so a rate limit, an expired key
 * and a malformed response were indistinguishable to the caller. This module
 * gives the agent one interface to call (`ModelProvider`) with typed failures,
 * a documented fallback order, and a single place that knows the wire format.
 */
import {
  AppError,
  PermissionError,
  TimeoutError,
  UnavailableError,
  ValidationError,
} from './errors.js';

export interface ModelImage {
  mimeType: string;
  /** Base64 payload, without the data-URL prefix. */
  data: string;
}

/** One piece of an ordered request body. */
export type ModelContent = { type: 'text'; text: string } | { type: 'image'; image: ModelImage };

export interface ModelRequest {
  /** Single-prompt convenience form. Ignored when `content` is present. */
  prompt?: string;
  /** Ordered text/image parts, for prompts that interleave screenshots. */
  content?: ModelContent[];
  systemInstruction?: string;
  /** Extra images appended after `prompt`. Ignored when `content` is present. */
  images?: ModelImage[];
  /** JSON schema; when set the provider asks for a JSON response. */
  responseSchema?: object;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ModelResult {
  text: string;
  /** Provider that produced the answer, for diagnostics. */
  provider: string;
  model: string;
}

export interface ModelProvider {
  readonly id: string;
  /** Human-readable model identifier, used in logs and errors. */
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelResult>;
}

export const MODEL_ERROR_CODES = {
  auth: 'MODEL_AUTH',
  rateLimited: 'MODEL_RATE_LIMITED',
  unavailable: 'MODEL_UNAVAILABLE',
  badRequest: 'MODEL_BAD_REQUEST',
  notFound: 'MODEL_NOT_FOUND',
  empty: 'MODEL_EMPTY_RESPONSE',
  blocked: 'MODEL_BLOCKED',
  malformed: 'MODEL_MALFORMED_RESPONSE',
} as const;

/** Failures worth retrying, on this provider or on the next one. */
const RETRYABLE_CODES = new Set<string>([
  MODEL_ERROR_CODES.rateLimited,
  MODEL_ERROR_CODES.unavailable,
  MODEL_ERROR_CODES.empty,
  MODEL_ERROR_CODES.malformed,
  'TIMEOUT',
]);

export function isRetryableModelError(error: unknown): boolean {
  return error instanceof AppError && RETRYABLE_CODES.has(error.code);
}

function errorForStatus(status: number, model: string): AppError {
  if (status === 400 || status === 422) {
    return new AppError(
      `The model request was rejected (HTTP ${status}).`,
      MODEL_ERROR_CODES.badRequest,
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new PermissionError(
      `The model provider rejected the API key (HTTP ${status}).`,
      MODEL_ERROR_CODES.auth,
    );
  }
  if (status === 404) {
    return new AppError(
      `Model "${model}" is not available (HTTP 404).`,
      MODEL_ERROR_CODES.notFound,
      404,
    );
  }
  if (status === 429) {
    return new AppError(
      'The model provider is rate limiting requests (HTTP 429).',
      MODEL_ERROR_CODES.rateLimited,
      429,
    );
  }
  if (status >= 500) {
    return new UnavailableError(
      `The model provider is unavailable (HTTP ${status}).`,
      MODEL_ERROR_CODES.unavailable,
    );
  }
  return new AppError(
    `The model request failed (HTTP ${status}).`,
    MODEL_ERROR_CODES.badRequest,
    status,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  /** Defaults to the public Generative Language endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injection point for tests. */
  fetchImpl?: typeof fetch;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiPayload {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL_TIMEOUT_MS = 45_000;

/**
 * Gemini `generateContent` transport.
 *
 * `baseUrl` is configurable so a compatible gateway or a regional endpoint can
 * be used without touching the planner.
 */
export class GeminiModelProvider implements ModelProvider {
  public readonly id = 'gemini';
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new ValidationError([{ field: 'apiKey', message: 'A Gemini API key is required.' }]);
    }
    if (!options.model) {
      throw new ValidationError([{ field: 'model', message: 'A model name is required.' }]);
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private buildBody(request: ModelRequest): Record<string, unknown> {
    const parts: GeminiPart[] = [];
    if (request.content && request.content.length > 0) {
      for (const part of request.content) {
        if (part.type === 'text') parts.push({ text: part.text });
        else parts.push({ inlineData: { mimeType: part.image.mimeType, data: part.image.data } });
      }
    } else {
      parts.push({ text: request.prompt ?? '' });
      for (const image of request.images ?? []) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
      }
    }
    return {
      ...(request.systemInstruction
        ? { systemInstruction: { parts: [{ text: request.systemInstruction }] } }
        : {}),
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: request.temperature ?? 0,
        ...(request.responseSchema
          ? { responseMimeType: 'application/json', responseSchema: request.responseSchema }
          : {}),
      },
    };
  }

  public async generate(request: ModelRequest): Promise<ModelResult> {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal,
        body: JSON.stringify(this.buildBody(request)),
      });
    } catch (error) {
      // A caller-initiated cancel is not a provider failure.
      if (request.signal?.aborted) throw error;
      if (isAbortError(error)) {
        throw new TimeoutError(`Model "${this.model}" did not answer in time.`, 'TIMEOUT');
      }
      throw new UnavailableError(
        `Could not reach the model provider: ${error instanceof Error ? error.message : String(error)}`,
        MODEL_ERROR_CODES.unavailable,
      );
    }

    if (!response.ok) throw errorForStatus(response.status, this.model);

    let payload: GeminiPayload;
    try {
      payload = (await response.json()) as GeminiPayload;
    } catch {
      throw new AppError(
        'The model provider returned a body that is not JSON.',
        MODEL_ERROR_CODES.malformed,
        502,
      );
    }

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      const blocked = payload.promptFeedback?.blockReason;
      if (blocked) {
        throw new AppError(
          `The model declined the request (${blocked}).`,
          MODEL_ERROR_CODES.blocked,
          422,
        );
      }
      throw new AppError('The model returned no text content.', MODEL_ERROR_CODES.empty, 502);
    }

    return { text, provider: this.id, model: this.model };
  }
}

export interface FallbackModelProviderOptions {
  /** Called once per skipped provider, for diagnostics. */
  onFallback?: (from: string, to: string, error: unknown) => void;
}

/**
 * Try providers in order until one answers.
 *
 * The documented order is: the primary provider first, then any configured
 * fallback. Authentication, bad-request and cancellation failures stop the
 * chain immediately — retrying a rejected key or a cancelled task elsewhere
 * only hides the real problem. Rate limits, outages, timeouts and empty or
 * malformed responses move on to the next provider.
 */
export class FallbackModelProvider implements ModelProvider {
  public readonly id = 'fallback-chain';

  constructor(
    private readonly providers: ModelProvider[],
    private readonly options: FallbackModelProviderOptions = {},
  ) {
    if (providers.length === 0) {
      throw new ValidationError([
        { field: 'providers', message: 'At least one model provider is required.' },
      ]);
    }
  }

  public get model(): string {
    return this.providers.map((provider) => provider.model).join(' -> ');
  }

  /** Providers in the order they will be tried. */
  public describe(): Array<{ id: string; model: string }> {
    return this.providers.map(({ id, model }) => ({ id, model }));
  }

  public async generate(request: ModelRequest): Promise<ModelResult> {
    const failures: string[] = [];
    for (let index = 0; index < this.providers.length; index++) {
      const provider = this.providers[index];
      if (!provider) break;
      try {
        return await provider.generate(request);
      } catch (error) {
        const next = this.providers[index + 1];
        const cancelled = Boolean(request.signal?.aborted);
        if (cancelled || !isRetryableModelError(error) || !next) {
          if (failures.length > 0) {
            throw new AppError(
              `${failures.join('; ')}; ${describeFailure(provider, error)}`,
              error instanceof AppError ? error.code : MODEL_ERROR_CODES.unavailable,
              error instanceof AppError ? error.statusCode : 502,
            );
          }
          throw error;
        }
        failures.push(describeFailure(provider, error));
        this.options.onFallback?.(provider.id, next.id, error);
      }
    }
    /* istanbul ignore next -- the loop either returns or throws */
    throw new UnavailableError('No model provider answered.', MODEL_ERROR_CODES.unavailable);
  }
}

function describeFailure(provider: ModelProvider, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${provider.id}/${provider.model}: ${message}`;
}
