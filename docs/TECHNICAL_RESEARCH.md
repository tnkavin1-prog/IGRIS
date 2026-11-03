# Technical Research

This document records what was verified against the live Gemini API on **2026-11-03**, including the approaches that failed. The goal is to make the protocol decisions auditable and to stop future work from re-litigating dead ends.

Environment: Node.js v24.18.0, Windows 11, `@google/genai` not used — the probes speak the raw WebSocket and REST protocols so the extension can do the same.

Reproduction scripts:

| Script                       | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `scripts/probe-live.mjs`     | Token shapes, direct-key connection, nested config, async tools, scheduling |
| `scripts/probe-extended.mjs` | Extended-thinking model, thinking levels, tool declaration modes            |
| `scripts/probe-ext-wait.mjs` | Longer waits for extended-thinking tool attempts                            |
| `scripts/smoke-live.mjs`     | Production-path smoke test through the built bridge                         |

Raw evidence: `docs/probe-results.json`, `docs/probe-results-2.json`, `docs/probe-results-3.json`, `docs/evidence/probe-out*.txt`.

---

## 1. Summary of findings

| #   | Finding                                                                     | Status                    |
| --- | --------------------------------------------------------------------------- | ------------------------- |
| 1   | Legacy `bidiGenerateContentSetup` + `fieldMask` token shape works           | ✅ Accepted               |
| 2   | `liveConnectConstraints` token shape is rejected                            | ❌ HTTP 400               |
| 3   | Ephemeral token works with the constrained WebSocket endpoint               | ✅ Verified               |
| 4   | `generationConfig` must be nested                                           | ✅ Required               |
| 5   | Flattened `responseModalities` is rejected                                  | ❌ Rejected               |
| 6   | `gemini-3.8-live` supports async tools and `WHEN_IDLE` scheduling           | ✅ Round trip verified    |
| 7   | Ephemeral tokens are single-use                                             | ✅ Enforced by server     |
| 8   | `sessionResumption: {}` is required for a fresh session to receive a handle | ✅ Verified               |
| 9   | Extended-thinking requires `thinkingLevel`                                  | ✅ Required               |
| 10  | Extended-thinking rejects `BLOCKING` function declarations                  | ❌ Close 1007             |
| 11  | Extended-thinking never emitted a tool call in any probe                    | ⚠️ Unusable for tools     |
| 12  | Direct API key works on the unconstrained endpoint                          | ✅ Verified (probes only) |

---

## 2. Ephemeral token shape

### What works

```http
POST https://generativelanguage.googleapis.com/v1beta/auth_tokens
x-goog-api-key: <permanent key>
Content-Type: application/json

{
  "uses": 1,
  "expireTime": "2026-11-03T23:45:00.000Z",
  "newSessionExpireTime": "2026-11-03T23:01:00.000Z",
  "bidiGenerateContentSetup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": { "responseModalities": ["AUDIO"] }
  },
  "fieldMask": "model,generationConfig.responseModalities"
}
```

Response:

```json
{
  "name": "auth_tokens/…",
  "expireTime": "…",
  "newSessionExpireTime": "…"
}
```

Probe result (`token-shape-legacy`): `ACCEPTED — keys=name name=auth_tokens/dd…`

### What fails

```json
{
  "liveConnectConstraints": {
    "model": "models/gemini-3.8-live"
  }
}
```

Response:

```
HTTP 400: Invalid JSON payload received. Unknown name "liveConnectConstraints"
at 'auth_token': Cannot find field.
```

The newer constraint shape documented in some places is not accepted by the `v1beta` REST surface this project targets. The legacy setup + field mask is used instead.

### Design consequence

The bridge locks the model and audio modality server-side. The client supplies the system instruction, tools, and session options in the Live setup message. This keeps the token minimal and prevents a compromised extension from requesting a different model.

---

## 3. WebSocket endpoints

| Endpoint                                                      | Credential      | Use                  |
| ------------------------------------------------------------- | --------------- | -------------------- |
| `wss://…/BidiGenerateContent?key=<apiKey>`                    | Permanent key   | Protocol probes only |
| `wss://…/BidiGenerateContentConstrained?access_token=<token>` | Ephemeral token | Production           |

The constrained endpoint accepted a full setup with tools:

```
setupComplete=true
audioChunks=7 audioBytes=61442
toolCalls=1 (echo_value)
toolRoundTrip=true
outTranscript="Returned gamma."
```

This is the critical proof that the production path — ephemeral token, constrained endpoint, tools, audio — works end to end.

---

## 4. Setup payload constraints

### Nested `generationConfig`

Accepted:

```json
{
  "model": "models/gemini-3.8-live",
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Kore" } }
    }
  }
}
```

Rejected:

```json
{
  "model": "models/gemini-3.8-live",
  "responseModalities": ["AUDIO"]
}
```

The flattened form is a common mistake when copying examples from different API versions. The setup builder in `apps/chrome-extension/src/live/setup.ts` is pure and unit-tested against this shape.

### `thinkingConfig`

- `gemini-3.8-live`: rejects `thinkingConfig` entirely. The setup builder omits it.
- `gemini-3.8-live-extended-thinking`: requires it. Omitting it closes with `1007 "Thinking level must be specified for this model."`

### `sessionResumption`

Sending `sessionResumption: {}` on a fresh session causes the server to emit resumption handles. Without it, a fresh session never receives one, so a reconnect after a network blip loses the conversation.

With a handle:

```json
{ "sessionResumption": { "handle": "…" } }
```

### `contextWindowCompression`

```json
{ "contextWindowCompression": { "slidingWindow": {} } }
```

Keeps long sessions from growing without bound. Enabled by default.

### `realtimeInputConfig`

Automatic activity detection with:

- `START_SENSITIVITY_HIGH`
- `END_SENSITIVITY_LOW`
- `prefixPaddingMs` clamped to 0–500
- `silenceDurationMs` clamped to 200–2000

These bounds keep a bad settings value from breaking the session.

---

## 5. Tool calling

### `gemini-3.8-live`

Verified working:

```
direct key / nested generationConfig / async tool / WHEN_IDLE: ACCEPTED
setupComplete=true
audioChunks=5 audioBytes=88800
toolCalls=1 (echo_value)
toolRoundTrip=true
outTranscript="Echoed alpha successfully."
```

What this proves:

- asynchronous function declarations are accepted,
- the model emits `toolCall` messages,
- a `functionResponse` with `scheduling: WHEN_IDLE` is accepted,
- the model continues the turn after the response.

### `gemini-3.8-live-extended-thinking`

Every configuration failed to produce a tool call:

| Configuration                                      | Result                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `thinkingLevel: MEDIUM`, async tool, no scheduling | `toolCalls=0`, transcript “Doing that for you right now. I apologize, but a system error occurred.” |
| `thinkingLevel: HIGH`, async tool, no scheduling   | `toolCalls=0`, “I will call the tool now. A system error occurred.”                                 |
| `thinkingLevel: LOW`, async tool, no scheduling    | `toolCalls=0`, “Let me run that for you. I'm sorry, a system error occurred.”                       |
| `BLOCKING` declaration                             | Rejected: `1007 "BLOCKING function calls are not supported for this model."`                        |
| No tools, reasoning only                           | Works: “The answer is 4.”                                                                           |

Additional control probes (`probe-results-3.json`) with a minimal tool, `NON_BLOCKING`, and `includeThoughts` all produced `toolCalls=0` and a spoken “let me do that” followed by no action.

**Conclusion:** in the current API version, the extended-thinking model cannot be trusted to execute browser tools. It is offered as a conversation-only model, and the UI disables browser control when it is selected.

This is not a prompt-engineering problem; it is a protocol/model limitation.

---

## 6. Single-use tokens

Reusing a token:

```
setupComplete=false close=1011 Token has been used too many times
```

Consequences for the client:

- every reconnect must mint a fresh token,
- the session manager does exactly that,
- token rotation happens before expiry, not after failure,
- a failed mint surfaces a typed bridge error rather than a silent retry loop.

---

## 7. Audio contract

| Direction | Format                     | Rate   | Frame                           |
| --------- | -------------------------- | ------ | ------------------------------- |
| Input     | signed 16-bit LE PCM, mono | 16 kHz | 32 ms (512 samples, 1024 bytes) |
| Output    | signed 16-bit LE PCM, mono | 24 kHz | server-defined chunks           |

The browser's `AudioContext` often runs at 44.1 or 48 kHz. The capture worklet performs a streaming linear resample to exactly 16 kHz. A fallback `resampler.ts` exists for environments without AudioWorklet.

Playback decodes base64 PCM into Float32 and feeds a ring buffer. The ring buffer is what makes barge-in instant: on `interrupted`, the buffer is cleared without recreating the AudioContext.

### Node WebSocket quirk

Node's global `WebSocket` delivers `Blob` payloads. The probe and smoke scripts must `await event.data.text()` before `JSON.parse`. The extension's browser WebSocket delivers strings for text frames, but the client handles both for safety.

---

## 8. Latency observations

From the production-path smoke test (`npm run smoke:live`):

| Metric                       | Value                |
| ---------------------------- | -------------------- |
| Token mint + connect + setup | ~1,687 ms            |
| First audio byte             | ~2,171 ms            |
| Audio received               | 68,643 bytes         |
| Transcript                   | “Smoke test passed.” |
| Total turn                   | ~2,360 ms            |

These are single-run observations on a residential connection, not a benchmark. They establish that the path is functional and in a usable latency range.

### Token usage

From `probe-results-3.json`, a simple reasoning turn with a large system instruction:

| Field            | Tokens |
| ---------------- | ------ |
| Prompt (text)    | 2,620  |
| Prompt (audio)   | 168    |
| Response (audio) | 43     |
| Total            | 2,942  |

The system instruction and tool declarations dominate prompt size. This is why tool responses are capped at 14,000 characters and page snapshots at 9,000.

---

## 9. Rejected approaches

### `liveConnectConstraints`

Rejected by the API. Documented above.

### Flattened `responseModalities`

Rejected. Nested `generationConfig` is required.

### Extended thinking for browser control

The model either refuses to call tools or emits a spoken promise followed by a “system error”. Unusable for an agent that must act.

### Fastify for the bridge

The original plan used Fastify. The implemented bridge uses `node:http` instead:

- three routes,
- explicit host/origin/body/rate checks,
- no framework supply chain,
- trivially unit-testable with `fetch` against a real server.

This is a deliberate, documented deviation. The security properties are stronger when every check is visible in one file.

### IPv6 loopback in CSP

`http://[::1]:*` and `ws://[::1]:*` are rejected by Chrome's extension CSP parser. The bridge URL validator accepts only `127.0.0.1` and `localhost`.

### Persistent content script

A content script on every page at every load was rejected in favour of on-demand injection:

- less overhead,
- smaller privacy surface,
- no stale script after an extension update.

The cost is injection latency on the first tool call per tab.

### Storing the API key in the extension

Rejected outright. Chrome storage is not an appropriate secret store for a long-lived key, and any extension compromise would expose it. The bridge exists specifically to avoid this.

---

## 10. Model registry rationale

`packages/shared/src/models.ts` is the only place model IDs appear. Each entry records verified capability flags:

```ts
{
  id: 'gemini-3.8-live',
  toolCalling: true,
  requiresThinkingLevel: false,
  supportsScheduling: true,
  latency: 'low'
}
```

```ts
{
  id: 'gemini-3.8-live-extended-thinking',
  toolCalling: false,
  requiresThinkingLevel: true,
  thinkingLevels: ['LOW', 'MEDIUM', 'HIGH'],
  supportsScheduling: false,
  latency: 'high'
}
```

The UI, setup builder, orchestrator, and bridge allowlist all derive from these flags. A model cannot be offered for browser control unless `toolCalling` is true.

---

## 11. Open questions

| Question                                                                | Current state                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Will extended-thinking gain tool support?                               | Unknown; re-probe before enabling                           |
| Does the constrained endpoint accept a system instruction in the token? | Not needed; sent in setup                                   |
| Optimal VAD settings per language                                       | Defaults are conservative; tunable in Settings              |
| Multi-tab parallel tool execution                                       | Serialized by design; could be revisited with per-tab locks |
| Token cost of screenshots                                               | Not measured; screenshots are opt-in                        |
| Behaviour on very long sessions                                         | Sliding window enabled; not stress-tested beyond smoke      |

---

## 12. Reproducing the probes

```powershell
# Requires a real key in apps/local-bridge/.env
node scripts/probe-live.mjs
node scripts/probe-extended.mjs
node scripts/probe-ext-wait.mjs
```

The probes print progress and write `docs/probe-results*.json`. They do not print the API key. Treat their output as potentially sensitive: it can contain model transcripts.

For the production path:

```powershell
npm run build
npm run bridge        # in another terminal
npm run smoke:live
```

The smoke test starts the bridge itself if it is not already running, mints a token through the real bridge, connects to the constrained endpoint, sends one text turn, and asserts that audio or a transcript arrived.
