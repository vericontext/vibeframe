/**
 * @module _shared/video-utils
 * @description Shared helpers for the script-to-video pipeline:
 * StoryboardSegment type, retry constants, ImgBB upload, FFmpeg/Kling
 * video extension, error logging, and the generic wait-for-completion
 * loop. Split out of `ai-script-pipeline.ts` in v0.69 (Plan G Phase 4).
 */

import { writeFile, unlink, rename } from "node:fs/promises";
import { resolve, basename } from "node:path";
import chalk from "chalk";
import type { KlingProvider, RunwayProvider } from "@vibeframe/ai-providers";
import { getVideoDuration, extendVideoNaturally } from "../../utils/audio.js";
import { execSafe } from "../../utils/exec-safe.js";
import { downloadVideo } from "../ai-helpers.js";

/** A single scene segment from the Claude-generated storyboard. */
export interface StoryboardSegment {
  /** 1-based scene index (assigned during generation) */
  index?: number;
  /** Narrative description of the scene */
  description: string;
  /** Visual prompt for image/video generation */
  visuals: string;
  /** Art style directive (e.g. "cinematic", "anime") */
  visualStyle?: string;
  /** Character appearance description for consistency */
  characterDescription?: string;
  /** Reference to previous scene for continuity */
  previousSceneLink?: string;
  /** Voiceover narration text */
  narration?: string;
  /** Audio direction (e.g. "upbeat music") */
  audio?: string;
  /** Text lines to overlay on the video */
  textOverlays?: string[];
  /** Scene duration in seconds (updated to match narration) */
  duration: number;
  /** Cumulative start time in seconds */
  startTime: number;
}

/** Default retry count for video generation API calls. */
export const DEFAULT_VIDEO_RETRIES = 2;
/** Delay between retries in milliseconds. */
export const RETRY_DELAY_MS = 5000;

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload image to ImgBB and return the URL.
 * Used for Kling v2.5/v2.6 image-to-video which requires URL (not base64).
 */
export async function uploadToImgbb(
  imageBuffer: Buffer,
  apiKey: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", base64Image);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `ImgBB API error (${response.status}): ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      success?: boolean;
      data?: { url?: string };
      error?: { message?: string };
    };

    if (data.success && data.data?.url) {
      return { success: true, url: data.data.url };
    } else {
      return { success: false, error: data.error?.message || "Upload failed" };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Extend a video to target duration using Kling extend API when possible,
 * with fallback to FFmpeg-based extendVideoNaturally.
 *
 * When the extension ratio > 1.4 and a Kling provider + videoId are available,
 * uses the Kling video-extend API for natural continuation instead of freeze frames.
 */
export async function extendVideoToTarget(
  videoPath: string,
  targetDuration: number,
  outputDir: string,
  sceneLabel: string,
  options?: {
    kling?: KlingProvider;
    videoId?: string;
    onProgress?: (message: string) => void;
  },
): Promise<void> {
  const actualDuration = await getVideoDuration(videoPath);
  if (actualDuration >= targetDuration - 0.1) return;

  const ratio = targetDuration / actualDuration;
  const extendedPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-extended.mp4`);

  // Try Kling extend API for large gaps (ratio > 1.4) where freeze frames look bad
  if (ratio > 1.4 && options?.kling && options?.videoId) {
    try {
      options.onProgress?.(`${sceneLabel}: Extending via Kling API...`);
      const extendResult = await options.kling.extendVideo(options.videoId, {
        duration: "5",
      });

      if (extendResult.status !== "failed" && extendResult.id) {
        const waitResult = await options.kling.waitForExtendCompletion(
          extendResult.id,
          (status) => {
            options.onProgress?.(`${sceneLabel}: extend ${status.status}...`);
          },
          600000,
        );

        if (waitResult.status === "completed" && waitResult.videoUrl) {
          // Download extended video
          const extendedVideoPath = resolve(
            outputDir,
            `${basename(videoPath, ".mp4")}-kling-ext.mp4`,
          );
          const buffer = await downloadVideo(waitResult.videoUrl);
          await writeFile(extendedVideoPath, buffer);

          // Concatenate original + extension
          const concatPath = resolve(
            outputDir,
            `${basename(videoPath, ".mp4")}-concat.mp4`,
          );
          const listPath = resolve(
            outputDir,
            `${basename(videoPath, ".mp4")}-concat.txt`,
          );
          await writeFile(
            listPath,
            `file '${videoPath}'\nfile '${extendedVideoPath}'`,
            "utf-8",
          );
          await execSafe("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0", "-i", listPath,
            "-c", "copy", concatPath,
          ]);

          // Trim to exact target duration if concatenated video is longer
          const concatDuration = await getVideoDuration(concatPath);
          if (concatDuration > targetDuration + 0.5) {
            await execSafe("ffmpeg", [
              "-y", "-i", concatPath, "-t", targetDuration.toFixed(2),
              "-c", "copy", extendedPath,
            ]);
            await unlink(concatPath);
          } else {
            await rename(concatPath, extendedPath);
          }

          // Cleanup temp files
          await unlink(extendedVideoPath).catch(() => {});
          await unlink(listPath).catch(() => {});
          await unlink(videoPath);
          await rename(extendedPath, videoPath);
          return;
        }
      }
      // If Kling extend failed, fall through to FFmpeg fallback
      options.onProgress?.(
        `${sceneLabel}: Kling extend failed, using FFmpeg fallback...`,
      );
    } catch {
      options.onProgress?.(
        `${sceneLabel}: Kling extend error, using FFmpeg fallback...`,
      );
    }
  }

  // FFmpeg-based fallback (slowdown + frame interpolation + freeze frame)
  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
  await unlink(videoPath);
  await rename(extendedPath, videoPath);
}

/**
 * Log a provider failure to stderr. Centralizes the "what went wrong" output
 * so call sites stop silently dropping provider errors into failedScenes.
 */
export function logSceneFailure(
  provider: string,
  sceneLabel: string,
  err: unknown,
): void {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === "string") {
    msg = err;
  } else if (
    err &&
    typeof err === "object" &&
    "error" in err &&
    typeof (err as { error: unknown }).error === "string"
  ) {
    msg = (err as { error: string }).error;
  } else {
    msg = String(err);
  }
  console.error(chalk.dim(`\n  [${provider} ${sceneLabel}: ${msg}]`));
}

/**
 * Wait for video completion with retry logic.
 */
export async function waitForVideoWithRetry(
  provider: KlingProvider | RunwayProvider,
  taskId: string,
  providerType: "kling" | "runway",
  maxRetries: number,
  onProgress?: (message: string) => void,
  timeout?: number,
): Promise<{ videoUrl: string } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result;
      if (providerType === "kling") {
        result = await (provider as KlingProvider).waitForCompletion(
          taskId,
          "image2video",
          (status) => onProgress?.(status.status || "processing"),
          timeout || 600000,
        );
      } else {
        result = await (provider as RunwayProvider).waitForCompletion(
          taskId,
          (status) => {
            const progress =
              status.progress !== undefined ? `${status.progress}%` : status.status;
            onProgress?.(progress || "processing");
          },
          timeout || 300000,
        );
      }

      if (result.status === "completed" && result.videoUrl) {
        return { videoUrl: result.videoUrl };
      }

      // If failed, signal need for resubmission
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Failed, will need resubmission...`);
        return null;
      }
    } catch (err) {
      if (attempt < maxRetries) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onProgress?.(`⚠ Error waiting (${errMsg.slice(0, 30)}), retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  return null;
}
