/**
 * Audio transcription via the Gemini REST API.
 *
 * The desktop HUD has no local speech-to-text engine. The Gemini API can
 * transcribe an audio file directly, so this module base64-encodes a WAV
 * (or any supported container) and asks the model for a transcript.
 *
 * The transcript is plain text; timestamps are requested but not guaranteed.
 */
import { readFile } from 'node:fs/promises';

export interface TranscriptionResult {
  ok: boolean;
  transcript: string;
  language?: string;
  error?: string;
}

export interface TranscriberOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'gemini-2.0-flash';

export async function transcribeAudio(
  filePath: string,
  options: TranscriberOptions,
): Promise<TranscriptionResult> {
  if (!options.apiKey) {
    return { ok: false, transcript: '', error: 'No Gemini API key configured.' };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    return {
      ok: false,
      transcript: '',
      error: `Could not read "${filePath}": ${(error as Error).message}`,
    };
  }

  const mimeType = guessMimeType(filePath);
  const model = options.model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Transcribe the speech in this audio. Return only the transcript, with no commentary.',
              },
              { inlineData: { mimeType, data: bytes.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return {
      ok: false,
      transcript: '',
      error: `Transcription request failed: ${(error as Error).message}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return {
      ok: false,
      transcript: '',
      error: `Transcription API returned HTTP ${response.status}: ${body.slice(0, 200)}`,
    };
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const transcript =
    payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim() || '';
  if (!transcript) {
    return { ok: false, transcript: '', error: 'The model returned no transcript.' };
  }
  return { ok: true, transcript };
}

function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mp3';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}
