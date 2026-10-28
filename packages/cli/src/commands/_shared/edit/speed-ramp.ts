/**
 * @module _shared/edit/speed-ramp
 * @description `executeSpeedRamp`, the one implementation of
 * `vibe edit speed-ramp`, shared by the CLI action and the `edit_speed_ramp`
 * MCP tool. Scribe or Whisper transcribes the audio, Claude plans speed keyframes,
 * FFmpeg applies the average speed.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProvider } from "@vibeframe/ai-providers";
import { requireConfiguredApiKey } from "../../../utils/api-key.js";
import { execSafe } from "../../../utils/exec-safe.js";
import { apiError, failureFromError, providerFailure, usageError } from "../../output.js";
import { resolveSttProvider, transcribeAudioFile } from "../transcription.js";
import { editFailure, editOutputPath, resolveVideoInput, type EditFailure } from "./_helpers.js";

export const SPEED_RAMP_STYLES = ["dramatic", "smooth", "action"] as const;
export type SpeedRampStyle = (typeof SPEED_RAMP_STYLES)[number];

export interface SpeedKeyframe {
  time: number;
  speed: number;
  reason: string;
}

export interface SpeedRampOptions {
  videoPath: string;
  output?: string;
  style?: SpeedRampStyle;
  minSpeed?: number;
  maxSpeed?: number;
  /** Plan keyframes without running FFmpeg. */
  analyzeOnly?: boolean;
  /** Transcription language code. */
  language?: string;
  /** Anthropic key. */
  apiKey?: string;
  /** Transcription provider: auto (default), elevenlabs, openai. */
  stt?: string;
  /** Key for the transcription provider (with auto, an OpenAI key). */
  sttApiKey?: string;
  /** Step messages for a spinner. */
  onProgress?: (message: string) => void;
}

export type SpeedRampResult =
  | {
      success: true;
      /** Set only when a ramped file was written. */
      outputPath?: string;
      keyframes: SpeedKeyframe[];
      avgSpeed: number;
    }
  | EditFailure;

/** Has the file at least one audio stream? */
async function hasAudioStream(absPath: string): Promise<boolean> {
  const { stdout } = await execSafe("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", absPath,
  ]);
  return stdout.trim().length > 0;
}

/**
 * An `atempo` chain for `speed`. One `atempo` instance accepts 0.5-2.0, so
 * larger changes are split into several, which keeps the audio at any speed.
 */
export function atempoChain(speed: number): string {
  const factors: number[] = [];
  let rest = speed;
  while (rest > 2) {
    factors.push(2);
    rest /= 2;
  }
  while (rest < 0.5) {
    factors.push(0.5);
    rest /= 0.5;
  }
  factors.push(rest);
  return factors.map((f) => `atempo=${f.toFixed(3)}`).join(",");
}

export async function executeSpeedRamp(options: SpeedRampOptions): Promise<SpeedRampResult> {
  const { style = "dramatic", minSpeed = 0.25, maxSpeed = 4.0, analyzeOnly, language, onProgress } = options;
  if (!SPEED_RAMP_STYLES.includes(style)) {
    return editFailure(usageError(`Invalid style: ${style}`, `Available styles: ${SPEED_RAMP_STYLES.join(", ")}`));
  }
  if (!(Number.isFinite(minSpeed) && Number.isFinite(maxSpeed) && minSpeed > 0 && minSpeed <= maxSpeed)) {
    return editFailure(usageError(`Invalid speed range: ${minSpeed}-${maxSpeed}`, "Use positive numbers with --min-speed <= --max-speed."));
  }

  const input = resolveVideoInput(options.videoPath);
  if ("failure" in input) return input;
  const { absPath } = input;

  // A missing key throws ApiKeyError (API_KEY_MISSING) before any work.
  const stt = await resolveSttProvider(options.stt, { apiKey: options.sttApiKey });
  const claudeKey = await requireConfiguredApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

  let tempDir: string | undefined;
  try {
    onProgress?.("Checking audio...");
    if (!(await hasAudioStream(absPath))) {
      return editFailure(usageError(
        "Video has no audio stream. Speed ramping requires audio for content-aware analysis.",
        "Use a video with an audio track.",
      ));
    }

    onProgress?.("Extracting audio...");
    tempDir = await mkdtemp(join(tmpdir(), "vibe-speed-ramp-"));
    const tempAudio = join(tempDir, "audio.mp3");
    await execSafe("ffmpeg", ["-i", absPath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", tempAudio, "-y"]);

    onProgress?.("Transcribing audio...");
    const transcript = await transcribeAudioFile(tempAudio, { ...stt, language });
    if (transcript.status === "failed") {
      return editFailure(providerFailure(`Transcription failed: ${transcript.error ?? "unknown error"}`, transcript.errorKind));
    }
    if (!transcript.segments || transcript.segments.length === 0) {
      return editFailure(usageError(
        "No speech found in the audio. Speed ramping plans speed changes from the transcript.",
        "Use a video with spoken audio.",
      ));
    }

    onProgress?.("Analyzing for speed ramping...");
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeKey });
    const { keyframes } = await claude.analyzeForSpeedRamp(transcript.segments, { style, minSpeed, maxSpeed });
    const valid = keyframes.filter((kf) => Number.isFinite(kf.time) && Number.isFinite(kf.speed) && kf.speed > 0);
    if (valid.length === 0) {
      return editFailure(apiError("Claude returned no speed keyframes", true));
    }
    const avgSpeed = valid.reduce((sum, kf) => sum + kf.speed, 0) / valid.length;

    if (analyzeOnly) return { success: true, keyframes: valid, avgSpeed };

    if (valid.length < 2) {
      return editFailure(apiError("Not enough speed keyframes to ramp (need at least 2)", true));
    }

    const outputPath = editOutputPath(absPath, options.output, "-ramped");
    onProgress?.("Applying speed ramp...");
    const setpts = `setpts=${(1 / avgSpeed).toFixed(3)}*PTS`;
    await execSafe("ffmpeg", [
      "-i", absPath,
      "-filter_complex", `[0:v]${setpts}[v];[0:a]${atempoChain(avgSpeed)}[a]`,
      "-map", "[v]", "-map", "[a]",
      outputPath, "-y",
    ], { timeout: 600000 });

    return { success: true, outputPath, keyframes: valid, avgSpeed };
  } catch (error) {
    return editFailure(failureFromError(error, "Speed ramping failed", { fallback: "general" }));
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
