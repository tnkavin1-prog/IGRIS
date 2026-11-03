import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('apps/local-bridge/.env', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.trim().startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const WS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const setup = {
  model: 'models/gemini-3.8-live-extended-thinking',
  generationConfig: { responseModalities: ['AUDIO'], thinkingConfig: { thinkingLevel: 'LOW' } },
  outputAudioTranscription: {},
  tools: [
    {
      functionDeclarations: [
        {
          name: 'echo_value',
          description: 'Echo a value back.',
          behavior: 'NON_BLOCKING',
          parameters: {
            type: 'OBJECT',
            properties: { value: { type: 'STRING' } },
            required: ['value'],
          },
        },
      ],
    },
  ],
};
const ws = new WebSocket(`${WS}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`);
let calls = 0,
  transcript = '';
ws.addEventListener('open', () => ws.send(JSON.stringify({ setup })));
ws.addEventListener('message', async (ev) => {
  const t = typeof ev.data === 'string' ? ev.data : await ev.data.text();
  const m = JSON.parse(t);
  if (m.setupComplete) {
    console.log('setup ok');
    ws.send(
      JSON.stringify({ realtimeInput: { text: 'Call the tool echo_value with value 123.' } }),
    );
  }
  if (m.serverContent?.outputTranscription?.text)
    transcript += m.serverContent.outputTranscription.text;
  if (m.toolCall) {
    calls++;
    console.log('TOOL CALL:', JSON.stringify(m.toolCall));
    ws.send(
      JSON.stringify({
        toolResponse: {
          functionResponses: m.toolCall.functionCalls.map((fc) => ({
            id: fc.id,
            name: fc.name,
            response: { result: { ok: true } },
          })),
        },
      }),
    );
  }
  if (m.goAway) console.log('goAway', JSON.stringify(m.goAway));
  if (m.error) console.log('ERR', JSON.stringify(m.error));
});
setTimeout(() => {
  console.log('after 55s: calls=', calls, 'transcript=', JSON.stringify(transcript));
  process.exit(0);
}, 55000);
