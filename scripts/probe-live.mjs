#!/usr/bin/env node
/**
 * Live API protocol probe.
 *
 * Purpose: empirically validate the Gemini Live API wire protocol before the
 * application depends on it. Never prints the API key or ephemeral token.
 *
 * Run: node scripts/probe-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'apps', 'local-bridge', '.env');

function loadEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing env file: ${file}`);
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = loadEnv(ENV_PATH);
const API_KEY = env.GEMINI_API_KEY;
if (!API_KEY || /PASTE_|REPLACE_/.test(API_KEY)) throw new Error('GEMINI_API_KEY not configured.');

const REST = 'https://generativelanguage.googleapis.com/v1beta';
const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService';
const results = [];
const log = (...a) => console.log(...a);

function record(name, status, detail) {
  results.push({ name, status, detail });
  log(`\n=== ${name}: ${status} ===`);
  if (detail) log(detail);
}

const ECHO_TOOL = {
  name: 'echo_value',
  description: 'Echo back a value. Used only for protocol testing.',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: { value: { type: 'STRING', description: 'Value to echo' } },
    required: ['value'],
  },
};

const SYSTEM =
  'You are a protocol test harness. When the user asks you to call a tool, call it immediately. Keep spoken replies under six words.';

async function createToken(kind, model) {
  const now = Date.now();
  let body;
  if (kind === 'legacy') {
    body = {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      bidiGenerateContentSetup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'] },
      },
      fieldMask: 'model,generationConfig.responseModalities',
    };
  } else {
    body = {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: {
        model: `models/${model}`,
        config: {
          responseModalities: ['AUDIO'],
          sessionResumption: {},
        },
      },
    };
  }
  const res = await fetch(`${REST}/auth_tokens`, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  record(
    `token-shape-${kind}`,
    'ACCEPTED',
    `keys=${Object.keys(json).join(',')} name=${String(json.name).slice(0, 14)}…`,
  );
  return json;
}

/** Run one Live session and collect observations. */
function runSession({
  label,
  url,
  setup,
  prompt,
  respondToTools = false,
  scheduling,
  timeoutMs = 45_000,
}) {
  return new Promise((resolve) => {
    const obs = {
      label,
      setupComplete: false,
      error: null,
      closeCode: null,
      closeReason: null,
      audioBytes: 0,
      audioChunks: 0,
      inputTranscript: '',
      outputTranscript: '',
      toolCalls: [],
      usage: null,
      textParts: [],
      interrupted: false,
      goAway: null,
      toolRoundTrip: false,
      serverMessages: [],
    };
    let ws;
    let done = false;
    let chain = Promise.resolve();
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close(1000, 'probe done');
      } catch {
        /* socket already closed */
      }
      resolve(obs);
    };
    const timer = setTimeout(finish, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      obs.error = `constructor: ${err.message}`;
      finish();
      return;
    }

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ setup }));
    });

    ws.addEventListener('message', (event) => {
      chain = chain
        .then(async () => {
          let msg;
          try {
            const text =
              typeof event.data === 'string'
                ? event.data
                : event.data instanceof Blob
                  ? await event.data.text()
                  : Buffer.from(event.data).toString('utf8');
            msg = JSON.parse(text);
          } catch {
            obs.serverMessages.push({ unparsed: String(event.data).slice(0, 300) });
            return;
          }
          const summary = { keys: Object.keys(msg) };
          if (msg.error) summary.error = msg.error;
          obs.serverMessages.push(summary);

          if (msg.setupComplete) {
            obs.setupComplete = true;
            ws.send(JSON.stringify({ realtimeInput: { text: prompt } }));
          }
          if (msg.serverContent) {
            const c = msg.serverContent;
            if (c.interrupted) obs.interrupted = true;
            if (c.inputTranscription?.text) obs.inputTranscript += c.inputTranscription.text;
            if (c.outputTranscription?.text) obs.outputTranscript += c.outputTranscription.text;
            for (const part of c.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                obs.audioChunks += 1;
                obs.audioBytes += Buffer.from(part.inlineData.data, 'base64').length;
              }
              if (part.text) obs.textParts.push(part.text.slice(0, 200));
            }
          }
          if (msg.usageMetadata) obs.usage = msg.usageMetadata;
          if (msg.goAway) obs.goAway = msg.goAway;
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls ?? []) {
              obs.toolCalls.push({ name: fc.name, id: fc.id, args: fc.args });
              if (respondToTools && scheduling) {
                const response = { result: { echoed: fc.args?.value ?? null, ok: true } };
                response.scheduling = scheduling;
                ws.send(
                  JSON.stringify({
                    toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response }] },
                  }),
                );
                obs.toolRoundTrip = true;
              } else if (respondToTools) {
                ws.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        { id: fc.id, name: fc.name, response: { result: { ok: true } } },
                      ],
                    },
                  }),
                );
                obs.toolRoundTrip = true;
              }
            }
            if (!respondToTools) setTimeout(finish, 1500);
          }
          if (msg.toolCallCancellation) obs.toolCallCancellation = msg.toolCallCancellation;
          if (msg.error) {
            obs.error = msg.error;
            finish();
          }
        })
        .catch((err) => {
          obs.error = `handler: ${err.message}`;
        });
    });

    ws.addEventListener('error', () => {
      obs.error = obs.error || 'websocket error';
    });

    ws.addEventListener('close', (event) => {
      obs.closeCode = event.code;
      obs.closeReason = event.reason;
      finish();
    });
  });
}

async function probeLegacyToken() {
  try {
    const t = await createToken('legacy', 'gemini-3.8-live');
    record(
      'token-create / legacy bidiGenerateContentSetup shape',
      'ACCEPTED',
      `name prefix=${String(t.name).slice(0, 8)}… expires=${t.expireTime}`,
    );
    return true;
  } catch (err) {
    record(
      'token-create / legacy bidiGenerateContentSetup shape',
      'REJECTED',
      `HTTP ${err.status}: ${err.message}`,
    );
    return false;
  }
}

async function probeModernToken() {
  try {
    const t = await createToken('modern', 'gemini-3.8-live');
    record(
      'token-create / liveConnectConstraints shape',
      'ACCEPTED',
      `expires=${t.expireTime} newSession=${t.newSessionExpireTime}`,
    );
    return t;
  } catch (err) {
    record(
      'token-create / liveConnectConstraints shape',
      'REJECTED',
      `HTTP ${err.status}: ${err.message}`,
    );
    return null;
  }
}

const baseGeneration = {
  responseModalities: ['AUDIO'],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
};

function reportSession(obs) {
  const detail = [
    `setupComplete=${obs.setupComplete}`,
    `audioChunks=${obs.audioChunks} audioBytes=${obs.audioBytes}`,
    `toolCalls=${obs.toolCalls.length}${obs.toolCalls.length ? ` (${obs.toolCalls.map((t) => t.name).join(',')})` : ''}`,
    `toolRoundTrip=${obs.toolRoundTrip}`,
    `outTranscript="${obs.outputTranscript.slice(0, 120)}"`,
    `inTranscript="${obs.inputTranscript.slice(0, 80)}"`,
    `close=${obs.closeCode ?? '-'} ${obs.closeReason ? JSON.stringify(obs.closeReason).slice(0, 240) : ''}`,
    obs.error ? `error=${JSON.stringify(obs.error).slice(0, 300)}` : '',
    obs.goAway ? `goAway=${JSON.stringify(obs.goAway)}` : '',
    obs.textParts.length ? `textParts=${JSON.stringify(obs.textParts).slice(0, 200)}` : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  const ok =
    obs.setupComplete &&
    !obs.error &&
    (obs.audioChunks > 0 || obs.toolCalls.length > 0 || obs.outputTranscript);
  record(obs.label, ok ? 'ACCEPTED' : 'REJECTED', detail);
  if (!ok) log(`  raw=${JSON.stringify(obs.serverMessages).slice(0, 1200)}`);
}

async function main() {
  log('Gemini Browser Live — protocol probe 2 (constrained + extended thinking)');
  log(`Key: ${API_KEY.slice(0, 3)}…(${API_KEY.length} chars) — not printed`);

  const token = await createToken('legacy', 'gemini-3.8-live');
  const fullSetup = {
    model: 'models/gemini-3.8-live',
    generationConfig: baseGeneration,
    systemInstruction: { parts: [{ text: SYSTEM }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} },
    realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
    tools: [{ functionDeclarations: [ECHO_TOOL] }],
  };

  // A. Ephemeral token + constrained endpoint + full client setup.
  const constrained = await runSession({
    label: 'ephemeral token / constrained endpoint / full setup + tool',
    url: `${WS_BASE}.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`,
    setup: fullSetup,
    prompt: 'Call the tool echo_value now with value "gamma".',
    respondToTools: true,
    scheduling: 'WHEN_IDLE',
    timeoutMs: 45_000,
  });
  reportSession(constrained);

  // B. Same token reused (uses:1 should refuse a second session).
  const reuse = await runSession({
    label: 'ephemeral token reuse (expect rejection, uses=1)',
    url: `${WS_BASE}.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`,
    setup: fullSetup,
    prompt: 'hello',
    timeoutMs: 15_000,
  });
  record(
    'single-use token enforcement',
    reuse.setupComplete ? 'REJECTED' : 'ACCEPTED',
    `setupComplete=${reuse.setupComplete} close=${reuse.closeCode} ${String(reuse.closeReason).slice(0, 200)}`,
  );

  // C. Extended thinking variants.
  for (const variant of [
    { name: 'no thinkingConfig', extra: {} },
    { name: 'thinkingLevel HIGH', extra: { thinkingConfig: { thinkingLevel: 'HIGH' } } },
    { name: 'thinkingLevel LOW', extra: { thinkingConfig: { thinkingLevel: 'LOW' } } },
  ]) {
    const obs = await runSession({
      label: `extended-thinking / ${variant.name} / async tool no scheduling`,
      url: `${WS_BASE}.BidiGenerateContent?key=${encodeURIComponent(API_KEY)}`,
      setup: {
        model: 'models/gemini-3.8-live-extended-thinking',
        generationConfig: { ...baseGeneration, ...variant.extra },
        systemInstruction: { parts: [{ text: SYSTEM }] },
        outputAudioTranscription: {},
        sessionResumption: {},
        contextWindowCompression: { slidingWindow: {} },
        tools: [{ functionDeclarations: [ECHO_TOOL] }],
      },
      prompt: 'Call the tool echo_value now with value "delta".',
      respondToTools: true,
      scheduling: undefined,
      timeoutMs: 55_000,
    });
    reportSession(obs);
  }

  // D. Extended thinking with a blocking tool declaration.
  const extBlocking = await runSession({
    label: 'extended-thinking / blocking tool declaration',
    url: `${WS_BASE}.BidiGenerateContent?key=${encodeURIComponent(API_KEY)}`,
    setup: {
      model: 'models/gemini-3.8-live-extended-thinking',
      generationConfig: baseGeneration,
      systemInstruction: { parts: [{ text: SYSTEM }] },
      outputAudioTranscription: {},
      sessionResumption: {},
      tools: [{ functionDeclarations: [{ ...ECHO_TOOL, behavior: 'BLOCKING' }] }],
    },
    prompt: 'Call the tool echo_value now with value "omega".',
    respondToTools: true,
    scheduling: undefined,
    timeoutMs: 45_000,
  });
  reportSession(extBlocking);

  const summary = results
    .map((r) => `${r.status === 'ACCEPTED' ? 'PASS' : 'FAIL'}  ${r.name}`)
    .join('\n');
  log('\n\n================ PROBE 2 SUMMARY ================');
  log(summary);
  log('=================================================');
  fs.writeFileSync(
    path.join(ROOT, 'docs', 'probe-results-2.json'),
    JSON.stringify(results, null, 2),
  );
}

await main();
