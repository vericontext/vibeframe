/**
 * @module _shared/edit/_helpers
 * @description Private helpers shared across the edit subcommand splits.
 * Not part of the public ai-edit barrel re-export.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { commandExists, execSafe } from "../../../utils/exec-safe.js";
import { executorFailure, generalError, notFoundError, type ExecutorFailure } from "../../output.js";

/** A failed edit executor result; see {@link ExecutorFailure}. */
export type EditFailure = ExecutorFailure;

/** Wrap a structured error as a failed executor result. */
export const editFailure = executorFailure;

/**
 * Resolve an edit executor's input video against the cwd and check that it
 * and FFmpeg exist. Returns the absolute path, or the failure to return.
 */
export function resolveVideoInput(videoPath: string): { absPath: string } | EditFailure {
  const absPath = resolve(process.cwd(), videoPath);
  if (!existsSync(absPath)) return editFailure(notFoundError(absPath));
  if (!commandExists("ffmpeg")) {
    return editFailure(generalError(
      "FFmpeg not found",
      "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.",
    ));
  }
  return { absPath };
}

/** `<dir>/<name><suffix><ext>` next to the input, e.g. `clip.mp4` -> `clip-graded.mp4`. */
export function siblingOutputPath(absPath: string, suffix: string): string {
  return /\.[^./]+$/.test(absPath) ? absPath.replace(/(\.[^./]+)$/, `${suffix}$1`) : `${absPath}${suffix}.mp4`;
}

/** The executor's output path: `output` resolved against the cwd, or a sibling of the input. */
export function editOutputPath(absPath: string, output: string | undefined, suffix: string): string {
  return output ? resolve(process.cwd(), output) : siblingOutputPath(absPath, suffix);
}

/** Probe video resolution via ffprobe. Falls back to 1920x1080 on parse failure. */
export async function getVideoResolution(
  videoPath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await execSafe("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  return { width: w || 1920, height: h || 1080 };
}

/** Escape text for FFmpeg drawtext filter. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\\\:")
    .replace(/%/g, "\\\\%");
}
