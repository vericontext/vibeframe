import { commandExists } from "../../utils/exec-safe.js";

/**
 * @module _shared/ffmpeg-gate
 *
 * Single availability check for the FFmpeg toolchain (ffmpeg + ffprobe).
 * ffprobe powers every narration-duration probe; without it the assets and
 * sync stages would silently fall back to storyboard durations and the
 * final render truncates audio at every clip boundary — so build and render
 * fail fast through this gate instead.
 */

let testOverride: boolean | null = null;
let cached: boolean | null = null;

/** Test-only hook — CI runners have no ffmpeg, production code never calls this. */
export function __setFfmpegToolsForTests(value: boolean | null): void {
  testOverride = value;
  cached = null;
}

export function ffmpegToolsAvailable(): boolean {
  if (testOverride !== null) return testOverride;
  if (cached === null) cached = commandExists("ffmpeg") && commandExists("ffprobe");
  return cached;
}
