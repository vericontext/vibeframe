/**
 * @module edit/lottie-overlay
 *
 * `vibe edit motion-overlay <video> --asset <file.lottie|file.json>`.
 *
 * Two passes, so the source video is never re-rendered through a browser:
 *
 *   1. Hyperframes renders only the Lottie layer, at the source's display
 *      size, to ProRes 4444 with alpha. The page drives a dotLottie player
 *      frame by frame from `window.__hf.seek`, so every frame is
 *      deterministic and nothing depends on wall-clock playback.
 *   2. FFmpeg overlays that layer onto the original video at `start`,
 *      keeping the source resolution, frame rate, and audio.
 */

import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { preflightChrome } from "../../pipeline/renderers/chrome.js";
import { commandExists, execSafe } from "../../utils/exec-safe.js";
import { withStdoutOnStderr } from "../../utils/stdout-guard.js";
import {
  DOTLOTTIE_BROWSER_HELPERS,
  checkLottieAsset,
  copyDotLottieRuntime,
  overlayBox,
  type LottiePosition,
} from "../_shared/lottie.js";

export type { LottiePosition };

export interface LottieOverlayOptions {
  videoPath: string;
  assetPath: string;
  outputPath: string;
  /** Seconds into the video where the overlay appears. */
  start: number;
  /** Seconds the overlay stays on screen. */
  duration: number;
  position: LottiePosition;
  /** Fraction of the frame the overlay box spans (ignored for `full`). */
  scale: number;
  opacity: number;
  loop: boolean;
}

export interface LottieOverlayResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  /** How to fix a failure that retrying will not fix. */
  suggestion?: string;
}

export interface VideoStreamInfo {
  /** Display size, after any rotation metadata is applied. */
  width: number;
  height: number;
  fps: number;
  duration: number;
}

const FFMPEG_MISSING =
  "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details.";

/** Probe the first video stream. Width/height are swapped for 90/270 degree rotations, as FFmpeg autorotates on decode. */
export async function probeVideoStream(path: string): Promise<VideoStreamInfo> {
  const { stdout } = await execSafe("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of", "json",
    path,
  ]);
  const info = JSON.parse(stdout) as {
    streams?: Array<{
      width?: number;
      height?: number;
      r_frame_rate?: string;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
    format?: { duration?: string };
  };
  const stream = info.streams?.[0];
  if (!stream?.width || !stream.height) throw new Error(`No video stream in ${path}`);
  const rotation = Number(stream.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  const [num, den] = (stream.r_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den > 0 && num > 0 ? num / den : 30;
  return {
    width: quarterTurn ? stream.height : stream.width,
    height: quarterTurn ? stream.width : stream.height,
    fps,
    duration: Number(info.format?.duration ?? 0),
  };
}

/**
 * The layer page. `window.__hf` is published only after the animation has
 * loaded, because the producer starts capturing once `__hf.duration > 0`.
 */
export function lottieLayerHtml(opts: {
  width: number;
  height: number;
  duration: number;
  assetUrl: string;
  box: { left: number; top: number; width: number; height: number };
  opacity: number;
  loop: boolean;
}): string {
  const { box } = opts;
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; background: transparent; }
  #lottie { position: absolute; left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px; opacity: ${opts.opacity}; }
</style>
</head><body>
<canvas id="lottie" width="${box.width}" height="${box.height}"></canvas>
<script type="module">
  ${DOTLOTTIE_BROWSER_HELPERS}
  const DotLottie = await loadDotLottie("./vendor");
  const LOOP = ${opts.loop};
  const DURATION = ${opts.duration};
  const player = new DotLottie({
    canvas: document.getElementById("lottie"),
    src: ${JSON.stringify(opts.assetUrl)},
    autoplay: false,
    loop: false,
    renderConfig: { devicePixelRatio: 1, autoResize: false, freezeOnOffscreen: false },
  });
  player.addEventListener("loadError", (event) => {
    window.__lottieLoadError = String(event && event.error ? event.error.message || event.error : "load failed");
  });
  player.addEventListener("load", () => {
    window.__hf = {
      duration: DURATION,
      seek(t) {
        setLottieTime(player, t, LOOP);
      },
    };
    window.__hf.seek(0);
  });
</script>
</body></html>
`;
}

async function renderLayer(opts: {
  dir: string;
  info: VideoStreamInfo;
  options: LottieOverlayOptions;
}): Promise<string> {
  const { dir, info, options } = opts;
  await copyDotLottieRuntime(join(dir, "vendor"));
  await mkdir(join(dir, "assets"), { recursive: true });
  const assetName = `animation${extname(options.assetPath).toLowerCase()}`;
  await copyFile(options.assetPath, join(dir, "assets", assetName));

  const html = lottieLayerHtml({
    width: info.width,
    height: info.height,
    duration: options.duration,
    assetUrl: `./assets/${assetName}`,
    box: overlayBox(info, options.position, options.scale),
    opacity: options.opacity,
    loop: options.loop,
  });
  await writeFile(join(dir, "index.html"), html, "utf-8");

  const layerPath = join(dir, "layer.mov");
  const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");
  const job = createRenderJob({
    fps: Math.min(60, Math.max(1, Math.round(info.fps))),
    quality: "standard",
    format: "mov",
    entryFile: "index.html",
    workers: 1,
  });
  await withStdoutOnStderr(() => executeRenderJob(job, dir, layerPath));
  return layerPath;
}

async function composite(videoPath: string, layerPath: string, options: LottieOverlayOptions): Promise<void> {
  const filter =
    `[1:v]setpts=PTS-STARTPTS+${options.start}/TB[layer];` +
    `[0:v][layer]overlay=eof_action=pass:format=auto,format=yuv420p[v]`;
  const args = (audioCodec: string[]) => [
    "-y",
    "-i", videoPath,
    "-i", layerPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium",
    ...audioCodec,
    "-movflags", "+faststart",
    options.outputPath,
  ];
  const opts = { timeout: 10 * 60_000, maxBuffer: 50 * 1024 * 1024 };
  try {
    await execSafe("ffmpeg", args(["-c:a", "copy"]), opts);
  } catch {
    // The source audio codec does not fit the output container; re-encode it.
    await execSafe("ffmpeg", args(["-c:a", "aac", "-b:a", "192k"]), opts);
  }
}

export async function renderLottieOverlay(options: LottieOverlayOptions): Promise<LottieOverlayResult> {
  if (!commandExists("ffmpeg") || !commandExists("ffprobe")) {
    return { success: false, error: FFMPEG_MISSING, suggestion: "Run `vibe doctor`." };
  }
  const chrome = await preflightChrome();
  if (!chrome.ok) return { success: false, error: chrome.reason, suggestion: "Run `vibe doctor`." };

  const assetProblem = await checkLottieAsset(options.assetPath);
  if (assetProblem) return { success: false, error: assetProblem };

  const info = await probeVideoStream(options.videoPath);
  const dir = await mkdtemp(join(tmpdir(), "vibeframe-lottie-"));
  try {
    let layerPath: string;
    try {
      layerPath = await renderLayer({ dir, info, options });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/__hf not ready/.test(message)) {
        return {
          success: false,
          error: `Could not load the Lottie animation ${basename(options.assetPath)}.`,
          suggestion: "Check that it opens in a Lottie player (https://lottiefiles.com/preview).",
        };
      }
      return { success: false, error: `Lottie layer render failed: ${message}` };
    }
    await composite(options.videoPath, layerPath, options);
    return { success: true, outputPath: options.outputPath };
  } catch (error) {
    return { success: false, error: `Lottie overlay failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
