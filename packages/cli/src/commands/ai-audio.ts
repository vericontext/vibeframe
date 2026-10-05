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

import { resolve, dirname, basename, extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  ElevenLabsProvider,
  ClaudeProvider,
} from "@vibeframe/ai-providers";
import { execSafe, execSafeSync, commandExists } from "../utils/exec-safe.js";
import { detectFormat, formatTranscript } from "../utils/subtitle.js";
import { transcribeAudioFile } from "./_shared/transcription.js";
import { getConfiguredApiKey } from "../utils/api-key.js";
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
  language: string;
  source?: string;
  voice?: string;
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

export async function executeDub(options: DubOptions): Promise<DubResult> {
  const { mediaPath, language, source, voice, analyzeOnly, output } = options;

  try {
    const absPath = resolve(process.cwd(), mediaPath);
    if (!existsSync(absPath)) return { success: false, error: `File not found: ${absPath}` };

    const openaiKey = await getConfiguredApiKey("OPENAI_API_KEY");
    const anthropicKey = await getConfiguredApiKey("ANTHROPIC_API_KEY");
    const elevenlabsKey = await getConfiguredApiKey("ELEVENLABS_API_KEY");

    if (!openaiKey) return { success: false, error: "OPENAI_API_KEY required for Whisper transcription" };
    if (!anthropicKey) return { success: false, error: "ANTHROPIC_API_KEY required for Claude translation" };
    if (!analyzeOnly && !elevenlabsKey) return { success: false, error: "ELEVENLABS_API_KEY required for TTS" };

    const ext = extname(absPath).toLowerCase();
    const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);

    let audioPath = absPath;
    if (isVideo) {
      const tempAudioPath = resolve(dirname(absPath), `temp-audio-${Date.now()}.mp3`);
      execSafeSync("ffmpeg", ["-i", absPath, "-vn", "-acodec", "mp3", "-y", tempAudioPath]);
      audioPath = tempAudioPath;
    }

    const transcriptResult = await transcribeAudioFile(audioPath, { apiKey: openaiKey, language: source });

    if (transcriptResult.status === "failed" || !transcriptResult.segments) {
      return { success: false, error: `Transcription failed: ${transcriptResult.error}`, errorKind: transcriptResult.errorKind };
    }

    const segments = transcriptResult.segments;

    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: anthropicKey });

    const languageNames: Record<string, string> = {
      en: "English", es: "Spanish", fr: "French", de: "German",
      it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean",
      zh: "Chinese", ar: "Arabic", ru: "Russian", hi: "Hindi",
    };
    const targetLangName = languageNames[language] || language;
    const segmentTexts = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");

    let translatedSegments: Array<{ text: string; startTime: number; endTime: number }> = [];
    try {
      const storyboard = await claude.analyzeContent(
        `TRANSLATE to ${targetLangName}. Return the translated text only, preserving segment numbers:\n\n${segmentTexts}`,
        segments[segments.length - 1]?.endTime || 60
      );
      translatedSegments = segments.map((s, i) => ({
        text: storyboard[i]?.description || s.text,
        startTime: s.startTime,
        endTime: s.endTime,
      }));
    } catch {
      translatedSegments = segments.map(s => ({ text: s.text, startTime: s.startTime, endTime: s.endTime }));
    }

    if (analyzeOnly) {
      if (output) {
        const timingPath = resolve(process.cwd(), output);
        const timingData = {
          sourcePath: absPath,
          sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
          targetLanguage: language,
          segments: segments.map((s, i) => ({
            startTime: s.startTime, endTime: s.endTime,
            original: s.text, translated: translatedSegments[i]?.text || s.text,
          })),
        };
        await writeFile(timingPath, JSON.stringify(timingData, null, 2));
      }
      return {
        success: true,
        sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
        targetLanguage: language,
        segmentCount: segments.length,
        segments: segments.map((s, i) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          original: s.text,
          translated: translatedSegments[i]?.text || s.text,
        })),
        outputPath: output ? resolve(process.cwd(), output) : undefined,
      };
    }

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: elevenlabsKey! });

    const dubbedBuffers: Buffer[] = [];
    for (const seg of translatedSegments) {
      const ttsResult = await elevenlabs.textToSpeech(seg.text, { voiceId: voice });
      if (ttsResult.success && ttsResult.audioBuffer) {
        dubbedBuffers.push(ttsResult.audioBuffer);
      }
    }

    const combinedBuffer = Buffer.concat(dubbedBuffers);
    const outputExt = isVideo ? ".mp3" : extname(absPath);
    const defaultOutputPath = resolve(dirname(absPath), `${basename(absPath, extname(absPath))}-${language}${outputExt}`);
    const finalOutputPath = resolve(process.cwd(), output || defaultOutputPath);
    await writeFile(finalOutputPath, combinedBuffer);

    if (isVideo && audioPath !== absPath) {
      try { const { unlink } = await import("node:fs/promises"); await unlink(audioPath); } catch { /* cleanup best-effort */ }
    }

    return {
      success: true,
      outputPath: finalOutputPath,
      sourceLanguage: transcriptResult.detectedLanguage || source || "auto",
      targetLanguage: language,
      segmentCount: segments.length,
      segments: segments.map((s, i) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        original: s.text,
        translated: translatedSegments[i]?.text || s.text,
      })),
    };
  } catch (error) {
    return { success: false, error: `Dubbing failed: ${error instanceof Error ? error.message : String(error)}` };
  }
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
