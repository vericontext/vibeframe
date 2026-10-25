/**
 * @module _shared/edit/upscale
 * @description `executeUpscale`, the one implementation of
 * `vibe edit upscale`, shared by the CLI action, the `edit_upscale` MCP
 * tool, and the YAML pipeline's `edit-upscale` step. FFmpeg scaling, free.
 *
 * There is no AI upscale path: the Replicate helper in `ai-providers`
 * points at an image model (`nightmareai/real-esrgan`) and needs a hosted
 * video URL, so the CLI no longer offers it.
 */

import { execSafe, ffprobeVideoSize } from "../../../utils/exec-safe.js";
import { failureFromError, usageError } from "../../output.js";
import { editFailure, editOutputPath, resolveVideoInput, type EditFailure } from "./_helpers.js";

export interface UpscaleOptions {
  videoPath: string;
  output?: string;
  /** 2 or 4 (default 2). */
  scale?: number;
  /** `quality` (default) uses Lanczos; `fast` uses FFmpeg's default bicubic. */
  quality?: "fast" | "quality";
  /** Step messages for a spinner. */
  onProgress?: (message: string) => void;
}

export type UpscaleResult =
  | {
      success: true;
      outputPath: string;
      originalRes: string;
      targetRes: string;
      scale: number;
    }
  | EditFailure;

export async function executeUpscale(options: UpscaleOptions): Promise<UpscaleResult> {
  const { scale = 2, quality = "quality", onProgress } = options;
  if (scale !== 2 && scale !== 4) return editFailure(usageError("Scale must be 2 or 4"));

  const input = resolveVideoInput(options.videoPath);
  if ("failure" in input) return input;
  const { absPath } = input;

  try {
    const { width, height } = await ffprobeVideoSize(absPath);
    const targetWidth = width * scale;
    const targetHeight = height * scale;
    const filter = `scale=${targetWidth}:${targetHeight}${quality === "quality" ? ":flags=lanczos" : ""}`;
    const outputPath = editOutputPath(absPath, options.output, `-upscaled-${scale}x`);

    onProgress?.(`Upscaling ${width}x${height} -> ${targetWidth}x${targetHeight}...`);
    await execSafe("ffmpeg", ["-i", absPath, "-vf", filter, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, originalRes: `${width}x${height}`, targetRes: `${targetWidth}x${targetHeight}`, scale };
  } catch (error) {
    return editFailure(failureFromError(error, "Upscale failed", { fallback: "general" }));
  }
}
