/**
 * @module ai-script-pipeline
 *
 * Script-to-video pipeline and scene regeneration execute functions.
 *
 * CLI commands: script-to-video, regenerate-scene
 *
 * Execute functions:
 *   executeScriptToVideo  - Full pipeline: storyboard -> TTS -> images -> videos -> project
 *   executeRegenerateScene - Re-generate specific scene(s) in an existing project
 *
 * Also exports shared helpers: uploadToImgbb, extendVideoToTarget,
 * generateVideoWithRetryKling, generateVideoWithRetryRunway, generateVideoWithRetryVeo, waitForVideoWithRetry
 *
 * @dependencies Claude (storyboard), ElevenLabs (TTS), OpenAI/Gemini (images),
 *              Kling/Runway (video), FFmpeg (assembly/extension)
 */

import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { resolve, basename, dirname, extname } from "node:path";
import { existsSync } from "node:fs";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import chalk from "chalk";
import {
  GeminiProvider,
  OpenAIProvider,
  OpenAIImageProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
  GrokProvider,
} from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { Project } from "../engine/index.js";
import { getAudioDuration, getVideoDuration, extendVideoNaturally } from "../utils/audio.js";
import { applyTextOverlays, type TextOverlayStyle, type VideoReviewFeedback } from "./ai-edit.js";
import { executeReview } from "./ai-review.js";
import { execSafe } from "../utils/exec-safe.js";
import { downloadVideo } from "./ai-helpers.js";

/** A single scene segment from the Claude-generated storyboard. */
export interface StoryboardSegment {
  /** 1-based scene index (assigned during generation) */
  index?: number;
  /** Narrative description of the scene */
  description: string;
  /** Visual prompt for image/video generation */
  visuals: string;
  /** Art style directive (e.g. "cinematic", "anime") */
  visualStyle?: string;
  /** Character appearance description for consistency */
  characterDescription?: string;
  /** Reference to previous scene for continuity */
  previousSceneLink?: string;
  /** Voiceover narration text */
  narration?: string;
  /** Audio direction (e.g. "upbeat music") */
  audio?: string;
  /** Text lines to overlay on the video */
  textOverlays?: string[];
  /** Scene duration in seconds (updated to match narration) */
  duration: number;
  /** Cumulative start time in seconds */
  startTime: number;
}

/** Default retry count for video generation API calls. */
export const DEFAULT_VIDEO_RETRIES = 2;
/** Delay between retries in milliseconds. */
export const RETRY_DELAY_MS = 5000;

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload image to ImgBB and return the URL
 * Used for Kling v2.5/v2.6 image-to-video which requires URL (not base64)
 */
export async function uploadToImgbb(
  imageBuffer: Buffer,
  apiKey: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("key", apiKey);
    formData.append("image", base64Image);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      return { success: false, error: `ImgBB API error (${response.status}): ${response.statusText}` };
    }

    const data = (await response.json()) as {
      success?: boolean;
      data?: { url?: string };
      error?: { message?: string };
    };

    if (data.success && data.data?.url) {
      return { success: true, url: data.data.url };
    } else {
      return { success: false, error: data.error?.message || "Upload failed" };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Extend a video to target duration using Kling extend API when possible,
 * with fallback to FFmpeg-based extendVideoNaturally.
 *
 * When the extension ratio > 1.4 and a Kling provider + videoId are available,
 * uses the Kling video-extend API for natural continuation instead of freeze frames.
 */
export async function extendVideoToTarget(
  videoPath: string,
  targetDuration: number,
  outputDir: string,
  sceneLabel: string,
  options?: {
    kling?: KlingProvider;
    videoId?: string;
    onProgress?: (message: string) => void;
  }
): Promise<void> {
  const actualDuration = await getVideoDuration(videoPath);
  if (actualDuration >= targetDuration - 0.1) return;

  const ratio = targetDuration / actualDuration;
  const extendedPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-extended.mp4`);

  // Try Kling extend API for large gaps (ratio > 1.4) where freeze frames look bad
  if (ratio > 1.4 && options?.kling && options?.videoId) {
    try {
      options.onProgress?.(`${sceneLabel}: Extending via Kling API...`);
      const extendResult = await options.kling.extendVideo(options.videoId, {
        duration: "5",
      });

      if (extendResult.status !== "failed" && extendResult.id) {
        const waitResult = await options.kling.waitForExtendCompletion(
          extendResult.id,
          (status) => {
            options.onProgress?.(`${sceneLabel}: extend ${status.status}...`);
          },
          600000
        );

        if (waitResult.status === "completed" && waitResult.videoUrl) {
          // Download extended video
          const extendedVideoPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-kling-ext.mp4`);
          const buffer = await downloadVideo(waitResult.videoUrl);
          await writeFile(extendedVideoPath, buffer);

          // Concatenate original + extension
          const concatPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.mp4`);
          const listPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.txt`);
          await writeFile(listPath, `file '${videoPath}'\nfile '${extendedVideoPath}'`, "utf-8");
          await execSafe("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatPath]);

          // Trim to exact target duration if concatenated video is longer
          const concatDuration = await getVideoDuration(concatPath);
          if (concatDuration > targetDuration + 0.5) {
            await execSafe("ffmpeg", ["-y", "-i", concatPath, "-t", targetDuration.toFixed(2), "-c", "copy", extendedPath]);
            await unlink(concatPath);
          } else {
            await rename(concatPath, extendedPath);
          }

          // Cleanup temp files
          await unlink(extendedVideoPath).catch(() => {});
          await unlink(listPath).catch(() => {});
          await unlink(videoPath);
          await rename(extendedPath, videoPath);
          return;
        }
      }
      // If Kling extend failed, fall through to FFmpeg fallback
      options.onProgress?.(`${sceneLabel}: Kling extend failed, using FFmpeg fallback...`);
    } catch {
      options.onProgress?.(`${sceneLabel}: Kling extend error, using FFmpeg fallback...`);
    }
  }

  // FFmpeg-based fallback (slowdown + frame interpolation + freeze frame)
  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
  await unlink(videoPath);
  await rename(extendedPath, videoPath);
}

/**
 * Log a provider failure to stderr. Centralizes the "what went wrong" output
 * so call sites stop silently dropping provider errors into failedScenes.
 * Safe to call with unknown errors, string messages, or VideoResult shapes.
 */
export function logSceneFailure(
  provider: string,
  sceneLabel: string,
  err: unknown
): void {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === "string") {
    msg = err;
  } else if (err && typeof err === "object" && "error" in err && typeof (err as { error: unknown }).error === "string") {
    msg = (err as { error: string }).error;
  } else {
    msg = String(err);
  }
  console.error(chalk.dim(`\n  [${provider} ${sceneLabel}: ${msg}]`));
}

/**
 * Generate video with retry logic for Grok provider
 */
export async function generateVideoWithRetryGrok(
  grok: GrokProvider,
  segment: StoryboardSegment,
  options: {
    duration: number;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string;
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ requestId: string } | null> {
  const prompt = segment.visualStyle
    ? `${segment.visuals}. Style: ${segment.visualStyle}`
    : segment.visuals;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await grok.generateVideo(prompt, {
        prompt,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
        referenceImage: options.referenceImage,
      });

      if (result.status !== "failed" && result.id) {
        return { requestId: result.id };
      }

      // Provider returned status: "failed" with an error message — don't
      // discard it. Surface via onProgress + stderr so the caller can see WHY.
      const providerErr = result.error || "Grok returned failed status";
      if (attempt < maxRetries) {
        onProgress?.(`⚠ ${providerErr.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Grok error: ${providerErr}]`));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Grok error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Generate video with retry logic for Kling provider
 * Supports image-to-video with URL (v2.5/v2.6 models)
 */
export async function generateVideoWithRetryKling(
  kling: KlingProvider,
  segment: StoryboardSegment,
  options: {
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string; // Optional: base64 or URL for image2video
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ taskId: string; type: "text2video" | "image2video" } | null> {
  // Build detailed prompt from storyboard segment
  const prompt = segment.visualStyle
    ? `${segment.visuals}. Style: ${segment.visualStyle}`
    : segment.visuals;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await kling.generateVideo(prompt, {
        prompt,
        // Pass reference image (base64 or URL) - KlingProvider handles v1.5 fallback for base64
        referenceImage: options.referenceImage,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
        mode: "std", // Use std mode for faster generation
      });

      if (result.status !== "failed" && result.id) {
        return {
          taskId: result.id,
          type: options.referenceImage ? "image2video" : "text2video",
        };
      }

      const providerErr = result.error || "Kling returned failed status";
      if (attempt < maxRetries) {
        onProgress?.(`⚠ ${providerErr.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Kling error: ${providerErr}]`));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Kling error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Generate video with retry logic for Runway provider
 */
export async function generateVideoWithRetryRunway(
  runway: RunwayProvider,
  segment: StoryboardSegment,
  referenceImage: string,
  options: {
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16";
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ taskId: string } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await runway.generateVideo(segment.visuals, {
        prompt: segment.visuals,
        referenceImage,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
      });

      if (result.status !== "failed" && result.id) {
        return { taskId: result.id };
      }

      const providerErr = result.error || "Runway returned failed status";
      if (attempt < maxRetries) {
        onProgress?.(`⚠ ${providerErr.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Runway error: ${providerErr}]`));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Runway error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Generate video with retry logic for Veo (Gemini) provider
 */
export async function generateVideoWithRetryVeo(
  gemini: GeminiProvider,
  segment: StoryboardSegment,
  options: {
    duration: 4 | 6 | 8;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string;
  },
  maxRetries: number,
  onProgress?: (message: string) => void
): Promise<{ operationName: string } | null> {
  const prompt = segment.visualStyle
    ? `${segment.visuals}. Style: ${segment.visualStyle}`
    : segment.visuals;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await gemini.generateVideo(prompt, {
        prompt,
        referenceImage: options.referenceImage,
        duration: options.duration,
        aspectRatio: options.aspectRatio,
        model: "veo-3.1-fast-generate-preview",
      });

      if (result.status !== "failed" && result.id) {
        return { operationName: result.id };
      }

      const providerErr = result.error || "Veo returned failed status";
      if (attempt < maxRetries) {
        onProgress?.(`⚠ ${providerErr.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Veo error: ${providerErr}]`));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(chalk.dim(`\n  [Veo error: ${errMsg}]`));
      }
    }
  }
  return null;
}

/**
 * Wait for video completion with retry logic
 */
export async function waitForVideoWithRetry(
  provider: KlingProvider | RunwayProvider,
  taskId: string,
  providerType: "kling" | "runway",
  maxRetries: number,
  onProgress?: (message: string) => void,
  timeout?: number
): Promise<{ videoUrl: string } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result;
      if (providerType === "kling") {
        result = await (provider as KlingProvider).waitForCompletion(
          taskId,
          "image2video",
          (status) => onProgress?.(status.status || "processing"),
          timeout || 600000
        );
      } else {
        result = await (provider as RunwayProvider).waitForCompletion(
          taskId,
          (status) => {
            const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
            onProgress?.(progress || "processing");
          },
          timeout || 300000
        );
      }

      if (result.status === "completed" && result.videoUrl) {
        return { videoUrl: result.videoUrl };
      }

      // If failed, try resubmitting on next attempt
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Failed, will need resubmission...`);
        return null; // Signal need for resubmission
      }
    } catch (err) {
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error waiting, retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  return null;
}

/** Options for {@link executeScriptToVideo}. */
export interface ScriptToVideoOptions {
  /** Raw script or concept text for the video */
  script: string;
  /** Output directory (default: "script-video-output") */
  outputDir?: string;
  /**
   * Output format. `"mp4"` (default) runs the full storyboard → TTS → image →
   * video → assemble pipeline. `"scenes"` stops after image gen and emits a
   * Hyperframes-style scene project (HTML compositions + GSAP timelines) at
   * `outputDir`, ready for `vibe scene lint` / `vibe scene render`.
   */
  format?: "mp4" | "scenes";
  /** Style preset applied to every scene when `format === "scenes"`.
   *  Default: `"explainer"`. Ignored for `format === "mp4"`. */
  scenePreset?: "simple" | "announcement" | "explainer" | "kinetic-type" | "product-shot";
  /** Target total duration in seconds */
  duration?: number;
  /** ElevenLabs voice name or ID */
  voice?: string;
  /** Video generation provider */
  generator?: "grok" | "runway" | "kling" | "veo";
  /** Image generation provider */
  imageProvider?: "openai" | "dalle" | "gemini" | "grok";
  /** Video aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Stop after image generation (skip video) */
  imagesOnly?: boolean;
  /** Skip voiceover generation */
  noVoiceover?: boolean;
  /** Max retries per video generation call */
  retries?: number;
  /** Creativity level for storyboard generation: low (default, consistent) or high (varied, unexpected) */
  creativity?: "low" | "high";
  /** Provider for storyboard generation: claude (default), openai, or gemini */
  storyboardProvider?: "claude" | "openai" | "gemini";
  /** Skip text overlay step */
  noTextOverlay?: boolean;
  /** Text overlay style preset */
  textStyle?: TextOverlayStyle;
  /** Enable AI review after assembly */
  review?: boolean;
  /** Auto-apply fixable issues from review */
  reviewAutoApply?: boolean;
  /**
   * Called at stage boundaries (storyboard, assembly, review, …) and per scene
   * during narration/image/video generation (format: `Scene i/N: ...`).
   */
  onProgress?: (message: string) => void;
  /**
   * Absolute path for the generated `project.vibe.json`. Defaults to
   * `{outputDir}/project.vibe.json`. When supplied, the CLI layer can map its
   * `-o` flag onto an arbitrary project file location without renaming files
   * after the fact.
   */
  projectFilePath?: string;
}

/**
 * Narration entry with segment tracking
 */
export interface NarrationEntry {
  /** Path to the narration audio file (null if failed) */
  path: string | null;
  /** Duration in seconds */
  duration: number;
  /** Index of the segment this narration belongs to */
  segmentIndex: number;
  /** Whether the narration failed to generate */
  failed: boolean;
  /** Error message if failed */
  error?: string;
}

/** Result from {@link executeScriptToVideo}. */
export interface ScriptToVideoResult {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Absolute path to the output directory */
  outputDir: string;
  /** Total number of storyboard scenes */
  scenes: number;
  /** Path to the generated storyboard JSON */
  storyboardPath?: string;
  /** Path to the generated .vibe.json project file */
  projectPath?: string;
  /** @deprecated Use narrationEntries for proper segment tracking */
  narrations?: string[];
  /** Narration entries with segment index tracking */
  narrationEntries?: NarrationEntry[];
  /** Paths to generated scene images */
  images?: string[];
  /** Paths to generated scene videos */
  videos?: string[];
  /** Total video duration in seconds */
  totalDuration?: number;
  /** 1-indexed scene numbers that failed to generate */
  failedScenes?: number[];
  /** Failed narration scene numbers (1-indexed) */
  failedNarrations?: number[];
  /** Error message on failure */
  error?: string;
  /** Review feedback from Gemini (when --review is used) */
  reviewFeedback?: VideoReviewFeedback;
  /** List of auto-applied fixes (when --review-auto-apply is used) */
  appliedFixes?: string[];
  /** Path to reviewed/fixed video (when review auto-applied) */
  reviewedVideoPath?: string;
  /** Format chosen for this run (`"mp4"` or `"scenes"`). */
  format?: "mp4" | "scenes";
  /** When `format === "scenes"`: project-relative scene HTML paths emitted. */
  scenePaths?: string[];
  /** When `format === "scenes"`: lint result for the emitted project. */
  sceneLint?: import("./_shared/scene-lint.js").ProjectLintResult;
}

/**
 * Execute the full script-to-video pipeline programmatically.
 *
 * Pipeline stages:
 * 1. Generate storyboard with Claude
 * 2. Generate per-scene voiceovers with ElevenLabs TTS
 * 3. Generate scene images (OpenAI/Gemini)
 * 4. Generate scene videos (Kling/Runway) with extension to match narration
 * 4.5. Apply text overlays if present in storyboard
 * 5. Assemble .vibe.json project file
 * 6. Optional AI review and auto-fix (Gemini)
 *
 * @param options - Pipeline configuration
 * @returns Result with paths to all generated assets and project file
 */
export async function executeScriptToVideo(
  options: ScriptToVideoOptions
): Promise<ScriptToVideoResult> {
  const outputDir = options.outputDir || "script-video-output";

  try {
    // Get storyboard provider API key
    const storyboardProvider = options.storyboardProvider || "claude";
    let storyboardApiKey: string | undefined;

    if (storyboardProvider === "openai") {
      storyboardApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
      if (!storyboardApiKey) {
        return { success: false, outputDir, scenes: 0, error: "OpenAI API key required for storyboard generation (--storyboard-provider openai). Run 'vibe setup' or set OPENAI_API_KEY in .env" };
      }
    } else if (storyboardProvider === "gemini") {
      storyboardApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
      if (!storyboardApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Google API key required for storyboard generation (--storyboard-provider gemini). Run 'vibe setup' or set GOOGLE_API_KEY in .env" };
      }
    } else {
      // Default: Claude
      storyboardApiKey = (await getApiKey("ANTHROPIC_API_KEY", "Anthropic")) ?? undefined;
      if (!storyboardApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Anthropic API key required for storyboard generation. Run 'vibe setup' or set ANTHROPIC_API_KEY in .env" };
      }
    }

    // Get image provider API key
    let imageApiKey: string | undefined;
    const imageProvider = options.imageProvider || "openai";

    if (imageProvider === "openai" || imageProvider === "dalle") {
      imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "OpenAI API key required for image generation. Run 'vibe setup' or set OPENAI_API_KEY in .env" };
      }
    } else if (imageProvider === "gemini") {
      imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Google API key required for Gemini image generation. Run 'vibe setup' or set GOOGLE_API_KEY in .env" };
      }
    } else if (imageProvider === "grok") {
      imageApiKey = (await getApiKey("XAI_API_KEY", "xAI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "xAI API key required for Grok image generation. Run 'vibe setup' or set XAI_API_KEY in .env" };
      }
    }

    let elevenlabsApiKey: string | undefined;
    if (!options.noVoiceover) {
      elevenlabsApiKey = (await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs")) ?? undefined;
      if (!elevenlabsApiKey) {
        return { success: false, outputDir, scenes: 0, error: "ElevenLabs API key required for voiceover (or use noVoiceover option). Run 'vibe setup' or set ELEVENLABS_API_KEY in .env" };
      }
    }

    let videoApiKey: string | undefined;
    if (!options.imagesOnly) {
      const generatorKeyMap: Record<string, { envVar: string; name: string }> = {
        grok: { envVar: "XAI_API_KEY", name: "xAI (Grok)" },
        kling: { envVar: "KLING_API_KEY", name: "Kling" },
        runway: { envVar: "RUNWAY_API_SECRET", name: "Runway" },
        veo: { envVar: "GOOGLE_API_KEY", name: "Google (Veo)" },
      };
      const generator = options.generator || "grok";
      const generatorInfo = generatorKeyMap[generator];
      if (!generatorInfo) {
        return { success: false, outputDir, scenes: 0, error: `Invalid generator: ${options.generator}. Available: ${Object.keys(generatorKeyMap).join(", ")}` };
      }
      videoApiKey = (await getApiKey(generatorInfo.envVar, generatorInfo.name)) ?? undefined;
      if (!videoApiKey) {
        return { success: false, outputDir, scenes: 0, error: `${generatorInfo.name} API key required (or use imagesOnly option). Run 'vibe setup' or set ${generatorInfo.envVar} in .env` };
      }
    }

    // Create output directory
    const absOutputDir = resolve(process.cwd(), outputDir);
    if (!existsSync(absOutputDir)) {
      await mkdir(absOutputDir, { recursive: true });
    }

    // Step 1: Generate storyboard
    options.onProgress?.(`Analyzing script with ${storyboardProvider}...`);
    let segments: StoryboardSegment[];
    const creativityOpts = { creativity: options.creativity };

    if (storyboardProvider === "openai") {
      const openai = new OpenAIProvider();
      await openai.initialize({ apiKey: storyboardApiKey! });
      segments = await openai.analyzeContent(options.script, options.duration, creativityOpts);
    } else if (storyboardProvider === "gemini") {
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: storyboardApiKey! });
      segments = await gemini.analyzeContent(options.script, options.duration, creativityOpts);
    } else {
      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: storyboardApiKey! });
      segments = await claude.analyzeContent(options.script, options.duration, creativityOpts);
    }

    if (segments.length === 0) {
      return { success: false, outputDir, scenes: 0, error: "Failed to generate storyboard" };
    }

    // Save storyboard as YAML (human-readable, easier to edit)
    const storyboardPath = resolve(absOutputDir, "storyboard.yaml");
    await writeFile(storyboardPath, yamlStringify({ scenes: segments }, { indent: 2 }), "utf-8");

    const result: ScriptToVideoResult = {
      success: true,
      outputDir: absOutputDir,
      scenes: segments.length,
      storyboardPath,
      narrations: [],
      narrationEntries: [],
      images: [],
      videos: [],
      failedScenes: [],
      failedNarrations: [],
    };

    // Step 2: Generate per-scene voiceovers with ElevenLabs
    if (!options.noVoiceover && elevenlabsApiKey) {
      options.onProgress?.(`Generating ${segments.length} voiceover(s) with ElevenLabs...`);
      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const narrationText = segment.narration || segment.description;

        if (!narrationText) {
          // No narration text for this segment - add placeholder entry
          result.narrationEntries!.push({
            path: null,
            duration: segment.duration,
            segmentIndex: i,
            failed: false, // Not failed, just no text
          });
          continue;
        }

        // Pre-TTS word-count heuristic (warn only; narration may still fit)
        const wordCount = narrationText.split(/\s+/).filter(Boolean).length;
        const maxWords = segment.duration > 5 ? 24 : 12;
        if (wordCount > maxWords * 1.3) {
          options.onProgress?.(
            `⚠ Scene ${i + 1} narration has ${wordCount} words (target ~${maxWords} for ${segment.duration}s); speech may rush.`
          );
        }

        options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating narration...`);

        let ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (ttsResult.success && ttsResult.audioBuffer) {
          const audioPath = resolve(absOutputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration
          let actualDuration = await getAudioDuration(audioPath);

          // Auto speed-adjust if narration exceeds video bracket (5s or 10s).
          // Pick the bracket from the pre-TTS segment.duration (the storyboard
          // estimate), not actualDuration — actualDuration IS the overage.
          const videoBracket = segment.duration > 5 ? 10 : 5;
          const overageRatio = actualDuration / videoBracket;
          if (overageRatio > 1.0 && overageRatio <= 1.35) {
            const adjustedSpeed = Math.min(1.35, parseFloat(overageRatio.toFixed(2)));
            options.onProgress?.(
              `Scene ${i + 1}: adjusting narration speed to ${adjustedSpeed}x...`
            );
            const speedResult = await elevenlabs.textToSpeech(narrationText, {
              voiceId: options.voice,
              speed: adjustedSpeed,
            });
            if (speedResult.success && speedResult.audioBuffer) {
              await writeFile(audioPath, speedResult.audioBuffer);
              actualDuration = await getAudioDuration(audioPath);
              ttsResult = speedResult;
            }
          } else if (overageRatio > 1.35) {
            options.onProgress?.(
              `⚠ Scene ${i + 1} narration is ${((overageRatio - 1) * 100).toFixed(0)}% over target (${actualDuration.toFixed(1)}s vs ${videoBracket}s bracket)`
            );
          }

          segment.duration = actualDuration;

          // Add to both arrays for backwards compatibility
          result.narrations!.push(audioPath);
          result.narrationEntries!.push({
            path: audioPath,
            duration: actualDuration,
            segmentIndex: i,
            failed: false,
          });
        } else {
          // TTS failed - add placeholder entry with error info
          result.narrationEntries!.push({
            path: null,
            duration: segment.duration, // Keep original estimated duration
            segmentIndex: i,
            failed: true,
            error: ttsResult.error || "Unknown TTS error",
          });
          result.failedNarrations!.push(i + 1); // 1-indexed for user display
        }
      }

      // Recalculate startTime for all segments
      let currentTime = 0;
      for (const segment of segments) {
        segment.startTime = currentTime;
        currentTime += segment.duration;
      }

      // Re-save storyboard with updated durations
      await writeFile(storyboardPath, yamlStringify({ scenes: segments }, { indent: 2 }), "utf-8");
    }

    // Step 3: Generate images
    options.onProgress?.(`Generating ${segments.length} scene image(s) with ${imageProvider}...`);
    const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
      "16:9": "1536x1024",
      "9:16": "1024x1536",
      "1:1": "1024x1024",
    };
    let openaiImageInstance: OpenAIImageProvider | undefined;
    let geminiInstance: GeminiProvider | undefined;
    let grokInstance: GrokProvider | undefined;

    if (imageProvider === "openai" || imageProvider === "dalle") {
      openaiImageInstance = new OpenAIImageProvider();
      await openaiImageInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "gemini") {
      geminiInstance = new GeminiProvider();
      await geminiInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "grok") {
      grokInstance = new GrokProvider();
      await grokInstance.initialize({ apiKey: imageApiKey! });
    }

    const imagePaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const imagePrompt = segment.visualStyle
        ? `${segment.visuals}. Style: ${segment.visualStyle}`
        : segment.visuals;

      options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating image...`);

      try {
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;

        if ((imageProvider === "openai" || imageProvider === "dalle") && openaiImageInstance) {
          const imageResult = await openaiImageInstance.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio || "16:9"] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            // GPT Image 1.5 returns base64, DALL-E 3 returns URL
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          }
          // else: imageResult.error is available but not captured
        } else if (imageProvider === "gemini" && geminiInstance) {
          const imageResult = await geminiInstance.generateImage(imagePrompt, {
            aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
          });
          if (imageResult.success && imageResult.images?.[0]?.base64) {
            imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
          }
          // else: imageResult.error is available but not captured
        } else if (imageProvider === "grok" && grokInstance) {
          const imageResult = await grokInstance.generateImage(imagePrompt, {
            aspectRatio: options.aspectRatio || "16:9",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          }
        }

        const imagePath = resolve(absOutputDir, `scene-${i + 1}.png`);
        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
          imagePaths.push(imagePath);
          result.images!.push(imagePath);
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
          imagePaths.push(imagePath);
          result.images!.push(imagePath);
        } else {
          // Track failed scene - error details not captured (see provider imageResult.error)
          // The failedScenes array tracks which scenes failed for the caller
          imagePaths.push("");
        }
      } catch {
        imagePaths.push("");
      }

      // Rate limiting delay
      if (i < segments.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Step 4 (alt): branch into scene-project emit when --format scenes.
    // We have everything needed: storyboard, narrations, images. Video gen,
    // text overlays, .vibe.json assembly, and review are all skipped — the
    // user iterates on the resulting HTML scenes via `vibe scene lint/render`.
    if (options.format === "scenes") {
      const { executeSegmentsToScenes } = await import("./_shared/segments-to-scenes.js");
      options.onProgress?.("Materialising scene project...");
      const sceneAspect = (options.aspectRatio === "1:1" || options.aspectRatio === "16:9" || options.aspectRatio === "9:16")
        ? options.aspectRatio
        : "16:9";
      const scenes = await executeSegmentsToScenes({
        segments,
        narrationEntries: result.narrationEntries,
        imagePaths,
        outputDir: absOutputDir,
        aspectRatio: sceneAspect,
        scenePreset: options.scenePreset,
        onProgress: options.onProgress,
      });
      result.format = "scenes";
      result.scenePaths = scenes.scenePaths;
      result.sceneLint = scenes.lintResult;
      result.totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
      if (!scenes.success) {
        return { ...result, success: false, error: scenes.error ?? "Scene emit failed" };
      }
      return result;
    }

    // Step 4: Generate videos (if not images-only)
    const videoPaths: string[] = [];
    const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

    if (!options.imagesOnly && videoApiKey) {
      options.onProgress?.(`Generating ${segments.length} scene video(s) with ${options.generator || "grok"}...`);
      if (options.generator === "grok") {
        const grok = new GrokProvider();
        await grok.initialize({ apiKey: videoApiKey });

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const videoDuration = Math.min(15, Math.max(1, segment.duration));

          options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating video (grok)...`);

          // Image-to-video: encode image as data URI
          const imageBuffer = await readFile(imagePaths[i]);
          const ext = extname(imagePaths[i]).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const taskResult = await generateVideoWithRetryGrok(
            grok,
            segment,
            { duration: videoDuration, aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1", referenceImage },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await grok.waitForCompletion(taskResult.requestId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                logSceneFailure("Grok", `scene ${i + 1}`, waitResult);
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch (err) {
              logSceneFailure("Grok", `scene ${i + 1}`, err);
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      } else if (options.generator === "kling") {
        const kling = new KlingProvider();
        await kling.initialize({ apiKey: videoApiKey });

        if (!kling.isConfigured()) {
          return { success: false, outputDir: absOutputDir, scenes: segments.length, error: "Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY" };
        }

        // Kling image2video requires a public image URL (not base64). When an
        // ImgBB key is configured, upload each scene image once and pass the
        // URL as referenceImage; otherwise fall through to text2video.
        const imgbbApiKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
        const imageUrls: (string | undefined)[] = new Array(segments.length);
        if (imgbbApiKey) {
          options.onProgress?.("Uploading scene images for Kling image-to-video...");
          for (let i = 0; i < imagePaths.length; i++) {
            if (imagePaths[i]) {
              try {
                const imageBuffer = await readFile(imagePaths[i]);
                const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
                if (uploadResult.success && uploadResult.url) {
                  imageUrls[i] = uploadResult.url;
                }
              } catch {
                imageUrls[i] = undefined;
              }
            }
          }
        }

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

          options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating video (kling)...`);

          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrls[i],
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration. Use extendVideoToTarget
                // so large gaps (ratio > 1.4) can use Kling's own extend API for
                // natural continuation instead of freeze-frame padding.
                await extendVideoToTarget(
                  videoPath,
                  segment.duration,
                  absOutputDir,
                  `Scene ${i + 1}`,
                  {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: options.onProgress,
                  }
                );

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                logSceneFailure("Kling", `scene ${i + 1}`, waitResult);
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch (err) {
              logSceneFailure("Kling", `scene ${i + 1}`, err);
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      } else if (options.generator === "veo") {
        // Veo (Gemini)
        const veo = new GeminiProvider();
        await veo.initialize({ apiKey: videoApiKey });

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const veoDuration = (segment.duration > 6 ? 8 : segment.duration > 4 ? 6 : 4) as 4 | 6 | 8;

          options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating video (veo)...`);

          const taskResult = await generateVideoWithRetryVeo(
            veo,
            segment,
            { duration: veoDuration, aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1" },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await veo.waitForVideoCompletion(taskResult.operationName, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                logSceneFailure("Veo", `scene ${i + 1}`, waitResult);
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch (err) {
              logSceneFailure("Veo", `scene ${i + 1}`, err);
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      } else {
        // Runway
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey: videoApiKey });

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const imageBuffer = await readFile(imagePaths[i]);
          const ext = extname(imagePaths[i]).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
          const aspectRatio = options.aspectRatio === "1:1" ? "16:9" : ((options.aspectRatio || "16:9") as "16:9" | "9:16");

          options.onProgress?.(`Scene ${i + 1}/${segments.length}: generating video (runway)...`);

          const taskResult = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            { duration: videoDuration, aspectRatio },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await runway.waitForCompletion(taskResult.taskId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                logSceneFailure("Runway", `scene ${i + 1}`, waitResult);
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch (err) {
              logSceneFailure("Runway", `scene ${i + 1}`, err);
              videoPaths.push("");
              result.failedScenes!.push(i + 1);
            }
          } else {
            videoPaths.push("");
            result.failedScenes!.push(i + 1);
          }
        }
      }
    }

    // Step 4.5: Apply text overlays (if segments have textOverlays)
    if (!options.noTextOverlay) {
      const overlayCount = segments.filter((s, i) => s.textOverlays?.length && videoPaths[i]).length;
      if (overlayCount > 0) options.onProgress?.(`Applying text overlays to ${overlayCount} scene(s)...`);
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.textOverlays && segment.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== "") {
          try {
            const overlayOutput = videoPaths[i].replace(/(\.[^.]+)$/, "-overlay$1");
            const overlayResult = await applyTextOverlays({
              videoPath: videoPaths[i],
              texts: segment.textOverlays,
              outputPath: overlayOutput,
              style: options.textStyle || "lower-third",
            });
            if (overlayResult.success && overlayResult.outputPath) {
              videoPaths[i] = overlayResult.outputPath;
            }
            // Silent fallback: keep original on failure
          } catch {
            // Silent fallback: keep original video
          }
        }
      }
    }

    // Step 5: Create project file
    options.onProgress?.("Assembling project...");
    const project = new Project("Script-to-Video Output");
    project.setAspectRatio((options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1");

    // Clear default tracks
    const defaultTracks = project.getTracks();
    for (const track of defaultTracks) {
      project.removeTrack(track.id);
    }

    const videoTrack = project.addTrack({
      name: "Video",
      type: "video",
      order: 1,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });

    const audioTrack = project.addTrack({
      name: "Audio",
      type: "audio",
      order: 0,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });

    // Add narration clips - use narrationEntries for proper segment alignment
    if (result.narrationEntries && result.narrationEntries.length > 0) {
      for (const entry of result.narrationEntries) {
        // Skip failed or missing narrations
        if (entry.failed || !entry.path) continue;

        const segment = segments[entry.segmentIndex];
        const narrationDuration = await getAudioDuration(entry.path);

        const audioSource = project.addSource({
          name: `Narration ${entry.segmentIndex + 1}`,
          url: entry.path,
          type: "audio",
          duration: narrationDuration,
        });

        project.addClip({
          sourceId: audioSource.id,
          trackId: audioTrack.id,
          startTime: segment.startTime,
          duration: narrationDuration,
          sourceStartOffset: 0,
          sourceEndOffset: narrationDuration,
        });
      }
    }

    // Add video/image clips
    let currentTime = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const hasVideo = videoPaths[i] && videoPaths[i] !== "";
      const hasImage = imagePaths[i] && imagePaths[i] !== "";

      if (!hasVideo && !hasImage) {
        currentTime += segment.duration;
        continue;
      }

      const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
      const mediaType = hasVideo ? "video" : "image";

      // Use actual video duration (after extension) instead of segment.duration
      const actualDuration = hasVideo
        ? await getVideoDuration(assetPath)
        : segment.duration;

      const source = project.addSource({
        name: `Scene ${i + 1}`,
        url: assetPath,
        type: mediaType as "video" | "image",
        duration: actualDuration,
      });

      project.addClip({
        sourceId: source.id,
        trackId: videoTrack.id,
        startTime: currentTime,
        duration: actualDuration,
        sourceStartOffset: 0,
        sourceEndOffset: actualDuration,
      });

      currentTime += actualDuration;
    }

    // Save project file. Default is `{outputDir}/project.vibe.json`; callers
    // can override via projectFilePath (used by the CLI's `-o` handling).
    const projectPath = options.projectFilePath
      ? resolve(process.cwd(), options.projectFilePath)
      : resolve(absOutputDir, "project.vibe.json");
    const projectParentDir = dirname(projectPath);
    if (!existsSync(projectParentDir)) {
      await mkdir(projectParentDir, { recursive: true });
    }
    await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
    result.projectPath = projectPath;
    result.totalDuration = currentTime;

    // Step 6: AI Review & Auto-fix (optional, --review flag)
    if (options.review) {
      options.onProgress?.("Reviewing video with Gemini AI...");
      try {
        // Look for storyboard file (YAML preferred, JSON fallback for backward compat)
        const storyboardYaml = resolve(absOutputDir, "storyboard.yaml");
        const storyboardJson = resolve(absOutputDir, "storyboard.json");
        const storyboardFile = existsSync(storyboardYaml) ? storyboardYaml : existsSync(storyboardJson) ? storyboardJson : undefined;
        // Export project to temp MP4 for review (use first valid video as proxy)
        const reviewTarget = videoPaths.find((p) => p && p !== "") || imagePaths.find((p) => p && p !== "");
        if (reviewTarget) {
          const reviewResult = await executeReview({
            videoPath: reviewTarget,
            storyboardPath: storyboardFile,
            autoApply: options.reviewAutoApply,
            model: "flash",
          });

          if (reviewResult.success) {
            result.reviewFeedback = reviewResult.feedback;
            result.appliedFixes = reviewResult.appliedFixes;
            result.reviewedVideoPath = reviewResult.outputPath;
          }
        }
      } catch {
        // Review is non-critical, continue with result
      }
    }

    return result;
  } catch (error) {
    return {
      success: false,
      outputDir,
      scenes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Options for {@link executeRegenerateScene}. */
export interface RegenerateSceneOptions {
  /** Path to the project output directory containing storyboard.json */
  projectDir: string;
  /** 1-indexed scene numbers to regenerate */
  scenes: number[];
  /** Only regenerate video (keep existing image) */
  videoOnly?: boolean;
  /** Only regenerate narration audio */
  narrationOnly?: boolean;
  /** Only regenerate scene image */
  imageOnly?: boolean;
  /** Video generation provider */
  generator?: "grok" | "kling" | "runway" | "veo";
  /** Image generation provider */
  imageProvider?: "gemini" | "openai" | "grok";
  /** ElevenLabs voice name or ID */
  voice?: string;
  /** Video aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Max retries per video generation call */
  retries?: number;
  /** Reference scene number for character consistency (auto-detects if not specified) */
  referenceScene?: number;
  /** Called at per-scene progress points (`Scene N: regenerating narration...`). */
  onProgress?: (message: string) => void;
}

/** Result from {@link executeRegenerateScene}. */
export interface RegenerateSceneResult {
  /** Whether all requested scenes were regenerated */
  success: boolean;
  /** 1-indexed scene numbers successfully regenerated */
  regeneratedScenes: number[];
  /** 1-indexed scene numbers that failed to regenerate */
  failedScenes: number[];
  /** Error message on failure */
  error?: string;
}

/**
 * Regenerate specific scene(s) in an existing script-to-video project.
 *
 * Reads the storyboard.json from the project directory, then regenerates
 * the requested scenes using the specified video/image provider. Supports
 * image-to-video via ImgBB URL upload for Kling.
 *
 * @param options - Scene regeneration configuration
 * @returns Result with lists of regenerated and failed scene numbers
 */
export async function executeRegenerateScene(
  options: RegenerateSceneOptions
): Promise<RegenerateSceneResult> {
  const result: RegenerateSceneResult = {
    success: false,
    regeneratedScenes: [],
    failedScenes: [],
  };

  try {
    const outputDir = resolve(process.cwd(), options.projectDir);

    if (!existsSync(outputDir)) {
      return { ...result, error: `Project directory not found: ${outputDir}` };
    }

    // Load storyboard (YAML preferred, JSON fallback for backward compat)
    const yamlPath = resolve(outputDir, "storyboard.yaml");
    const jsonPath = resolve(outputDir, "storyboard.json");
    const storyboardPath = existsSync(yamlPath) ? yamlPath : existsSync(jsonPath) ? jsonPath : null;

    if (!storyboardPath) {
      return { ...result, error: `Storyboard not found in: ${outputDir} (expected storyboard.yaml or storyboard.json)` };
    }

    const storyboardContent = await readFile(storyboardPath, "utf-8");
    const segments: StoryboardSegment[] = storyboardPath.endsWith(".yaml")
      ? (yamlParse(storyboardContent) as { scenes: StoryboardSegment[] }).scenes
      : JSON.parse(storyboardContent);

    // Validate scenes
    for (const sceneNum of options.scenes) {
      if (sceneNum < 1 || sceneNum > segments.length) {
        return { ...result, error: `Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.` };
      }
    }

    const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
    const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
    const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

    // Get API keys
    let videoApiKey: string | undefined;
    if (regenerateVideo) {
      const generatorKeyMap: Record<string, { envVar: string; name: string }> = {
        grok: { envVar: "XAI_API_KEY", name: "xAI (Grok)" },
        kling: { envVar: "KLING_API_KEY", name: "Kling" },
        runway: { envVar: "RUNWAY_API_SECRET", name: "Runway" },
        veo: { envVar: "GOOGLE_API_KEY", name: "Google (Veo)" },
      };
      const generator = options.generator || "grok";
      const genInfo = generatorKeyMap[generator];
      if (!genInfo) {
        return { ...result, error: `Invalid generator: ${generator}. Available: ${Object.keys(generatorKeyMap).join(", ")}` };
      }
      videoApiKey = (await getApiKey(genInfo.envVar, genInfo.name)) ?? undefined;
      if (!videoApiKey) {
        return { ...result, error: `${genInfo.name} API key required. Run 'vibe setup' or set ${genInfo.envVar} in .env` };
      }
    }

    let imageApiKey: string | undefined;
    if (regenerateImage) {
      const imageProvider = options.imageProvider || "openai";
      const imageKeyMap: Record<typeof imageProvider, { envVar: string; name: string }> = {
        openai: { envVar: "OPENAI_API_KEY", name: "OpenAI" },
        gemini: { envVar: "GOOGLE_API_KEY", name: "Google" },
        grok: { envVar: "XAI_API_KEY", name: "xAI" },
      };
      const info = imageKeyMap[imageProvider];
      if (!info) {
        return { ...result, error: `Invalid imageProvider: ${imageProvider}` };
      }
      imageApiKey = (await getApiKey(info.envVar, info.name)) ?? undefined;
      if (!imageApiKey) {
        return { ...result, error: `${info.name} API key required. Run 'vibe setup' or set ${info.envVar} in .env` };
      }
    }

    let elevenlabsApiKey: string | undefined;
    if (regenerateNarration) {
      elevenlabsApiKey = (await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs")) ?? undefined;
      if (!elevenlabsApiKey) {
        return { ...result, error: "ElevenLabs API key required. Run 'vibe setup' or set ELEVENLABS_API_KEY in .env" };
      }
    }

    // Track storyboard mutations so we only rewrite when segment durations change.
    let storyboardMutated = false;

    // Process each scene
    for (const sceneNum of options.scenes) {
      const segment = segments[sceneNum - 1];
      const narrationPath = resolve(outputDir, `narration-${sceneNum}.mp3`);
      const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);
      const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      let sceneFailed = false;

      // Narration regeneration
      if (regenerateNarration && elevenlabsApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating narration...`);
        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });
        const narrationText = segment.narration || segment.description;

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });
        if (ttsResult.success && ttsResult.audioBuffer) {
          await writeFile(narrationPath, ttsResult.audioBuffer);
          segment.duration = await getAudioDuration(narrationPath);
          storyboardMutated = true;
        } else {
          sceneFailed = true;
        }
      }

      // Image regeneration (with character-consistency reference when available)
      if (!sceneFailed && regenerateImage && imageApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating image...`);
        const imageProvider = options.imageProvider || "openai";

        const characterDesc = segment.characterDescription || segments[0]?.characterDescription;
        let imagePrompt = segment.visualStyle
          ? `${segment.visuals}. Style: ${segment.visualStyle}`
          : segment.visuals;
        if (characterDesc) {
          imagePrompt = `${imagePrompt}\n\nIMPORTANT - Character appearance must match exactly: ${characterDesc}`;
        }

        // Pick a reference image for character consistency: caller-specified,
        // else auto-detect the first existing scene image that isn't this scene.
        let referenceImageBuffer: Buffer | undefined;
        const refSceneNum = options.referenceScene;
        if (refSceneNum && refSceneNum >= 1 && refSceneNum <= segments.length && refSceneNum !== sceneNum) {
          const refImagePath = resolve(outputDir, `scene-${refSceneNum}.png`);
          if (existsSync(refImagePath)) {
            referenceImageBuffer = await readFile(refImagePath);
          }
        } else if (!refSceneNum) {
          for (let i = 1; i <= segments.length; i++) {
            if (i !== sceneNum) {
              const otherImagePath = resolve(outputDir, `scene-${i}.png`);
              if (existsSync(otherImagePath)) {
                referenceImageBuffer = await readFile(otherImagePath);
                break;
              }
            }
          }
        }

        const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
          "16:9": "1536x1024",
          "9:16": "1024x1536",
          "1:1": "1024x1024",
        };
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;

        if (imageProvider === "openai") {
          const openaiImage = new OpenAIImageProvider();
          await openaiImage.initialize({ apiKey: imageApiKey });
          const imageResult = await openaiImage.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio || "16:9"] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) imageBuffer = Buffer.from(img.base64, "base64");
            else if (img.url) imageUrl = img.url;
          }
        } else if (imageProvider === "gemini") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: imageApiKey });
          if (referenceImageBuffer) {
            // Gemini edit-with-reference path — pulls the character forward
            // while describing the new action. Simplified visuals pick the
            // first recognised action verb to reduce prompt bleed.
            const simplifiedVisuals = segment.visuals.split(/[,.]/).find((part: string) =>
              part.includes("standing") || part.includes("sitting") || part.includes("walking") ||
              part.includes("lying") || part.includes("reaching") || part.includes("looking") ||
              part.includes("working") || part.includes("coding") || part.includes("typing")
            ) || segment.visuals.split(".")[0];

            const editPrompt = `Generate a new image showing the SAME SINGLE person from the reference image in a new scene.

REFERENCE: Look at the person in the reference image - their face, hair, build, and overall appearance.

NEW SCENE: ${simplifiedVisuals}

CRITICAL RULES:
1. Show ONLY ONE person - the exact same individual from the reference image
2. The person must have the IDENTICAL face, hair style, and body type
3. Do NOT show multiple people or duplicate the character
4. Create a single moment in time, one pose, one action
5. Match the art style and quality of the reference image

Generate the single-person scene image now.`;

            const imageResult = await gemini.editImage([referenceImageBuffer], editPrompt, {
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images?.[0]?.base64) {
              imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
            }
          } else {
            const imageResult = await gemini.generateImage(imagePrompt, {
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images?.[0]?.base64) {
              imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
            }
          }
        } else if (imageProvider === "grok") {
          const grok = new GrokProvider();
          await grok.initialize({ apiKey: imageApiKey });
          const imageResult = await grok.generateImage(imagePrompt, {
            aspectRatio: options.aspectRatio || "16:9",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) imageBuffer = Buffer.from(img.base64, "base64");
            else if (img.url) imageUrl = img.url;
          }
        }

        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
        } else {
          sceneFailed = true;
        }
      }

      if (sceneFailed) {
        result.failedScenes.push(sceneNum);
        continue;
      }

      if (regenerateVideo && videoApiKey) {
        options.onProgress?.(`Scene ${sceneNum}: regenerating video (${options.generator || "grok"})...`);
        if (!existsSync(imagePath)) {
          result.failedScenes.push(sceneNum);
          continue;
        }

        const imageBuffer = await readFile(imagePath);
        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

        if (options.generator === "grok") {
          // Grok (xAI) — image-to-video with data URI reference
          const grok = new GrokProvider();
          await grok.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          const grokDuration = Math.min(15, Math.max(1, segment.duration));

          const taskResult = await generateVideoWithRetryGrok(
            grok,
            segment,
            {
              duration: grokDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await grok.waitForCompletion(taskResult.requestId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Grok", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Grok", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else if (options.generator === "veo") {
          // Veo (Gemini)
          const veo = new GeminiProvider();
          await veo.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          const veoDuration = (segment.duration > 6 ? 8 : segment.duration > 4 ? 6 : 4) as 4 | 6 | 8;

          const taskResult = await generateVideoWithRetryVeo(
            veo,
            segment,
            {
              duration: veoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await veo.waitForVideoCompletion(taskResult.operationName, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Veo", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Veo", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else if (options.generator === "kling" || !options.generator) {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            result.failedScenes.push(sceneNum);
            continue;
          }

          // Try to use image-to-video if ImgBB key available
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
            }
          }

          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl,
            },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                // Extend via extendVideoToTarget so Kling's own extend API can
                // be used for large gaps (ratio > 1.4) instead of freeze frames.
                await extendVideoToTarget(
                  videoPath,
                  segment.duration,
                  outputDir,
                  `Scene ${sceneNum}`,
                  {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: options.onProgress,
                  }
                );

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Kling", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Kling", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const ext = extname(imagePath).toLowerCase().slice(1);
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

          const aspectRatio = options.aspectRatio === "1:1" ? "16:9" : ((options.aspectRatio || "16:9") as "16:9" | "9:16");

          const taskResult = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            { duration: videoDuration, aspectRatio },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await runway.waitForCompletion(taskResult.taskId, undefined, 300000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const buffer = await downloadVideo(waitResult.videoUrl, videoApiKey);
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration;
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(outputDir, `scene-${sceneNum}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                result.regeneratedScenes.push(sceneNum);
              } else {
                logSceneFailure("Runway", `scene ${sceneNum}`, waitResult);
                result.failedScenes.push(sceneNum);
              }
            } catch (err) {
              logSceneFailure("Runway", `scene ${sceneNum}`, err);
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        }
      } else if (!sceneFailed) {
        // narration-only / image-only / both: no video pass, so record success here
        result.regeneratedScenes.push(sceneNum);
      }
    }

    // Persist storyboard if narration regeneration changed segment durations.
    // Preserve the on-disk format (yaml vs json) so no silent downgrades.
    if (storyboardMutated) {
      let currentTime = 0;
      for (const segment of segments) {
        segment.startTime = currentTime;
        currentTime += segment.duration;
      }
      const serialized = storyboardPath.endsWith(".yaml")
        ? yamlStringify({ scenes: segments }, { indent: 2 })
        : JSON.stringify(segments, null, 2);
      await writeFile(storyboardPath, serialized, "utf-8");
    }

    result.success = result.failedScenes.length === 0;
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* CLI command registration moved to ai-script-pipeline-cli.ts */
