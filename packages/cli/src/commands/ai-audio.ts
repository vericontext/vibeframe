/**
 * @module ai-audio
 * @description Library functions for transcribe, isolate, voice-clone, dub,
 * and duck. Powers the manifest tools `audio_transcribe`, `audio_isolate`,
 * `audio_clone_voice`, `audio_dub`, `audio_duck` (the user reaches these
 * via `vibe audio *`).
 *
 * The legacy `vibe ai transcribe / tts / sfx / isolate / voice-clone / music /
 * music-status / audio-restore / dub / duck` Commander registrations were
 * removed alongside the dead `commands/ai.ts` orchestrator (the `vibe ai *`
 * namespace was never `addCommand`'d to `program`).
 *
 * @see MODELS.md for AI model configuration
 */

import { resolve, dirname, basename, extname, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { ElevenLabsProvider } from "@vibeframe/ai-providers";
import { execSafe, commandExists } from "../utils/exec-safe.js";
import { detectFormat, formatTranscript } from "../utils/subtitle.js";
import { transcribeAudioFile } from "./_shared/transcription.js";
import { getConfiguredApiKey } from "../utils/api-key.js";
import { getAudioDuration } from "../utils/audio.js";
import { translateTexts } from "./_shared/translate-texts.js";
import { parseTtsProviderName, resolveTtsProvider } from "./_shared/tts-resolve.js";
import type { ProviderErrorKind } from "@vibeframe/ai-providers";

// ============================================================================
// Transcribe
// ============================================================================

export interface TranscribeOptions {
  audioPath: string;
  language?: string;
  output?: string;
  format?: string;
  apiKey?: string;
}

export interface TranscribeResult {
  success: boolean;
  text?: string;
  segments?: Array<{ startTime: number; endTime: number; text: string }>;
  detectedLanguage?: string;
  outputPath?: string;
  /** Subtitle format written to `outputPath` (json, srt, vtt). */
  format?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeTranscribe(options: TranscribeOptions): Promise<TranscribeResult> {
  const { audioPath, language, output, format, apiKey } = options;

  try {
    const absPath = resolve(process.cwd(), audioPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}`, errorKind: "not-found" };
    const key = await getConfiguredApiKey("OPENAI_API_KEY", apiKey);
    if (!key) return { success: false, error: "OPENAI_API_KEY required", errorKind: "auth" };

    const result = await transcribeAudioFile(absPath, { apiKey: key, language });

    if (result.status === "failed") {
      return { success: false, error: result.error || "Transcription failed", errorKind: result.errorKind };
    }

    let outputPath: string | undefined;
    let fmt: ReturnType<typeof detectFormat> | undefined;
    if (output) {
      outputPath = resolve(process.cwd(), output);
      fmt = detectFormat(output, format);
      await writeFile(outputPath, formatTranscript(result, fmt), "utf-8");
    }

    return {
      success: true,
      text: result.fullText,
      segments: result.segments?.map(s => ({ startTime: s.startTime, endTime: s.endTime, text: s.text })),
      detectedLanguage: result.detectedLanguage,
      outputPath,
      format: fmt,
    };
  } catch (error) {
    return { success: false, error: `Transcription failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// Audio Isolate (Vocal Extraction)
// ============================================================================

export interface IsolateOptions {
  audioPath: string;
  output?: string;
  apiKey?: string;
}

export interface IsolateResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeIsolate(options: IsolateOptions): Promise<IsolateResult> {
  const { audioPath, output = "vocals.mp3", apiKey } = options;

  try {
    const absPath = resolve(process.cwd(), audioPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}`, errorKind: "not-found" };
    const key = await getConfiguredApiKey("ELEVENLABS_API_KEY", apiKey);
    if (!key) return { success: false, error: "ELEVENLABS_API_KEY required", errorKind: "auth" };

    const audioBuffer = await readFile(absPath);
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: key });

    const result = await elevenlabs.isolateVocals(audioBuffer);
    if (!result.success || !result.audioBuffer) {
      return { success: false, error: result.error || "Audio isolation failed", errorKind: result.errorKind };
    }

    const outputPath = resolve(process.cwd(), output);
    await writeFile(outputPath, result.audioBuffer);

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `Audio isolation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// Voice Clone
// ============================================================================

export interface VoiceCloneOptions {
  samplePaths: string[];
  name: string;
  description?: string;
  labels?: Record<string, string>;
  removeNoise?: boolean;
  apiKey?: string;
}

export interface VoiceCloneResult {
  success: boolean;
  voiceId?: string;
  name?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeVoiceClone(options: VoiceCloneOptions): Promise<VoiceCloneResult> {
  const { samplePaths, name, description, labels, removeNoise, apiKey } = options;

  try {
    const key = await getConfiguredApiKey("ELEVENLABS_API_KEY", apiKey);
    if (!key) return { success: false, error: "ELEVENLABS_API_KEY required", errorKind: "auth" };

    if (!samplePaths || samplePaths.length === 0) {
      return { success: false, error: "At least one audio sample is required" };
    }

    const audioBuffers: Buffer[] = [];
    for (const samplePath of samplePaths) {
      const absPath = resolve(process.cwd(), samplePath);
      if (!existsSync(absPath)) return { success: false, error: `File not found: ${samplePath}`, errorKind: "not-found" };
      const buffer = await readFile(absPath);
      audioBuffers.push(buffer);
    }

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: key });

    const result = await elevenlabs.cloneVoice(audioBuffers, {
      name,
      description,
      labels,
      removeBackgroundNoise: removeNoise,
    });

    if (!result.success) return { success: false, error: result.error || "Voice cloning failed", errorKind: result.errorKind };

    return { success: true, voiceId: result.voiceId, name };
  } catch (error) {
    return { success: false, error: `Voice cloning failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// Dub (Multilingual Dubbing)
// ============================================================================

export interface DubOptions {
  mediaPath: string;
  /** Target language code or name ("ko", "Spanish"). */
  language: string;
  source?: string;
  /** Voice for the chosen TTS provider. */
  voice?: string;
  /** TTS provider: auto (default), elevenlabs, openai, kokoro. */
  tts?: string;
  analyzeOnly?: boolean;
  output?: string;
}

export interface DubResult {
  success: boolean;
  outputPath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segmentCount?: number;
  /** Each segment's timing with its original and translated text. */
  segments?: Array<{ startTime: number; endTime: number; original: string; translated: string }>;
  error?: string;
  errorKind?: ProviderErrorKind;
}

/** Longest speed-up applied to a dubbed line that overruns its slot; beyond it, lines overlap. */
const MAX_DUB_TEMPO = 1.5;

/**
 * Dub speech to another language: transcribe (Whisper), translate (Claude,
 * or OpenAI without an Anthropic key), speak each segment (any TTS
 * provider), and place each line at its segment's start time, speeding up
 * lines that would overrun their slot.
 */
export async function executeDub(options: DubOptions): Promise<DubResult> {
  const { mediaPath, language, source, voice, analyzeOnly, output } = options;
  const absPath = resolve(process.cwd(), mediaPath);
  if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}`, errorKind: "not-found" };
  const openaiKey = await getConfiguredApiKey("OPENAI_API_KEY");
  if (!openaiKey) return { success: false, error: "OPENAI_API_KEY required for Whisper transcription", errorKind: "auth" };

  const workDir = await mkdtemp(join(tmpdir(), "vibe-dub-"));
  try {
    const ext = extname(absPath).toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);
    let audioPath = absPath;
    if (isVideo) {
      audioPath = join(workDir, "source.mp3");
      await execSafe("ffmpeg", ["-y", "-loglevel", "error", "-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath]);
    }

    const transcript = await transcribeAudioFile(audioPath, { apiKey: openaiKey, language: source });
    if (transcript.status === "failed" || !transcript.segments?.length) {
      return {
        success: false,
        error: transcript.status === "failed" ? `Transcription failed: ${transcript.error}` : "No speech found to dub",
        errorKind: transcript.errorKind,
      };
    }
    const segments = transcript.segments;
    const translation = await translateTexts(segments.map((s) => s.text), { targetLanguage: language, sourceLanguage: source });
    if (!translation.success) return { success: false, error: translation.error, errorKind: translation.errorKind };

    const sourceLanguage = transcript.detectedLanguage || source || "auto";
    const report = segments.map((s, i) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      original: s.text,
      translated: translation.texts[i],
    }));
    const base: DubResult = {
      success: true,
      sourceLanguage,
      targetLanguage: language,
      segmentCount: segments.length,
      segments: report,
    };

    if (analyzeOnly) {
      if (!output) return base;
      const timingPath = resolve(process.cwd(), output);
      await writeFile(timingPath, JSON.stringify({ sourcePath: absPath, sourceLanguage, targetLanguage: language, segments: report }, null, 2));
      return { ...base, outputPath: timingPath };
    }

    const tts = await resolveTtsProvider(parseTtsProviderName(options.tts));
    const clips: Array<{ path: string; startTime: number; tempo: number }> = [];
    for (const [i, seg] of report.entries()) {
      const spoken = await tts.call(seg.translated, { voice });
      if (!spoken.success || !spoken.audioBuffer) {
        return { success: false, error: `Speech failed on segment ${i + 1}: ${spoken.error}`, errorKind: spoken.errorKind };
      }
      const clipPath = join(workDir, `line-${i}.${tts.audioExtension}`);
      await writeFile(clipPath, spoken.audioBuffer);
      const slot = Math.max(0.1, (report[i + 1]?.startTime ?? seg.endTime) - seg.startTime);
      const length = await getAudioDuration(clipPath);
      clips.push({ path: clipPath, startTime: seg.startTime, tempo: Math.min(MAX_DUB_TEMPO, Math.max(1, length / slot)) });
    }

    const outputExt = isVideo ? ".mp3" : ext || ".mp3";
    const finalOutputPath = resolve(
      process.cwd(),
      output || resolve(dirname(absPath), `${basename(absPath, extname(absPath))}-${language}${outputExt}`)
    );
    await mixAtOffsets(clips, finalOutputPath);
    return { ...base, outputPath: finalOutputPath };
  } catch (error) {
    return { success: false, error: `Dubbing failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Mix clips into one track, each starting at its offset (and sped up by its tempo). */
async function mixAtOffsets(clips: Array<{ path: string; startTime: number; tempo: number }>, outputPath: string): Promise<void> {
  const inputs = clips.flatMap((clip) => ["-i", clip.path]);
  const chains = clips.map((clip, i) => {
    const delay = Math.round(clip.startTime * 1000);
    const tempo = clip.tempo > 1.01 ? `atempo=${clip.tempo.toFixed(3)},` : "";
    return `[${i}:a]${tempo}adelay=${delay}|${delay}[a${i}]`;
  });
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0[out]`;
  await mkdir(dirname(outputPath), { recursive: true });
  await execSafe("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", [...chains, mix].join(";"), "-map", "[out]", outputPath]);
}

// ============================================================================
// Audio Duck (FFmpeg)
// ============================================================================

export interface DuckOptions {
  musicPath: string;
  voicePath: string;
  output?: string;
  threshold?: string;
  ratio?: string;
  attack?: string;
  release?: string;
}

export interface DuckResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function executeDuck(options: DuckOptions): Promise<DuckResult> {
  const {
    musicPath, voicePath,
    output, threshold = "-30", ratio = "3", attack = "20", release = "200",
  } = options;

  try {
    if (!commandExists("ffmpeg")) return { success: false, error: "FFmpeg not found" };

    const absMusicPath = resolve(process.cwd(), musicPath);
    const absVoicePath = resolve(process.cwd(), voicePath);

    if (!existsSync(absMusicPath)) return { success: false, error: `Music file not found: ${absMusicPath}` };
    if (!existsSync(absVoicePath)) return { success: false, error: `Voice file not found: ${absVoicePath}` };

    const defaultOutput = resolve(dirname(absMusicPath), `${basename(absMusicPath, extname(absMusicPath))}-ducked${extname(absMusicPath)}`);
    const outputPath = resolve(process.cwd(), output || defaultOutput);

    const filter = `[1:a]asplit=2[sc][mix];[0:a][sc]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}[ducked];[ducked][mix]amix=inputs=2:duration=longest`;

    await execSafe("ffmpeg", [
      "-i", absMusicPath, "-i", absVoicePath,
      "-filter_complex", filter,
      "-y", outputPath,
    ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

    if (!existsSync(outputPath)) return { success: false, error: "FFmpeg failed to create output" };

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `Audio ducking failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
