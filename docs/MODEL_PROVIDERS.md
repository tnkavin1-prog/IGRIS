# Model providers and fallback

Gemetron's autonomous planner does not call a vendor SDK directly. Every model
call goes through one interface, `ModelProvider`, defined in
`apps/desktop-hud/src/main/model-provider.ts`.

That indirection exists so a rate limit, an expired key, a safety block and a
malformed response produce different, typed failures instead of one generic
`Error`, and so a second model can take over automatically.

## The interface

```ts
interface ModelProvider {
  readonly id: string; // short provider name, e.g. "gemini"
  readonly model: string; // model identifier, used in logs and errors
  generate(request: ModelRequest): Promise<ModelResult>;
}
```

`ModelRequest` carries a prompt (or an ordered `content` list that interleaves
text and screenshots), an optional system instruction, an optional JSON schema
for structured output, a temperature, a cancellation `AbortSignal`, and a
per-call timeout.

`ModelResult` carries the text, plus the provider and model that answered.

## Included providers

| Provider                | Notes                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| `GeminiModelProvider`   | Google Generative Language `generateContent`. Configurable base URL for gateways. |
| `FallbackModelProvider` | Tries an ordered list of providers; never calls the network itself.               |

There is no bundled second vendor. The interface is the extension point: a local
model, an OpenAI-compatible gateway or a hosted router implements the same four
members and can be injected into the planner with `options.provider`.

## Fallback policy

`FallbackModelProvider` tries providers in order and moves to the next one only
for failures where another model could plausibly succeed:

| Failure                                     | Error code                 | Retry / fall back? |
| ------------------------------------------- | -------------------------- | ------------------ |
| Rate limit (HTTP 429)                       | `MODEL_RATE_LIMITED`       | Yes                |
| Provider outage (HTTP 5xx, network failure) | `MODEL_UNAVAILABLE`        | Yes                |
| Timeout                                     | `TIMEOUT`                  | Yes                |
| Empty answer / unusable answer              | `MODEL_EMPTY_RESPONSE`     | Yes                |
| Body that is not JSON                       | `MODEL_MALFORMED_RESPONSE` | Yes                |
| Rejected key (HTTP 401/403)                 | `MODEL_AUTH`               | No                 |
| Rejected request (HTTP 400/422)             | `MODEL_BAD_REQUEST`        | No                 |
| Unknown model (HTTP 404)                    | `MODEL_NOT_FOUND`          | No                 |
| Safety block                                | `MODEL_BLOCKED`            | No                 |
| Caller cancelled the task                   | the original `AbortError`  | No                 |

Retrying a rejected key or a cancelled task on another endpoint hides the real
problem, so those stop the chain immediately. When every provider has failed the
thrown error lists each attempt in order.

## Configuration

| Variable                      | Default                                            | Meaning                                                        |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `GEMINI_AGENT_MODEL`          | `gemini-2.5-flash`                                 | Primary model for the autonomous vision planner.               |
| `GEMINI_AGENT_FALLBACK_MODEL` | _(empty)_                                          | Comma-separated models tried in order after the primary fails. |
| `GEMINI_AGENT_BASE_URL`       | `https://generativelanguage.googleapis.com/v1beta` | Endpoint override for a compatible gateway or regional host.   |

The API key still comes from the HUD settings (`settings.apiKey`), not from the
environment, so it stays in the encrypted settings store rather than in a shell
profile.

## Adding a provider

1. Implement `ModelProvider`: give it a stable `id`, the model name, and a
   `generate` method that returns `{ text, provider: id, model }`.
2. Throw the typed errors from `errors.ts` so the fallback policy can classify
   the failure. Map HTTP status codes the same way `GeminiModelProvider` does.
3. Pass it to the planner:

```ts
autonomousAgent.configure(
  new GeminiVisionPlanner(() => ({ apiKey, model: process.env.GEMINI_AGENT_MODEL! }), {
    provider: new FallbackModelProvider([primary, secondary]),
  }),
  { computerVision, appManager, nativeInput, auditor },
);
```

4. Add a test with a fake `fetchImpl` (or a stub provider) covering the success
   path and each error class you map.

## Tests

- `tests/unit/desktop/model-provider.test.ts` — transport, error mapping,
  content ordering, cancellation, fallback policy.
- `tests/unit/desktop/vision-planner.test.ts` — the planner's request shape,
  decision validation and provider injection.
