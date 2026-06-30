/**
 * @module _shared/scene-assemble
 *
 * The audio-assemble stage: lay a scene project's `<audio>` elements onto an
 * already-rendered (silent) video in one FFmpeg pass. The Hyperframes producer
 * emits silent video — sub-composition `<audio>` elements are not captured — so
 * we scan the project ourselves and mux them in with `-c:v copy` (no re-encode).
 *
 * Extracted from `executeSceneRender` so the mux is a first-class, independently
 * runnable step: `vibe render --silent` emits silent video, `vibe assemble` adds
 * the audio. The default `vibe render` still renders + assembles in one shot.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";

import { scanSceneAudio } from "./scene-audio-scan.js";
import { muxAudioIntoVideo } from "./scene-audio-mux.js";
import { ffprobeDuration } from "../../utils/exec-safe.js";
import type { RenderFormat } from "./scene-render.js";

export interface SceneAssembleOptions {
  /** Project directory (the Hyperframes scene project). */
  projectDir: string;
  /** Root composition file relative to projectDir (default: "index.html"). */
  root?: string;
  /** The rendered (silent) video to mux audio into. Relative paths resolve against projectDir. */
  videoPath: string;
  format?: RenderFormat;
  /**
   * Known total video duration in seconds (e.g. `job.totalFrames / fps`). When
   * omitted, it is ffprobed from {@link videoPath}; the mux uses it to cap audio.
   */
  videoDuration?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface SceneAssembleResult {
  success: boolean;
  /** Number of `<audio>` elements found across the project. */
  audioCount: number;
  /** True when at least one audio track was muxed into the video. */
  audioMuxApplied: boolean;
  /** Non-fatal warning when the mux failed or threw (video left untouched). */
  audioMuxWarning?: string;
  /** Absolute path to the (in-place-updated) video. */
  outputPath: string;
  /** Set when {@link success} is false (missing inputs). */
  error?: string;
}

/**
 * Scan the project's audio and mux it onto {@link SceneAssembleOptions.videoPath}
 * in place. Best-effort on the mux itself: a scan/mux failure becomes a warning,
 * not a hard error. Returns `success:false` only when a required input is missing.
 */
export async function executeSceneAssemble(
  opts: SceneAssembleOptions
): Promise<SceneAssembleResult> {
  const projectDir = resolve(opts.projectDir);
  const root = opts.root ?? "index.html";
  const format = opts.format ?? "mp4";
  const videoPath = isAbsolute(opts.videoPath)
    ? opts.videoPath
    : resolve(projectDir, opts.videoPath);

  if (!existsSync(videoPath)) {
    return {
      success: false,
      audioCount: 0,
      audioMuxApplied: false,
      outputPath: videoPath,
      error: `Video not found: ${videoPath}. Render it first (e.g. \`vibe render --silent\`).`,
    };
  }
  const rootPath = resolve(projectDir, root);
  if (!existsSync(rootPath)) {
    return {
      success: false,
      audioCount: 0,
      audioMuxApplied: false,
      outputPath: videoPath,
      error: `Root composition not found: ${rootPath}.`,
    };
  }

  let audioCount = 0;
  let audioMuxApplied = false;
  let audioMuxWarning: string | undefined;
  try {
    opts.onProgress?.(0.1, "Scanning audio");
    const rootHtml = await readFile(rootPath, "utf-8");
    const audios = await scanSceneAudio({ projectDir, rootHtml });
    audioCount = audios.length;
    if (audios.length > 0) {
      opts.onProgress?.(0.4, "Mixing audio");
      let videoDuration = opts.videoDuration;
      if (videoDuration === undefined) {
        try {
          videoDuration = await ffprobeDuration(videoPath);
        } catch {
          // best-effort: the mux falls back to the audio's own length
        }
      }
      const mux = await muxAudioIntoVideo({
        videoPath,
        audios,
        format,
        videoDuration,
        onProgress: (line) => {
          if (line) opts.onProgress?.(0.7, line);
        },
      });
      if (mux.success) {
        audioMuxApplied = true;
      } else {
        audioMuxWarning = mux.error;
      }
    }
    opts.onProgress?.(1, "Assembled");
  } catch (err) {
    audioMuxWarning = err instanceof Error ? err.message : String(err);
  }

  return { success: true, audioCount, audioMuxApplied, audioMuxWarning, outputPath: videoPath };
}
