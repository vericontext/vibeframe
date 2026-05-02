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

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, basename, join, isAbsolute } from "node:path";
import {
  createRenderJob,
  executeRenderJob,
  type RenderConfig,
} from "@hyperframes/producer";
import { preflightChrome } from "../../pipeline/renderers/chrome.js";
import { rootExists } from "./scene-lint.js";
import { scanSceneAudio } from "./scene-audio-scan.js";
import { muxAudioIntoVideo } from "./scene-audio-mux.js";
import { readProjectConfig } from "./project-config.js";
import { aspectToDims, type SceneAspect } from "./scene-project.js";

export type RenderFps = 24 | 30 | 60;
export type RenderQuality = "draft" | "standard" | "high";
export type RenderFormat = "mp4" | "webm" | "mov";

export interface SceneRenderOptions {
  /** Project directory (defaults to cwd). */
  projectDir?: string;
  /** Root composition file relative to projectDir (default: "index.html"). */
  root?: string;
  /** Render only one storyboard beat by synthesizing a temporary root. */
  beatId?: string;
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
  kind?: "render";
  beat?: string | null;
  root?: string;
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
  reportPath?: string;
  code?: string;
  error?: string;
  retryWith?: string[];
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
  beatId?: string;
  now?: Date;
}): string {
  const fmt = opts.format ?? "mp4";
  const now = opts.now ?? new Date();
  const stamp = now
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
  const name = (opts.projectName ?? basename(resolve(opts.projectDir))) || "scene";
  const beat = opts.beatId ? `-${sanitizeFileSegment(opts.beatId)}` : "";
  return resolve(opts.projectDir, "renders", `${name}${beat}-${stamp}.${fmt}`);
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
  const projectConfig = await readProjectConfig(projectDir);
  const engine = projectConfig.config.composition.engine;
  if (engine !== "hyperframes") {
    return {
      success: false,
      kind: "render",
      beat: opts.beatId ?? null,
      error: `Unsupported composition engine: ${engine}. Supported engine: hyperframes.`,
    };
  }

  // -- Preflight: project + Chrome ---------------------------------------
  const projectStat = await safeStat(projectDir);
  if (!projectStat || !projectStat.isDirectory()) {
    return {
      success: false,
      kind: "render",
      beat: opts.beatId ?? null,
      error: `Project directory not found: ${projectDir}`,
    };
  }

  let root = opts.root ?? projectConfig.config.composition.entry;
  if (opts.beatId) {
    const prepared = await prepareBeatRenderRoot({
      projectDir,
      beatId: opts.beatId,
      aspect: projectConfig.config.aspect,
    });
    if (!prepared.success) {
      return {
        success: false,
        kind: "render",
        beat: opts.beatId,
        root: prepared.root,
        code: prepared.code,
        error: prepared.error,
        retryWith: prepared.retryWith,
      };
    }
    root = prepared.root;
  }
  if (!(await rootExists(projectDir, root))) {
    return {
      success: false,
      kind: "render",
      beat: opts.beatId ?? null,
      root,
      error: `Root composition not found: ${resolve(projectDir, root)}. Run \`vibe scene init\` first.`,
    };
  }
  const chrome = await preflightChrome();
  if (!chrome.ok) {
    return {
      success: false,
      kind: "render",
      beat: opts.beatId ?? null,
      root,
      error: chrome.reason,
    };
  }

  // -- Resolve output path -----------------------------------------------
  const projectName = projectConfig.config.name;
  const outputPath = opts.output
    ? resolve(projectDir, opts.output)
    : defaultOutputPath({ projectDir, projectName, format: opts.format, beatId: opts.beatId });
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
      kind: "render",
      beat: opts.beatId ?? null,
      root,
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

  const result: SceneRenderResult = {
    success: true,
    kind: "render",
    beat: opts.beatId ?? null,
    root,
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
  result.reportPath = await writeRenderReport(projectDir, {
    ...result,
    outputPath,
  });
  return result;
}

async function safeStat(p: string): Promise<{ isDirectory: () => boolean } | null> {
  try { return await stat(p); } catch { return null; }
}

export interface BeatRenderRootResult {
  success: boolean;
  root: string;
  durationSec?: number;
  compositionPath?: string;
  narrationPath?: string;
  code?: "BEAT_NOT_FOUND" | "BEAT_RENDER_NOT_READY";
  error?: string;
  retryWith?: string[];
}

interface BuildReportAsset {
  path?: unknown;
  status?: unknown;
  sceneDurationSec?: unknown;
  durationSec?: unknown;
}

interface BuildReportBeat {
  id?: unknown;
  compositionPath?: unknown;
  sceneDurationSec?: unknown;
  narrationPath?: unknown;
  backdropPath?: unknown;
  videoPath?: unknown;
  musicPath?: unknown;
  narrationStatus?: unknown;
  backdropStatus?: unknown;
  videoStatus?: unknown;
  musicStatus?: unknown;
  narration?: BuildReportAsset;
  backdrop?: BuildReportAsset;
  video?: BuildReportAsset;
  music?: BuildReportAsset;
}

export async function prepareBeatRenderRoot(opts: {
  projectDir: string;
  beatId: string;
  aspect: SceneAspect;
}): Promise<BeatRenderRootResult> {
  const root = `.vibeframe/tmp/render-beat-${sanitizeFileSegment(opts.beatId)}.html`;
  const reportPath = join(opts.projectDir, "build-report.json");
  const retryWith = [
    `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage sync --json`,
  ];
  if (!existsSync(reportPath)) {
    return {
      success: false,
      root,
      code: "BEAT_RENDER_NOT_READY",
      error: "build-report.json is missing. Build the selected beat before rendering it.",
      retryWith,
    };
  }

  let report: { beats?: BuildReportBeat[] };
  try {
    report = JSON.parse(await readFile(reportPath, "utf-8")) as { beats?: BuildReportBeat[] };
  } catch (error) {
    return {
      success: false,
      root,
      code: "BEAT_RENDER_NOT_READY",
      error: `build-report.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      retryWith,
    };
  }

  const beat = (report.beats ?? []).find((candidate) => candidate.id === opts.beatId);
  if (!beat) {
    return {
      success: false,
      root,
      code: "BEAT_NOT_FOUND",
      error: `Beat "${opts.beatId}" was not found in build-report.json.`,
      retryWith: [`vibe build ${opts.projectDir} --beat ${opts.beatId} --dry-run --json`],
    };
  }

  const blockedStatuses = assetStatuses(beat).filter(
    (asset) => asset.status === "pending" || asset.status === "failed"
  );
  if (blockedStatuses.length > 0) {
    return {
      success: false,
      root,
      code: "BEAT_RENDER_NOT_READY",
      error: `Beat "${opts.beatId}" has unfinished asset(s): ${blockedStatuses.map((asset) => `${asset.kind}:${asset.status}`).join(", ")}.`,
      retryWith,
    };
  }

  const compositionPath =
    stringValue(beat.compositionPath) ?? `compositions/scene-${opts.beatId}.html`;
  if (!pathExists(opts.projectDir, compositionPath)) {
    return {
      success: false,
      root,
      code: "BEAT_RENDER_NOT_READY",
      error: `Composition for beat "${opts.beatId}" is missing: ${compositionPath}`,
      retryWith: [
        `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage compose --json`,
        `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage sync --json`,
      ],
    };
  }

  const missingAssets = reportedBeatAssetPaths(beat).filter(
    (path) => !isExternalRef(path) && !pathExists(opts.projectDir, path)
  );
  if (missingAssets.length > 0) {
    return {
      success: false,
      root,
      code: "BEAT_RENDER_NOT_READY",
      error: `Beat "${opts.beatId}" references missing asset(s): ${missingAssets.join(", ")}`,
      retryWith: [
        `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage assets --json`,
        `vibe build ${opts.projectDir} --beat ${opts.beatId} --stage sync --json`,
      ],
    };
  }

  const durationSec =
    parseOptionalNumber(beat.sceneDurationSec) ??
    parseOptionalNumber(beat.narration?.sceneDurationSec) ??
    parseOptionalNumber(beat.narration?.durationSec) ??
    5;
  const narrationPath = stringValue(beat.narration?.path) ?? stringValue(beat.narrationPath);
  const html = buildBeatRenderRootHtml({
    aspect: opts.aspect,
    beatId: opts.beatId,
    compositionPath,
    durationSec,
    narrationPath,
  });
  await mkdir(dirname(join(opts.projectDir, root)), { recursive: true });
  await writeFile(join(opts.projectDir, root), html, "utf-8");
  return {
    success: true,
    root,
    durationSec,
    compositionPath,
    narrationPath,
  };
}

function buildBeatRenderRootHtml(opts: {
  aspect: SceneAspect;
  beatId: string;
  compositionPath: string;
  durationSec: number;
  narrationPath?: string;
}): string {
  const { width, height } = aspectToDims(opts.aspect);
  const compositionId = `scene-${opts.beatId}`;
  const audio = opts.narrationPath
    ? `      <audio id="narration-${escapeAttr(opts.beatId)}" src="${escapeAttr(opts.narrationPath)}" data-start="0" data-duration="${opts.durationSec}" data-track-index="2"></audio>\n`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${opts.durationSec}" data-width="${width}" data-height="${height}">
      <div class="clip" data-composition-id="${escapeAttr(compositionId)}" data-composition-src="${escapeAttr(opts.compositionPath)}" data-start="0" data-duration="${opts.durationSec}" data-track-index="0"></div>
${audio}    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

function assetStatuses(beat: BuildReportBeat): Array<{ kind: string; status: string }> {
  return [
    { kind: "narration", status: stringValue(beat.narration?.status) ?? stringValue(beat.narrationStatus) },
    { kind: "backdrop", status: stringValue(beat.backdrop?.status) ?? stringValue(beat.backdropStatus) },
    { kind: "video", status: stringValue(beat.video?.status) ?? stringValue(beat.videoStatus) },
    { kind: "music", status: stringValue(beat.music?.status) ?? stringValue(beat.musicStatus) },
  ].filter((asset): asset is { kind: string; status: string } => Boolean(asset.status));
}

function reportedBeatAssetPaths(beat: BuildReportBeat): string[] {
  return unique([
    stringValue(beat.narrationPath),
    stringValue(beat.backdropPath),
    stringValue(beat.videoPath),
    stringValue(beat.musicPath),
    stringValue(beat.narration?.path),
    stringValue(beat.backdrop?.path),
    stringValue(beat.video?.path),
    stringValue(beat.music?.path),
  ]);
}

async function writeRenderReport(
  projectDir: string,
  result: SceneRenderResult & { outputPath?: string }
): Promise<string | undefined> {
  const reportPath = join(projectDir, "render-report.json");
  try {
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          schemaVersion: "1",
          kind: "render",
          project: projectDir,
          beat: result.beat ?? null,
          root: result.root,
          outputPath: result.outputPath,
          fps: result.fps,
          quality: result.quality,
          format: result.format,
          durationMs: result.durationMs,
          framesRendered: result.framesRendered,
          totalFrames: result.totalFrames,
          audioCount: result.audioCount,
          audioMuxApplied: result.audioMuxApplied,
          audioMuxWarning: result.audioMuxWarning,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
    return reportPath;
  } catch {
    return undefined;
  }
}

function pathExists(projectDir: string, value: string): boolean {
  const abs = isAbsolute(value) ? value : resolve(projectDir, value);
  return existsSync(abs);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : undefined;
}

function isExternalRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:/i.test(value);
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "beat";
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unique(items: Array<string | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)))];
}
