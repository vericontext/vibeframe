/**
 * @module _shared/edit/fade
 * @description `executeFade` — FFmpeg fade/afade filters for video and/or
 * audio fade-in / fade-out. Split out of `ai-edit.ts` in v0.69 (Plan G
 * Phase 3).
 */

import { existsSync } from "node:fs";
import { getVideoDuration } from "../../../utils/audio.js";
import { execSafe, commandExists } from "../../../utils/exec-safe.js";

export interface FadeOptions {
  /** Path to the input video file */
  videoPath: string;
  /** Path for the output video with fade effects */
  outputPath: string;
  /** Fade-in duration in seconds (default: 1) */
  fadeIn?: number;
  /** Fade-out duration in seconds (default: 1) */
  fadeOut?: number;
  /** Apply fade to audio only (video copied) */
  audioOnly?: boolean;
  /** Apply fade to video only (audio copied) */
  videoOnly?: boolean;
}

export interface FadeResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Path to the output video */
  outputPath?: string;
  /** Total duration of the source video in seconds */
  totalDuration?: number;
  /** Whether fade-in was applied */
  fadeInApplied?: boolean;
  /** Whether fade-out was applied */
  fadeOutApplied?: boolean;
  /** Error message on failure */
  error?: string;
}

/**
 * Apply fade-in and/or fade-out effects to video and/or audio using FFmpeg.
 */
export async function executeFade(options: FadeOptions): Promise<FadeResult> {
  const {
    videoPath,
    outputPath,
    fadeIn = 1,
    fadeOut = 1,
    audioOnly = false,
    videoOnly = false,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      error:
        "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.",
    };
  }

  try {
    const totalDuration = await getVideoDuration(videoPath);

    const videoFilters: string[] = [];
    const audioFilters: string[] = [];

    // Video fade filters
    if (!audioOnly) {
      if (fadeIn > 0) {
        videoFilters.push(`fade=t=in:st=0:d=${fadeIn}`);
      }
      if (fadeOut > 0) {
        const fadeOutStart = Math.max(0, totalDuration - fadeOut);
        videoFilters.push(`fade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      }
    }

    // Audio fade filters
    if (!videoOnly) {
      if (fadeIn > 0) {
        audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
      }
      if (fadeOut > 0) {
        const fadeOutStart = Math.max(0, totalDuration - fadeOut);
        audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
      }
    }

    // Build FFmpeg command
    const ffmpegArgs: string[] = ["-i", videoPath];

    if (videoFilters.length > 0) {
      ffmpegArgs.push("-vf", videoFilters.join(","));
    } else if (audioOnly) {
      ffmpegArgs.push("-c:v", "copy");
    }

    if (audioFilters.length > 0) {
      ffmpegArgs.push("-af", audioFilters.join(","));
    } else if (videoOnly) {
      ffmpegArgs.push("-c:a", "copy");
    }

    ffmpegArgs.push(outputPath, "-y");

    await execSafe("ffmpeg", ffmpegArgs, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

    return {
      success: true,
      outputPath,
      totalDuration,
      fadeInApplied: fadeIn > 0,
      fadeOutApplied: fadeOut > 0,
    };
  } catch (error) {
    return {
      success: false,
      error: `Fade failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
