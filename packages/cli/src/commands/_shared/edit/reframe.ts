/**
 * @module _shared/edit/reframe
 * @description `executeReframe`, the one implementation of
 * `vibe edit reframe`, shared by the CLI action, the `edit_reframe` MCP
 * tool, and the YAML pipeline's `edit-reframe` step.
 *
 * - `focus: "center"` is a free FFmpeg center crop.
 * - `auto`, `face`, and `action` sample up to {@link MAX_ANALYZED_FRAMES}
 *   frames, ask Claude Vision where the subject is in each, and crop at the
 *   average position (needs ANTHROPIC_API_KEY).
 *
 * The executor defaults to `center`, so a caller that names no focus never
 * spends money; the CLI passes its own `auto` default explicitly.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProvider, isProviderError } from "@vibeframe/ai-providers";
import { requireConfiguredApiKey } from "../../../utils/api-key.js";
import { execSafe, ffprobeDuration, ffprobeVideoSize } from "../../../utils/exec-safe.js";
import { apiError, failureFromError, providerFailure, usageError } from "../../output.js";
import { editFailure, editOutputPath, resolveVideoInput, type EditFailure } from "./_helpers.js";

export const REFRAME_FOCUS_MODES = ["auto", "face", "center", "action"] as const;
export type ReframeFocus = (typeof REFRAME_FOCUS_MODES)[number];

/** Upper bound on Claude Vision calls per video. */
export const MAX_ANALYZED_FRAMES = 30;
/** Seconds between sampled frames for short videos; longer ones spread the samples out. */
const MIN_FRAME_INTERVAL = 2;

export interface ReframeCropKeyframe {
  /** Seconds into the source. */
  time: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  confidence: number;
  subjectDescription: string;
}

export interface ReframeCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReframeOptions {
  videoPath: string;
  /** Target aspect ratio `W:H` (default 9:16). */
  aspect?: string;
  /** Default `center` (free). `auto`, `face`, and `action` use Claude Vision. */
  focus?: ReframeFocus;
  output?: string;
  /** Compute the crop without running FFmpeg. */
  analyzeOnly?: boolean;
  apiKey?: string;
  /** Step messages for a spinner. */
  onProgress?: (message: string) => void;
  /** Pause between Claude calls to stay under rate limits (default 200 ms). */
  frameDelayMs?: number;
}

export type ReframeResult =
  | {
      success: true;
      /** Set only when a reframed file was written. */
      outputPath?: string;
      sourceWidth: number;
      sourceHeight: number;
      /** `WxH` of the source, e.g. `1920:1080`. */
      sourceAspect: string;
      targetAspect: string;
      focus: ReframeFocus;
      /** The crop applied (or, with `analyzeOnly`, the one that would be). */
      crop: ReframeCrop;
      /** Per-frame crop analysis; one center keyframe for `focus: "center"`. */
      cropKeyframes: ReframeCropKeyframe[];
      keyframeCount: number;
    }
  | EditFailure;

/** Parse `W:H` into a ratio, or undefined when it is not two positive numbers. */
export function parseAspect(aspect: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!match) return undefined;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * The largest crop of `ratio` inside the source, with even dimensions so
 * H.264 (yuv420p) can encode it, centered.
 */
export function centerCrop(sourceWidth: number, sourceHeight: number, ratio: number): ReframeCrop {
  const width = even(ratio > sourceWidth / sourceHeight ? sourceWidth : sourceHeight * ratio);
  const height = even(ratio > sourceWidth / sourceHeight ? sourceWidth / ratio : sourceHeight);
  return {
    x: Math.round((sourceWidth - width) / 2),
    y: Math.round((sourceHeight - height) / 2),
    width,
    height,
  };
}

/**
 * The crop at the average analyzed position, clamped inside the source.
 * Undefined when there is nothing to average.
 */
export function averageCrop(
  keyframes: readonly Pick<ReframeCropKeyframe, "cropX" | "cropY">[],
  base: ReframeCrop,
  sourceWidth: number,
  sourceHeight: number,
): ReframeCrop | undefined {
  if (keyframes.length === 0) return undefined;
  const mean = (pick: (kf: Pick<ReframeCropKeyframe, "cropX" | "cropY">) => number) =>
    keyframes.reduce((sum, kf) => sum + pick(kf), 0) / keyframes.length;
  const clamp = (value: number, max: number) => Math.min(Math.max(0, Math.round(value)), max);
  return {
    x: clamp(mean((kf) => kf.cropX), sourceWidth - base.width),
    y: clamp(mean((kf) => kf.cropY), sourceHeight - base.height),
    width: base.width,
    height: base.height,
  };
}

export async function executeReframe(options: ReframeOptions): Promise<ReframeResult> {
  const { aspect = "9:16", focus = "center", analyzeOnly, onProgress, frameDelayMs = 200 } = options;
  const ratio = parseAspect(aspect);
  if (ratio === undefined) {
    return editFailure(usageError(`Invalid aspect ratio: ${aspect}`, "Use W:H, e.g. 9:16, 1:1, or 4:5."));
  }
  if (!REFRAME_FOCUS_MODES.includes(focus)) {
    return editFailure(usageError(`Invalid focus mode: ${focus}`, `Available modes: ${REFRAME_FOCUS_MODES.join(", ")}`));
  }

  const input = resolveVideoInput(options.videoPath);
  if ("failure" in input) return input;
  const { absPath } = input;

  // Only the vision modes need Claude. A missing key throws ApiKeyError
  // (API_KEY_MISSING) before any work.
  const apiKey = focus === "center" ? undefined : await requireConfiguredApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

  let tempDir: string | undefined;
  try {
    onProgress?.("Analyzing video...");
    const { width: sourceWidth, height: sourceHeight } = await ffprobeVideoSize(absPath);
    const base = centerCrop(sourceWidth, sourceHeight, ratio);

    let crop = base;
    let cropKeyframes: ReframeCropKeyframe[];
    if (!apiKey) {
      cropKeyframes = [{
        time: 0,
        cropX: base.x,
        cropY: base.y,
        cropWidth: base.width,
        cropHeight: base.height,
        confidence: 1,
        subjectDescription: "Center crop",
      }];
    } else {
      onProgress?.("Extracting keyframes...");
      const duration = await ffprobeDuration(absPath);
      const interval = Math.max(MIN_FRAME_INTERVAL, duration / MAX_ANALYZED_FRAMES);
      tempDir = await mkdtemp(join(tmpdir(), "vibe-reframe-"));
      await execSafe("ffmpeg", [
        "-i", absPath,
        "-vf", `fps=1/${interval.toFixed(3)}`,
        "-frames:v", String(MAX_ANALYZED_FRAMES),
        join(tempDir, "frame-%04d.jpg"), "-y",
      ]);
      const frames = (await readdir(tempDir)).filter((name) => name.endsWith(".jpg")).sort().slice(0, MAX_ANALYZED_FRAMES);

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

      cropKeyframes = [];
      let lastError: unknown;
      for (const [index, frame] of frames.entries()) {
        onProgress?.(`Analyzing frames... ${index + 1}/${frames.length}`);
        try {
          const frameBase64 = (await readFile(join(tempDir, frame))).toString("base64");
          const result = await claude.analyzeFrameForReframe(frameBase64, aspect, {
            focusMode: focus,
            sourceWidth,
            sourceHeight,
            mimeType: "image/jpeg",
          });
          if (Number.isFinite(result.cropX) && Number.isFinite(result.cropY)) {
            cropKeyframes.push({
              time: Number((index * interval).toFixed(3)),
              ...result,
              cropWidth: base.width,
              cropHeight: base.height,
            });
          }
        } catch (error) {
          // One bad frame does not sink the reframe; all of them failing does (below).
          lastError = error;
          // A bad key or an empty balance fails every frame the same way.
          if (isProviderError(error) && (error.kind === "auth" || error.kind === "quota")) break;
        }
        if (frameDelayMs > 0 && index < frames.length - 1) {
          await new Promise((r) => setTimeout(r, frameDelayMs));
        }
      }

      const averaged = averageCrop(cropKeyframes, base, sourceWidth, sourceHeight);
      if (!averaged) {
        const message = `Reframe analysis failed: no frame could be analyzed (${frames.length} extracted)`;
        if (isProviderError(lastError)) {
          return editFailure(providerFailure(`${message}: ${lastError.message}`, lastError.kind));
        }
        const cause = lastError instanceof Error ? `: ${lastError.message}` : "";
        return editFailure(apiError(`${message}${cause}`, true));
      }
      crop = averaged;
    }

    const shared = {
      sourceWidth,
      sourceHeight,
      sourceAspect: `${sourceWidth}:${sourceHeight}`,
      targetAspect: aspect,
      focus,
      crop,
      cropKeyframes,
      keyframeCount: cropKeyframes.length,
    };
    if (analyzeOnly) return { success: true, ...shared };

    const outputPath = editOutputPath(absPath, options.output, `-${aspect.replace(":", "x")}`);
    onProgress?.("Applying reframe...");
    await execSafe("ffmpeg", [
      "-i", absPath,
      "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      "-c:a", "copy",
      outputPath, "-y",
    ], { timeout: 600000 });

    return { success: true, outputPath, ...shared };
  } catch (error) {
    return editFailure(failureFromError(error, "Reframe failed", { fallback: "general" }));
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
