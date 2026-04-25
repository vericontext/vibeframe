/**
 * @module _shared/scene-render
 *
 * Render a VibeFrame scene project to MP4/WebM/MOV using the Hyperframes
 * producer directly. Unlike the FFmpeg-bridge backend in
 * `pipeline/renderers/hyperframes.ts` which has to convert a `TimelineState`
 * into a temp Hyperframes project, scene projects already ARE Hyperframes
 * projects — so we hand the producer the user's project dir and entry file
 * verbatim.
 *
 * `executeSceneRender()` is decoupled from CLI flags so that the C6 agent
 * tool and the C5 `--format scenes` pipeline can call it the same way. It
 * returns a structured result instead of throwing or exiting.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, dirname, basename } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  createRenderJob,
  executeRenderJob,
  type RenderConfig,
} from "@hyperframes/producer";
import { preflightChrome } from "../../pipeline/renderers/chrome.js";
import { rootExists } from "./scene-lint.js";
import { scanSceneAudio } from "./scene-audio-scan.js";
import { muxAudioIntoVideo } from "./scene-audio-mux.js";

export type RenderFps = 24 | 30 | 60;
export type RenderQuality = "draft" | "standard" | "high";
export type RenderFormat = "mp4" | "webm" | "mov";

export interface SceneRenderOptions {
  /** Project directory (defaults to cwd). */
  projectDir?: string;
  /** Root composition file relative to projectDir (default: "index.html"). */
  root?: string;
  /** Output file. When relative, resolved against projectDir. Default:
   *  `renders/<projectName>-<isoStamp>.<format>`. */
  output?: string;
  fps?: RenderFps;
  quality?: RenderQuality;
  format?: RenderFormat;
  /** Hyperframes capture worker count. Default 1 (the existing backend's
   *  default — auto-worker mode times out on small comps). */
  workers?: number;
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: string) => void;
}

export interface SceneRenderResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  framesRendered?: number;
  totalFrames?: number;
  fps?: RenderFps;
  quality?: RenderQuality;
  format?: RenderFormat;
  /** Number of `<audio>` elements muxed into the final file. 0 = silent project. */
  audioCount?: number;
  /** True when ffmpeg was invoked to overlay audio on the producer's video. */
  audioMuxApplied?: boolean;
  /** Non-fatal warning from the audio mux pass — caller may surface to the user. */
  audioMuxWarning?: string;
  error?: string;
}

/** Map a quality preset to an x264 CRF (lower = higher quality). */
export function qualityToCrf(quality: RenderQuality = "standard"): number {
  return quality === "draft" ? 28 : quality === "high" ? 18 : 23;
}

/**
 * Compute the default output path for a render. Pure — does no I/O. Returns
 * an absolute path under `<projectDir>/renders/`.
 *
 * `now` is injectable so tests get deterministic output.
 */
export function defaultOutputPath(opts: {
  projectDir: string;
  projectName?: string;
  format?: RenderFormat;
  now?: Date;
}): string {
  const fmt = opts.format ?? "mp4";
  const now = opts.now ?? new Date();
  const stamp = now
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
  const name = (opts.projectName ?? basename(resolve(opts.projectDir))) || "scene";
  return resolve(opts.projectDir, "renders", `${name}-${stamp}.${fmt}`);
}

/** Minimal subset of `vibe.project.yaml` we care about for render. */
interface VibeProjectShape {
  name?: string;
}

async function readProjectName(projectDir: string): Promise<string | undefined> {
  const cfgPath = resolve(projectDir, "vibe.project.yaml");
  if (!existsSync(cfgPath)) return undefined;
  try {
    const raw = await (await import("node:fs/promises")).readFile(cfgPath, "utf-8");
    const parsed = yamlParse(raw) as VibeProjectShape | null;
    return parsed?.name ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the producer's `RenderConfig` from caller options. Pure — useful for
 * unit tests that want to assert defaults without touching Chrome.
 */
export function buildRenderConfig(opts: {
  fps?: RenderFps;
  quality?: RenderQuality;
  format?: RenderFormat;
  workers?: number;
  entryFile?: string;
}): RenderConfig {
  const quality = opts.quality ?? "standard";
  return {
    fps: opts.fps ?? 30,
    quality,
    format: opts.format ?? "mp4",
    entryFile: opts.entryFile ?? "index.html",
    crf: qualityToCrf(quality),
    workers: opts.workers ?? 1,
  };
}

/**
 * Render a scene project. Mirrors the contract of the existing Hyperframes
 * backend (preflight → execute → structured result), but skips the
 * `TimelineState` → temp project conversion because the user's project is
 * already a valid Hyperframes project.
 */
export async function executeSceneRender(opts: SceneRenderOptions = {}): Promise<SceneRenderResult> {
  const projectDir = resolve(opts.projectDir ?? ".");
  const root = opts.root ?? "index.html";

  // -- Preflight: project + Chrome ---------------------------------------
  const projectStat = await safeStat(projectDir);
  if (!projectStat || !projectStat.isDirectory()) {
    return { success: false, error: `Project directory not found: ${projectDir}` };
  }
  if (!(await rootExists(projectDir, root))) {
    return {
      success: false,
      error: `Root composition not found: ${resolve(projectDir, root)}. Run \`vibe scene init\` first.`,
    };
  }
  const chrome = await preflightChrome();
  if (!chrome.ok) {
    return { success: false, error: chrome.reason };
  }

  // -- Resolve output path -----------------------------------------------
  const projectName = await readProjectName(projectDir);
  const outputPath = opts.output
    ? resolve(projectDir, opts.output)
    : defaultOutputPath({ projectDir, projectName, format: opts.format });
  await mkdir(dirname(outputPath), { recursive: true });

  // -- Execute render ----------------------------------------------------
  const config = buildRenderConfig({
    fps: opts.fps,
    quality: opts.quality,
    format: opts.format,
    workers: opts.workers,
    entryFile: root,
  });
  const job = createRenderJob(config);
  const start = Date.now();

  try {
    await executeRenderJob(
      job,
      projectDir,
      outputPath,
      (j, msg) => opts.onProgress?.(j.progress, j.currentStage ?? msg),
      opts.signal,
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // -- Audio mux pass (post-producer) ------------------------------------
  // The producer emits silent video — sub-composition <audio> elements are
  // not picked up. We scan the project ourselves and lay them onto the
  // video in one ffmpeg pass with -c:v copy (no re-encode).
  let audioCount = 0;
  let audioMuxApplied = false;
  let audioMuxWarning: string | undefined;
  try {
    opts.onProgress?.(0.95, "Mixing audio");
    const rootHtml = await readFile(resolve(projectDir, root), "utf-8");
    const audios = await scanSceneAudio({ projectDir, rootHtml });
    audioCount = audios.length;
    if (audios.length > 0) {
      const videoDuration =
        job.totalFrames && config.fps ? job.totalFrames / config.fps : undefined;
      const mux = await muxAudioIntoVideo({
        videoPath: outputPath,
        audios,
        format: config.format ?? "mp4",
        videoDuration,
        onProgress: (line) => {
          if (line) opts.onProgress?.(0.97, line);
        },
      });
      if (mux.success) {
        audioMuxApplied = true;
      } else {
        audioMuxWarning = mux.error;
      }
    }
  } catch (err) {
    audioMuxWarning = err instanceof Error ? err.message : String(err);
  }

  return {
    success: true,
    outputPath: relative(process.cwd(), outputPath) || outputPath,
    durationMs: Date.now() - start,
    framesRendered: job.framesRendered,
    totalFrames: job.totalFrames,
    fps: config.fps,
    quality: config.quality,
    format: config.format,
    audioCount,
    audioMuxApplied,
    audioMuxWarning,
  };
}

async function safeStat(p: string): Promise<{ isDirectory: () => boolean } | null> {
  try { return await stat(p); } catch { return null; }
}
