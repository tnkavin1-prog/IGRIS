#!/usr/bin/env node
/** Focused probe: is extended-thinking function calling viable in this environment? */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const raw of fs
  .readFileSync(path.join(ROOT, 'apps/local-bridge/.env'), 'utf8')
  .split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const API_KEY = env.GEMINI_API_KEY;
const WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const out = [];

function session(label, setup, prompt, timeoutMs = 40_000) {
  return new Promise((resolve) => {
    const obs = {
      label,
      setupComplete: false,
      toolCalls: [],
      audio: 0,
      transcript: '',
      text: [],
      close: null,
      reason: '',
      error: null,
      resumptionUpdates: 0,
      usage: null,
    };
    let done = false,
      chain = Promise.resolve();
    const ws = new WebSocket(`${WS}?key=${encodeURIComponent(API_KEY)}`);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try {
        ws.close(1000, 'done');
      } catch {
        /* socket already closed */
      }
      resolve(obs);
    };
    const t = setTimeout(finish, timeoutMs);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ setup })));
    ws.addEventListener('message', (ev) => {
      chain = chain
        .then(async () => {
          const txt =
            typeof ev.data === 'string'
              ? ev.data
              : ev.data instanceof Blob
                ? await ev.data.text()
                : Buffer.from(ev.data).toString();
          const m = JSON.parse(txt);
          if (m.setupComplete) {
            obs.setupComplete = true;
            ws.send(JSON.stringify({ realtimeInput: { text: prompt } }));
          }
          if (m.sessionResumptionUpdate) obs.resumptionUpdates++;
          if (m.usageMetadata) obs.usage = m.usageMetadata;
          if (m.goAway) obs.goAway = m.goAway;
          if (m.error) {
            obs.error = m.error;
            finish();
          }
          if (m.serverContent) {
            if (m.serverContent.outputTranscription?.text)
              obs.transcript += m.serverContent.outputTranscription.text;
            for (const p of m.serverContent.modelTurn?.parts ?? []) {
              if (p.inlineData?.data) obs.audio += Buffer.from(p.inlineData.data, 'base64').length;
              if (p.text) obs.text.push(p.text.slice(0, 160));
            }
            if (m.serverContent.turnComplete) setTimeout(finish, 900);
          }
          if (m.toolCall) {
            for (const fc of m.toolCall.functionCalls ?? []) {
              obs.toolCalls.push({ name: fc.name, args: fc.args, id: fc.id });
              ws.send(
                JSON.stringify({
                  toolResponse: {
                    functionResponses: [
                      { id: fc.id, name: fc.name, response: { result: { ok: true } } },
                    ],
                  },
                }),
              );
            }
          }
        })
        .catch((e) => {
          obs.error = `handler: ${e.message}`;
        });
    });
    ws.addEventListener('close', (e) => {
      obs.close = e.code;
      obs.reason = e.reason;
      finish();
    });
    ws.addEventListener('error', () => {
      obs.error = obs.error || 'ws error';
    });
  });
}

const base = {
  model: 'models/gemini-3.8-live-extended-thinking',
  generationConfig: {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    thinkingConfig: { thinkingLevel: 'LOW' },
  },
  outputAudioTranscription: {},
};
const minimalTool = { name: 'ping', description: 'Ping the test harness. No arguments.' };
const echoTool = {
  name: 'echo_value',
  description: 'Echo a value back.',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: { value: { type: 'STRING', description: 'Value' } },
    required: ['value'],
  },
};

const scenarios = [
  [
    'control / no tools / reasoning',
    { ...base, systemInstruction: { parts: [{ text: 'Answer in one short sentence.' }] } },
    'What is 2+2?',
  ],
  [
    'minimal tool / no params / no behavior',
    { ...base, tools: [{ functionDeclarations: [minimalTool] }] },
    'Call the tool ping now.',
  ],
  [
    'echo tool / NON_BLOCKING',
    { ...base, tools: [{ functionDeclarations: [echoTool] }] },
    'Call the tool echo_value with value "x".',
  ],
  [
    'echo tool / includeThoughts',
    {
      ...base,
      generationConfig: {
        ...base.generationConfig,
        thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: true },
      },
      tools: [{ functionDeclarations: [echoTool] }],
    },
    'Call the tool echo_value with value "y".',
  ],
];

for (const [label, setup, prompt] of scenarios) {
  const r = await session(label, setup, prompt);
  const ok = r.setupComplete && !r.error;
  console.log(`\n=== ${label} ===`);
  console.log(
    `  setup=${ok} audio=${r.audio}B toolCalls=${r.toolCalls.length}${r.toolCalls.length ? ' ' + JSON.stringify(r.toolCalls) : ''}`,
  );
  console.log(
    `  transcript="${r.transcript.slice(0, 160)}" text=${JSON.stringify(r.text).slice(0, 200)}`,
  );
  console.log(
    `  close=${r.close} ${r.reason ? JSON.stringify(r.reason) : ''}${r.error ? ' error=' + JSON.stringify(r.error).slice(0, 200) : ''}`,
  );
  out.push({
    label,
    setupComplete: r.setupComplete,
    audioBytes: r.audio,
    toolCalls: r.toolCalls,
    transcript: r.transcript,
    text: r.text,
    close: r.close,
    reason: r.reason,
    error: r.error,
    resumptionUpdates: r.resumptionUpdates,
    usage: r.usage,
  });
}
fs.writeFileSync(path.join(ROOT, 'docs', 'probe-results-3.json'), JSON.stringify(out, null, 2));
