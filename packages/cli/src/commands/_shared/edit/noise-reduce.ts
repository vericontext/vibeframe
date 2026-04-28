/**
 * @module _shared/edit/noise-reduce
 * @description `executeNoiseReduce` — FFmpeg afftdn filter with optional
 * highpass/lowpass for stronger settings. Split out of `ai-edit.ts` in
 * v0.69 (Plan G Phase 3).
 */

import { existsSync } from "node:fs";
import { getVideoDuration } from "../../../utils/audio.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";

export interface NoiseReduceOptions {
  /** Path to the input audio or video file */
  inputPath: string;
  /** Path for the noise-reduced output file */
  outputPath: string;
  /** Reduction strength preset (default: "medium") */
  strength?: "low" | "medium" | "high";
  /** Custom noise floor in dB (overrides strength preset) */
  noiseFloor?: number;
}

export interface NoiseReduceResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the noise-reduced output file */
  outputPath?: string;
  /** Duration of the input file in seconds */
  inputDuration?: number;
  /** Error message on failure */
  error?: string;
}

/**
 * Reduce audio noise in a video or audio file using FFmpeg afftdn filter.
 *
 * Supports three strength presets (low/medium/high) with optional highpass/lowpass
 * for the "high" setting. Video streams are copied without re-encoding.
 */
export async function executeNoiseReduce(
  options: NoiseReduceOptions,
): Promise<NoiseReduceResult> {
  const { inputPath, outputPath, strength = "medium", noiseFloor } = options;

  if (!existsSync(inputPath)) {
    return { success: false, error: `File not found: ${inputPath}` };
  }

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      error:
        "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.",
    };
  }

  try {
    const inputDuration = await getVideoDuration(inputPath);

    // Map strength to noise floor dB value
    const nf = noiseFloor ?? (strength === "low" ? -20 : strength === "high" ? -35 : -25);

    // Build audio filter
    let audioFilter = `afftdn=nf=${nf}`;
    if (strength === "high") {
      audioFilter = `${audioFilter},highpass=f=80,lowpass=f=12000`;
    }

    // Check if input has video stream
    let hasVideo = false;
    try {
      const { stdout } = await execSafe(
        "ffprobe",
        [
          "-v", "error",
          "-select_streams", "v",
          "-show_entries", "stream=codec_type",
          "-of", "csv=p=0",
          inputPath,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      hasVideo = stdout.trim().includes("video");
    } catch {
      // No video stream
    }

    const args = ["-i", inputPath, "-af", audioFilter];
    if (hasVideo) args.push("-c:v", "copy");
    args.push(outputPath, "-y");
    await execSafe("ffmpeg", args, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    return { success: true, outputPath, inputDuration };
  } catch (error) {
    return {
      success: false,
      error: `Noise reduction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
