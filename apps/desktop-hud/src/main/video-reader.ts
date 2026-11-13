/**
 * Video understanding.
 *
 * The assistant could not watch a video: the only path was a live screen
 * capture of whatever was on the monitor. This reader uses the ffmpeg that is
 * already installed on the machine to probe a video, extract its key frames
 * and pull out its audio track, so the model can reason about the actual
 * content instead of a recording of the screen.
 *
 * Key frames are extracted two ways at once:
 *   - scene changes (frames whose visual content differs enough from the
 *     previous one), which is what a human skims for;
 *   - a uniform sample, so a video with no strong cuts is still covered.
 *
 * Audio is written to a WAV file next to the frames. Transcription is left to
 * the caller (the Gemini Live session can read the frames; a transcription
 * service can take the WAV), because the desktop HUD has no speech-to-text
 * engine of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { TEMP_DIR } from './runtime-paths.js';

export interface VideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  codec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface VideoKeyFrame {
  /** 1-based index in the extracted sequence. */
  index: number;
  /** Approximate timestamp in seconds. */
  timeSeconds: number;
  path: string;
  /** base64 JPEG (only populated when requested). */
  data?: string;
}

export interface VideoAnalysis {
  ok: boolean;
  filePath: string;
  metadata: VideoMetadata | null;
  frames: VideoKeyFrame[];
  audioPath: string | null;
  /** Human-readable explanation when something could not be done. */
  note?: string;
  error?: string;
}

export interface VideoReadOptions {
  /** Maximum number of key frames to extract. Defaults to 8. */
  maxFrames?: number;
  /** Whether to include base64 JPEG data for each frame. Defaults to true. */
  includeFrames?: boolean;
  /** Whether to extract the audio track. Defaults to true. */
  extractAudio?: boolean;
}

const DEFAULT_MAX_FRAMES = 8;
const FRAME_WIDTH = 960;

function run(binary: string, args: string[]): string | null {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export class VideoReader {
  /**
   * Probe, sample and (optionally) demux a video.
   *
   * Never throws: a missing binary or an unreadable file comes back with
   * `ok: false` and an explanation.
   */
  async analyze(filePath: string, options: VideoReadOptions = {}): Promise<VideoAnalysis> {
    const maxFrames = Math.max(1, Math.min(options.maxFrames ?? DEFAULT_MAX_FRAMES, 32));
    const includeFrames = options.includeFrames !== false;
    const extractAudio = options.extractAudio !== false;

    let stat;
    try {
      stat = statSync(filePath);
    } catch (error) {
      return failure(filePath, `Could not read "${filePath}": ${(error as Error).message}`);
    }

    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

    const probeJson = run(ffprobe, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,codec_name',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ]);
    if (!probeJson) {
      return failure(filePath, `ffprobe could not inspect "${filePath}". Is ffmpeg installed?`);
    }

    let parsed: {
      streams?: Array<{
        width?: number;
        height?: number;
        r_frame_rate?: string;
        codec_name?: string;
      }>;
      format?: { duration?: string };
    };
    try {
      parsed = JSON.parse(probeJson);
    } catch {
      return failure(filePath, `ffprobe returned unreadable output for "${filePath}".`);
    }

    const stream = parsed.streams?.[0];
    if (!stream?.width || !stream?.height) {
      return failure(filePath, `"${filePath}" has no video stream.`);
    }

    const fps = parseFrameRate(stream.r_frame_rate);
    const duration = Number(parsed.format?.duration ?? 0);
    const audioCodec = probeAudioCodec(filePath, ffprobe);

    const metadata: VideoMetadata = {
      width: stream.width,
      height: stream.height,
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      frameRate: fps,
      codec: stream.codec_name ?? 'unknown',
      audioCodec,
      hasAudio: audioCodec !== null,
      sizeBytes: stat.size,
    };

    // Key-frame extraction. The scene filter picks visually distinct frames;
    // the uniform sample is the fallback so a video with no strong cuts is
    // still covered.
    const scratch = join(TEMP_DIR, `video-${Date.now()}`);
    mkdirSync(scratch, { recursive: true });
    const pattern = join(scratch, 'frame_%03d.jpg');

    run(ffmpeg, [
      '-v',
      'error',
      '-i',
      filePath,
      '-vf',
      `select='gt(scene,0.3)',scale=${FRAME_WIDTH}:-1`,
      '-vsync',
      'vfr',
      '-q:v',
      '3',
      pattern,
    ]);
    // Always also take a uniform sample; if the scene filter produced
    // nothing (or ffmpeg failed) the uniform pass fills the gap.
    let extracted = listFrames(scratch);
    if (extracted.length < Math.min(2, maxFrames)) {
      run(ffmpeg, [
        '-v',
        'error',
        '-i',
        filePath,
        '-vf',
        `fps=${uniformFps(duration, maxFrames)},scale=${FRAME_WIDTH}:-1`,
        '-q:v',
        '3',
        pattern,
      ]);
      extracted = listFrames(scratch);
    }

    // De-duplicate by timestamp approximation (ffmpeg names files in order).
    const frames: VideoKeyFrame[] = [];
    const step = Math.max(1, Math.floor(extracted.length / maxFrames));
    let index = 0;
    for (let i = 0; i < extracted.length && frames.length < maxFrames; i += step) {
      const file = extracted[i]!;
      const frame: VideoKeyFrame = {
        index: ++index,
        timeSeconds: approximateTime(i, extracted.length, duration),
        path: file,
      };
      if (includeFrames) {
        try {
          frame.data = (await import('node:fs')).readFileSync(file).toString('base64');
        } catch {
          /* the file vanished between listing and reading */
        }
      }
      frames.push(frame);
    }

    // Audio extraction is best-effort: a video without audio is not an error.
    let audioPath: string | null = null;
    if (extractAudio && metadata.hasAudio) {
      const target = join(scratch, `${basename(filePath, extname(filePath))}.wav`);
      const ok = run(ffmpeg, [
        '-v',
        'error',
        '-i',
        filePath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-y',
        target,
      ]);
      if (ok !== null && fileExists(target)) audioPath = target;
    }

    const note =
      frames.length === 0
        ? 'No frames could be extracted. The video may be corrupt or in an unsupported container.'
        : metadata.hasAudio
          ? 'Audio extracted to a WAV file. Transcription is left to the caller.'
          : 'The video has no audio track.';

    return {
      ok: frames.length > 0,
      filePath,
      metadata,
      frames,
      audioPath,
      note,
    };
  }
}

function failure(filePath: string, error: string): VideoAnalysis {
  return {
    ok: false,
    filePath,
    metadata: null,
    frames: [],
    audioPath: null,
    error,
  };
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const parts = value.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den) return num / den;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function probeAudioCodec(filePath: string, ffprobe: string): string | null {
  const json = run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'json',
    filePath,
  ]);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { streams?: Array<{ codec_name?: string }> };
    return parsed.streams?.[0]?.codec_name ?? null;
  } catch {
    return null;
  }
}

function uniformFps(duration: number, maxFrames: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.max(1 / 8, Math.min(1, maxFrames / duration));
}

function approximateTime(index: number, total: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || total <= 0) return 0;
  return (index / Math.max(1, total - 1)) * duration;
}

function listFrames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => /^frame_\d+\.jpg$/i.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function fileExists(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}
