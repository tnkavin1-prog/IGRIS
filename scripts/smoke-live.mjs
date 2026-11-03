#!/usr/bin/env node
/**
 * End-to-end Live API smoke test.
 *
 * Proves the full credential path without opening Chrome:
 *   local .env → bridge health → ephemeral token → constrained Live WebSocket
 *   → setupComplete → one text turn → audio or transcript → turnComplete.
 *
 * The permanent API key never leaves the bridge process. The ephemeral token is
 * never printed. If the bridge is not already running, this script starts the
 * built server and stops it again on exit.
 *
 * Run: npm run smoke:live
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.GBL_ENV_FILE
  ? resolve(process.env.GBL_ENV_FILE)
  : join(root, 'apps', 'local-bridge', '.env');
const TURN_TIMEOUT_MS = 35_000;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exitCode = 1;
}

function parseDotEnv(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, equals).trim()] = value;
  }
  return out;
}

function loadEnv() {
  if (!existsSync(envFile)) {
    fail(`No bridge configuration at ${envFile}. Run scripts/setup-windows.ps1 first.`);
    return null;
  }
  const env = parseDotEnv(readFileSync(envFile, 'utf8'));
  const port = Number(env.PORT || 47_821);
  const secret = String(env.LOCAL_GATE_SECRET || '').trim();
  const extensionId = String(env.ALLOWED_EXTENSION_IDS || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!secret || secret.length < 32) {
    fail('LOCAL_GATE_SECRET is missing or too short in the bridge .env.');
    return null;
  }
  if (!/^[a-p]{32}$/.test(extensionId || '')) {
    fail('ALLOWED_EXTENSION_IDS must contain the 32-character extension id.');
    return null;
  }
  return { port, secret, extensionId };
}

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function ensureBridge(port) {
  const existing = await health(port);
  if (existing) return { child: null, health: existing };

  const server = join(root, 'apps', 'local-bridge', 'dist', 'server.mjs');
  if (!existsSync(server)) {
    fail('The bridge bundle is missing. Run: npm run build');
    return null;
  }

  console.log('▸ Starting the built local bridge for the smoke test');
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.resume();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    if (child.exitCode !== null) {
      fail(`The bridge exited before becoming healthy.\n${stderr.slice(0, 800)}`);
      return null;
    }
    const status = await health(port);
    if (status) return { child, health: status };
  }

  child.kill();
  fail('The bridge did not become healthy within 10 seconds.');
  return null;
}

async function mintToken({ port, secret, extensionId }) {
  const response = await fetch(`http://127.0.0.1:${port}/api/token`, {
    method: 'POST',
    headers: {
      Origin: `chrome-extension://${extensionId}`,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ model: 'gemini-3.8-live' }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Token mint failed (HTTP ${response.status}): ${body.error ?? 'unknown error'}`,
    );
  }
  if (!body.token || !body.expiresAt) throw new Error('Token response is missing fields.');
  return body;
}

async function readMessage(event) {
  const data = event.data;
  if (typeof data === 'string') return data;
  if (data && typeof data.text === 'function') return data.text();
  return Buffer.from(data).toString('utf8');
}

async function liveTurn(token) {
  const url =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained' +
    `?access_token=${encodeURIComponent(token.token)}`;

  const ws = new WebSocket(url);
  const startedAt = Date.now();
  let setupAt = null;
  let firstAudioAt = null;
  let audioBytes = 0;
  let transcript = '';
  let turnComplete = false;
  let serverError = null;
  let closed = null;

  const finished = new Promise((resolveTurn) => {
    const timer = setTimeout(() => resolveTurn(), TURN_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      resolveTurn();
    };

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: 'models/gemini-3.8-live',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
              },
            },
            systemInstruction: {
              parts: [
                {
                  text: 'You are a connectivity smoke test. Answer in one short spoken sentence.',
                },
              ],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      );
    });

    ws.addEventListener('message', (event) => {
      void readMessage(event).then((text) => {
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.setupComplete) {
          setupAt = Date.now();
          ws.send(
            JSON.stringify({
              clientContent: {
                turns: [{ role: 'user', parts: [{ text: 'Say exactly: smoke test passed.' }] }],
                turnComplete: true,
              },
            }),
          );
          return;
        }
        if (message.error) {
          serverError = message.error;
          finish();
          return;
        }
        const content = message.serverContent;
        if (!content) return;
        if (content.outputTranscription?.text) transcript += content.outputTranscription.text;
        for (const part of content.modelTurn?.parts ?? []) {
          const encoded = part.inlineData?.data;
          if (encoded) {
            if (firstAudioAt === null) firstAudioAt = Date.now();
            audioBytes += Math.floor((encoded.length * 3) / 4);
          }
        }
        if (content.turnComplete || content.generationComplete) {
          turnComplete = true;
          finish();
        }
      });
    });

    ws.addEventListener('error', () => {
      serverError = { message: 'WebSocket error' };
      finish();
    });
    ws.addEventListener('close', (event) => {
      closed = { code: event.code, reason: event.reason };
      finish();
    });
  });

  await finished;
  try {
    ws.close(1000, 'smoke done');
  } catch {
    // Already closed.
  }

  return {
    setupMs: setupAt ? setupAt - startedAt : null,
    firstAudioMs: firstAudioAt ? firstAudioAt - startedAt : null,
    audioBytes,
    transcript: transcript.trim(),
    turnComplete,
    serverError,
    closed,
    totalMs: Date.now() - startedAt,
  };
}

async function main() {
  const env = loadEnv();
  if (!env) return;

  const bridge = await ensureBridge(env.port);
  if (!bridge) return;

  try {
    if (!bridge.health.keyConfigured) fail('The bridge reports no API key configured.');
    if (!bridge.health.originsConfigured) fail('The bridge reports no extension allowlist.');

    console.log(`▸ Bridge healthy on 127.0.0.1:${env.port}`);
    const token = await mintToken(env);
    console.log(`▸ Ephemeral token minted (expires ${token.expiresAt})`);

    const result = await liveTurn(token);
    if (result.serverError) {
      fail(`Live API error: ${result.serverError.message ?? JSON.stringify(result.serverError)}`);
      return;
    }
    if (!result.setupMs) {
      fail('The Live setup handshake did not complete.');
      return;
    }
    const heard = result.audioBytes > 0 || result.transcript.length > 0;
    if (!result.turnComplete || !heard) {
      fail(
        `The Live turn produced no usable response (audio=${result.audioBytes} bytes, transcript=${result.transcript.length} chars).`,
      );
      return;
    }

    console.log(`▸ Setup complete in ${result.setupMs} ms`);
    if (result.firstAudioMs !== null) {
      console.log(`▸ First audio in ${result.firstAudioMs} ms (${result.audioBytes} bytes)`);
    }
    if (result.transcript) {
      console.log(`▸ Transcript: ${result.transcript.slice(0, 200)}`);
    }
    console.log(`\n✔ PASS — Live API round-trip completed in ${result.totalMs} ms\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    bridge.child?.kill();
  }
}

void main();
