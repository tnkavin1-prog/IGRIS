import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_GEMINI_BASE_URL,
  FallbackModelProvider,
  GeminiModelProvider,
  MODEL_ERROR_CODES,
  isRetryableModelError,
  type ModelProvider,
  type ModelRequest,
} from '../../../apps/desktop-hud/src/main/model-provider.js';
import {
  AppError,
  PermissionError,
  UnavailableError,
  ValidationError,
} from '../../../apps/desktop-hud/src/main/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(payload: unknown, status = 200): Response {
  const response = jsonResponse(payload, status);
  return response;
}

function answer(text: string): {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
} {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const fetchMock = (impl: (url: string, init: RequestInit) => Promise<Response>) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  ) as unknown as typeof fetch;

/** Typed access to the recorded fetch calls. */
function callAt(fetchImpl: typeof fetch, index = 0): [string, RequestInit] {
  const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const call = calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return call as [string, RequestInit];
}

describe('GeminiModelProvider', () => {
  it('posts to the configured endpoint with the API key header', async () => {
    const fetchImpl = fetchMock(async () => textResponse(answer('{"ok":true}')));
    const provider = new GeminiModelProvider({
      apiKey: 'secret-key',
      model: 'gemini-2.5-flash',
      fetchImpl,
    });

    const result = await provider.generate({ prompt: 'hello' });

    expect(result).toEqual({ text: '{"ok":true}', provider: 'gemini', model: 'gemini-2.5-flash' });
    const [url, init] = callAt(fetchImpl);
    expect(url).toBe(`${DEFAULT_GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'secret-key' });
  });

  it('honours a custom base URL and strips a trailing slash', async () => {
    const fetchImpl = fetchMock(async () => textResponse(answer('ok')));
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      baseUrl: 'https://gateway.example/v1/',
      fetchImpl,
    });
    await provider.generate({ prompt: 'hi' });
    expect(callAt(fetchImpl)[0]).toBe('https://gateway.example/v1/models/m:generateContent');
  });

  it('keeps text and screenshots in the order the caller supplied them', async () => {
    const fetchImpl = fetchMock(async () => textResponse(answer('ok')));
    const provider = new GeminiModelProvider({ apiKey: 'key', model: 'm', fetchImpl });

    await provider.generate({
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', image: { mimeType: 'image/png', data: 'AAA' } },
        { type: 'text', text: 'after' },
        { type: 'image', image: { mimeType: 'image/png', data: 'BBB' } },
      ],
    });

    const body = JSON.parse(callAt(fetchImpl)[1].body as string);
    expect(body.contents[0].parts).toEqual([
      { text: 'before' },
      { inlineData: { mimeType: 'image/png', data: 'AAA' } },
      { text: 'after' },
      { inlineData: { mimeType: 'image/png', data: 'BBB' } },
    ]);
  });

  it('asks for a JSON response when a schema is supplied', async () => {
    const fetchImpl = fetchMock(async () => textResponse(answer('{}')));
    const provider = new GeminiModelProvider({ apiKey: 'key', model: 'm', fetchImpl });
    const schema = { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } };

    await provider.generate({
      prompt: 'hi',
      systemInstruction: 'be careful',
      responseSchema: schema,
    });

    const body = JSON.parse(callAt(fetchImpl)[1].body as string);
    expect(body.generationConfig).toEqual({
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: schema,
    });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be careful' }] });
  });

  it('maps a rejected key to a non-retryable permission error', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'bad',
      model: 'm',
      fetchImpl: fetchMock(async () => jsonResponse({}, 403)),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermissionError);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.auth);
    expect(isRetryableModelError(error)).toBe(false);
  });

  it('maps a rate limit to a retryable 429 error', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => jsonResponse({}, 429)),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.rateLimited);
    expect((error as AppError).statusCode).toBe(429);
    expect(isRetryableModelError(error)).toBe(true);
  });

  it('maps an outage to a retryable unavailable error', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => jsonResponse({}, 503)),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(isRetryableModelError(error)).toBe(true);
  });

  it('reports an unknown model as a non-retryable 404', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'ghost',
      fetchImpl: fetchMock(async () => jsonResponse({}, 404)),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.notFound);
    expect(isRetryableModelError(error)).toBe(false);
  });

  it('treats an empty candidate list as a retryable empty response', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => textResponse({ candidates: [] })),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.empty);
    expect(isRetryableModelError(error)).toBe(true);
  });

  it('surfaces a content block reason without retrying', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => textResponse({ promptFeedback: { blockReason: 'SAFETY' } })),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.blocked);
    expect((error as Error).message).toContain('SAFETY');
    expect(isRetryableModelError(error)).toBe(false);
  });

  it('marks a non-JSON body as a malformed response', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => new Response('<html>oops</html>', { status: 200 })),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.malformed);
    expect(isRetryableModelError(error)).toBe(true);
  });

  it('rethrows a caller cancellation instead of masking it', async () => {
    const controller = new AbortController();
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      }),
    });
    const error = await provider
      .generate({ prompt: 'hi', signal: controller.signal })
      .catch((e: unknown) => e);
    expect((error as Error).name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(AppError);
  });

  it('turns a network failure into an unavailable error', async () => {
    const provider = new GeminiModelProvider({
      apiKey: 'key',
      model: 'm',
      fetchImpl: fetchMock(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    const error = await provider.generate({ prompt: 'hi' }).catch((e: unknown) => e);
    expect((error as AppError).code).toBe(MODEL_ERROR_CODES.unavailable);
    expect(isRetryableModelError(error)).toBe(true);
  });

  it('rejects a missing key at construction time', () => {
    const build = () =>
      new GeminiModelProvider({
        apiKey: '',
        model: 'm',
        fetchImpl: fetchMock(async () => jsonResponse({})),
      });
    expect(build).toThrow(ValidationError);
    try {
      build();
    } catch (error) {
      expect((error as ValidationError).fields[0]).toMatchObject({ field: 'apiKey' });
    }
  });
});

function stubProvider(
  id: string,
  model: string,
  behaviour: () => Promise<{ text: string; provider: string; model: string }>,
): ModelProvider {
  return { id, model, generate: vi.fn(behaviour) };
}

describe('FallbackModelProvider', () => {
  const request: ModelRequest = { prompt: 'hi' };

  it('uses the first provider that answers', async () => {
    const first = stubProvider('a', 'a1', async () => ({
      text: 'first',
      provider: 'a',
      model: 'a1',
    }));
    const second = stubProvider('b', 'b1', async () => ({
      text: 'second',
      provider: 'b',
      model: 'b1',
    }));
    const chain = new FallbackModelProvider([first, second]);
    await expect(chain.generate(request)).resolves.toMatchObject({ text: 'first' });
    expect(second.generate).not.toHaveBeenCalled();
  });

  it('falls through a retryable failure to the next provider', async () => {
    const first = stubProvider('a', 'a1', async () => {
      throw new UnavailableError('down', MODEL_ERROR_CODES.unavailable);
    });
    const second = stubProvider('b', 'b1', async () => ({
      text: 'rescued',
      provider: 'b',
      model: 'b1',
    }));
    const onFallback = vi.fn();
    const chain = new FallbackModelProvider([first, second], { onFallback });
    await expect(chain.generate(request)).resolves.toMatchObject({ text: 'rescued' });
    expect(onFallback).toHaveBeenCalledWith('a', 'b', expect.any(Error));
  });

  it('does not retry a rejected key on another provider', async () => {
    const first = stubProvider('a', 'a1', async () => {
      throw new PermissionError('bad key', MODEL_ERROR_CODES.auth);
    });
    const second = stubProvider('b', 'b1', async () => ({
      text: 'unused',
      provider: 'b',
      model: 'b1',
    }));
    const chain = new FallbackModelProvider([first, second]);
    await expect(chain.generate(request)).rejects.toBeInstanceOf(PermissionError);
    expect(second.generate).not.toHaveBeenCalled();
  });

  it('reports every failure when the whole chain is exhausted', async () => {
    const first = stubProvider('a', 'a1', async () => {
      throw new AppError('rate limited', MODEL_ERROR_CODES.rateLimited, 429);
    });
    const second = stubProvider('b', 'b1', async () => {
      throw new AppError('still down', MODEL_ERROR_CODES.unavailable, 503);
    });
    const chain = new FallbackModelProvider([first, second]);
    const error = await chain.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as Error).message).toContain('a/a1');
    expect((error as Error).message).toContain('b/b1');
  });

  it('stops immediately when the caller cancels', async () => {
    const controller = new AbortController();
    const first = stubProvider('a', 'a1', async () => {
      controller.abort();
      throw new UnavailableError('down', MODEL_ERROR_CODES.unavailable);
    });
    const second = stubProvider('b', 'b1', async () => ({
      text: 'unused',
      provider: 'b',
      model: 'b1',
    }));
    const chain = new FallbackModelProvider([first, second]);
    await expect(
      chain.generate({ prompt: 'hi', signal: controller.signal }),
    ).rejects.toBeInstanceOf(UnavailableError);
    expect(second.generate).not.toHaveBeenCalled();
  });

  it('describes the configured order for diagnostics', () => {
    const chain = new FallbackModelProvider([
      stubProvider('a', 'a1', async () => ({ text: '', provider: 'a', model: 'a1' })),
      stubProvider('b', 'b1', async () => ({ text: '', provider: 'b', model: 'b1' })),
    ]);
    expect(chain.describe()).toEqual([
      { id: 'a', model: 'a1' },
      { id: 'b', model: 'b1' },
    ]);
    expect(chain.model).toBe('a1 -> b1');
  });

  it('refuses an empty chain', () => {
    expect(() => new FallbackModelProvider([])).toThrow(ValidationError);
  });
});
