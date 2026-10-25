/**
 * @module _shared/edit/interpolate
 * @description `executeInterpolate`, the one implementation of
 * `vibe edit interpolate`, shared by the CLI action, the `edit_interpolate`
 * MCP tool, and the YAML pipeline's `edit-interpolate` step. FFmpeg
 * `minterpolate` slow motion, free. The output has no audio track.
 */

import { execSafe } from "../../../utils/exec-safe.js";
import { failureFromError, generalError, usageError } from "../../output.js";
import { editFailure, editOutputPath, resolveVideoInput, type EditFailure } from "./_helpers.js";

export const INTERPOLATE_FACTORS = [2, 4, 8] as const;

export interface InterpolateOptions {
  videoPath: string;
  output?: string;
  /** Slow motion factor: 2, 4, or 8 (default 2). */
  factor?: number;
  /** Frame rate to interpolate to before slowing down (default: source fps x factor). */
  fps?: number;
  /** `quality` (default) adds bidirectional motion estimation; `fast` skips it. */
  quality?: "fast" | "quality";
  /** Step messages for a spinner. */
  onProgress?: (message: string) => void;
}

export type InterpolateResult =
  | {
      success: true;
      outputPath: string;
      originalFps: number;
      targetFps: number;
      factor: number;
    }
  | EditFailure;

export async function executeInterpolate(options: InterpolateOptions): Promise<InterpolateResult> {
  const { factor = 2, quality = "quality", onProgress } = options;
  if (!(INTERPOLATE_FACTORS as readonly number[]).includes(factor)) {
    return editFailure(usageError("Factor must be 2, 4, or 8"));
  }
  if (options.fps !== undefined && !(options.fps > 0)) {
    return editFailure(usageError("--fps must be a positive number"));
  }

  const input = resolveVideoInput(options.videoPath);
  if ("failure" in input) return input;
  const { absPath } = input;

  try {
    const { stdout } = await execSafe("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
      "-of", "default=noprint_wrappers=1:nokey=1", absPath,
    ]);
    const [num, den] = stdout.trim().split("/").map(Number);
    const originalFps = num / (den || 1);
    if (!(originalFps > 0)) {
      return editFailure(generalError(`Could not read the frame rate of ${absPath}`));
    }

    const targetFps = options.fps ?? originalFps * factor;
    const mi = quality === "fast" ? "mi_mode=mci" : "mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1";
    const outputPath = editOutputPath(absPath, options.output, `-slow${factor}x`);

    onProgress?.(`Interpolating frames (${originalFps.toFixed(1)} -> ${targetFps}fps)...`);
    await execSafe(
      "ffmpeg",
      ["-i", absPath, "-filter:v", `minterpolate='${mi}:fps=${targetFps}',setpts=${factor}*PTS`, "-an", outputPath, "-y"],
      { timeout: 600000 },
    );

    return { success: true, outputPath, originalFps, targetFps, factor };
  } catch (error) {
    // execFile kills the process when the timeout passes.
    if ((error as { killed?: boolean }).killed) {
      return editFailure(generalError("Frame interpolation timed out", "Try a shorter video or --mode fast"));
    }
    return editFailure(failureFromError(error, "Frame interpolation failed", { fallback: "general" }));
  }
}
