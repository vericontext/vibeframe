/**
 * @module _shared/edit/_helpers
 * @description Private helpers shared across the edit subcommand splits.
 * Not part of the public ai-edit barrel re-export.
 */

import { execSafe } from "../../../utils/exec-safe.js";

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
