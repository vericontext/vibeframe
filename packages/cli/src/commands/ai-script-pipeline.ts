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
 * generateVideoWithRetryKling, generateVideoWithRetryRunway, waitForVideoWithRetry
 *
 * @dependencies Claude (storyboard), ElevenLabs (TTS), OpenAI/Gemini/Stability (images),
 *              Kling/Runway (video), FFmpeg (assembly/extension)
 */

import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import {
  GeminiProvider,
  OpenAIImageProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
  StabilityProvider,
} from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { Project } from "../engine/index.js";
import { getAudioDuration, getVideoDuration, extendVideoNaturally } from "../utils/audio.js";
import { applyTextOverlays, type TextOverlayStyle, type VideoReviewFeedback } from "./ai-edit.js";
import { executeReview } from "./ai-review.js";

const execAsync = promisify(exec);

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
          const response = await fetch(waitResult.videoUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(extendedVideoPath, buffer);

          // Concatenate original + extension
          const concatPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.mp4`);
          const listPath = resolve(outputDir, `${basename(videoPath, ".mp4")}-concat.txt`);
          await writeFile(listPath, `file '${videoPath}'\nfile '${extendedVideoPath}'`, "utf-8");
          await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`);

          // Trim to exact target duration if concatenated video is longer
          const concatDuration = await getVideoDuration(concatPath);
          if (concatDuration > targetDuration + 0.5) {
            await execAsync(`ffmpeg -y -i "${concatPath}" -t ${targetDuration.toFixed(2)} -c copy "${extendedPath}"`);
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

      if (attempt < maxRetries) {
        onProgress?.(`⚠ Retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        onProgress?.(`⚠ Error: ${errMsg.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        // Log the final error on last attempt
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

      if (attempt < maxRetries) {
        onProgress?.(`⚠ Retry ${attempt + 1}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
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
  /** Target total duration in seconds */
  duration?: number;
  /** ElevenLabs voice name or ID */
  voice?: string;
  /** Video generation provider */
  generator?: "runway" | "kling";
  /** Image generation provider */
  imageProvider?: "openai" | "dalle" | "stability" | "gemini";
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
  /** Skip text overlay step */
  noTextOverlay?: boolean;
  /** Text overlay style preset */
  textStyle?: TextOverlayStyle;
  /** Enable AI review after assembly */
  review?: boolean;
  /** Auto-apply fixable issues from review */
  reviewAutoApply?: boolean;
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
}

/**
 * Execute the full script-to-video pipeline programmatically.
 *
 * Pipeline stages:
 * 1. Generate storyboard with Claude
 * 2. Generate per-scene voiceovers with ElevenLabs TTS
 * 3. Generate scene images (OpenAI/Gemini/Stability)
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
    // Get all required API keys
    const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
    if (!claudeApiKey) {
      return { success: false, outputDir, scenes: 0, error: "Anthropic API key required for storyboard generation" };
    }

    // Get image provider API key
    let imageApiKey: string | undefined;
    const imageProvider = options.imageProvider || "openai";

    if (imageProvider === "openai" || imageProvider === "dalle") {
      imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "OpenAI API key required for image generation" };
      }
    } else if (imageProvider === "stability") {
      imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Stability API key required for image generation" };
      }
    } else if (imageProvider === "gemini") {
      imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
      if (!imageApiKey) {
        return { success: false, outputDir, scenes: 0, error: "Google API key required for Gemini image generation" };
      }
    }

    let elevenlabsApiKey: string | undefined;
    if (!options.noVoiceover) {
      elevenlabsApiKey = (await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs")) ?? undefined;
      if (!elevenlabsApiKey) {
        return { success: false, outputDir, scenes: 0, error: "ElevenLabs API key required for voiceover (or use noVoiceover option)" };
      }
    }

    let videoApiKey: string | undefined;
    if (!options.imagesOnly) {
      if (options.generator === "kling") {
        videoApiKey = (await getApiKey("KLING_API_KEY", "Kling")) ?? undefined;
        if (!videoApiKey) {
          return { success: false, outputDir, scenes: 0, error: "Kling API key required (or use imagesOnly option)" };
        }
      } else {
        videoApiKey = (await getApiKey("RUNWAY_API_SECRET", "Runway")) ?? undefined;
        if (!videoApiKey) {
          return { success: false, outputDir, scenes: 0, error: "Runway API key required (or use imagesOnly option)" };
        }
      }
    }

    // Create output directory
    const absOutputDir = resolve(process.cwd(), outputDir);
    if (!existsSync(absOutputDir)) {
      await mkdir(absOutputDir, { recursive: true });
    }

    // Step 1: Generate storyboard with Claude
    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: claudeApiKey });

    const segments = await claude.analyzeContent(
      options.script,
      options.duration,
      { creativity: options.creativity }
    );
    if (segments.length === 0) {
      return { success: false, outputDir, scenes: 0, error: "Failed to generate storyboard" };
    }

    // Save storyboard
    const storyboardPath = resolve(absOutputDir, "storyboard.json");
    await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");

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

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (ttsResult.success && ttsResult.audioBuffer) {
          const audioPath = resolve(absOutputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration
          const actualDuration = await getAudioDuration(audioPath);
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
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
    }

    // Step 3: Generate images
    const dalleImageSizes: Record<string, "1536x1024" | "1024x1536" | "1024x1024"> = {
      "16:9": "1536x1024",
      "9:16": "1024x1536",
      "1:1": "1024x1024",
    };
    type StabilityAspectRatio = "16:9" | "1:1" | "21:9" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "9:21";
    const stabilityAspectRatios: Record<string, StabilityAspectRatio> = {
      "16:9": "16:9",
      "9:16": "9:16",
      "1:1": "1:1",
    };

    let openaiImageInstance: OpenAIImageProvider | undefined;
    let stabilityInstance: StabilityProvider | undefined;
    let geminiInstance: GeminiProvider | undefined;

    if (imageProvider === "openai" || imageProvider === "dalle") {
      openaiImageInstance = new OpenAIImageProvider();
      await openaiImageInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "stability") {
      stabilityInstance = new StabilityProvider();
      await stabilityInstance.initialize({ apiKey: imageApiKey! });
    } else if (imageProvider === "gemini") {
      geminiInstance = new GeminiProvider();
      await geminiInstance.initialize({ apiKey: imageApiKey! });
    }

    const imagePaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const imagePrompt = segment.visualStyle
        ? `${segment.visuals}. Style: ${segment.visualStyle}`
        : segment.visuals;

      try {
        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;
        let imageError: string | undefined;

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
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "stability" && stabilityInstance) {
          const imageResult = await stabilityInstance.generateImage(imagePrompt, {
            aspectRatio: stabilityAspectRatios[options.aspectRatio || "16:9"] || "16:9",
            model: "sd3.5-large",
          });
          if (imageResult.success && imageResult.images?.[0]) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "gemini" && geminiInstance) {
          const imageResult = await geminiInstance.generateImage(imagePrompt, {
            aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1",
          });
          if (imageResult.success && imageResult.images?.[0]?.base64) {
            imageBuffer = Buffer.from(imageResult.images[0].base64, "base64");
          } else {
            imageError = imageResult.error;
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
          // Track failed scene - error details are in imageError but not exposed in result type
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

    // Step 4: Generate videos (if not images-only)
    const videoPaths: string[] = [];
    const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

    if (!options.imagesOnly && videoApiKey) {
      if (options.generator === "kling") {
        const kling = new KlingProvider();
        await kling.initialize({ apiKey: videoApiKey });

        if (!kling.isConfigured()) {
          return { success: false, outputDir: absOutputDir, scenes: segments.length, error: "Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY" };
        }

        for (let i = 0; i < segments.length; i++) {
          if (!imagePaths[i]) {
            videoPaths.push("");
            continue;
          }

          const segment = segments[i] as StoryboardSegment;
          const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

          // Using text2video since Kling's image2video requires URL (not base64)
          const taskResult = await generateVideoWithRetryKling(
            kling,
            segment,
            { duration: videoDuration, aspectRatio: (options.aspectRatio || "16:9") as "16:9" | "9:16" | "1:1" },
            maxRetries
          );

          if (taskResult) {
            try {
              const waitResult = await kling.waitForCompletion(taskResult.taskId, taskResult.type, undefined, 600000);
              if (waitResult.status === "completed" && waitResult.videoUrl) {
                const videoPath = resolve(absOutputDir, `scene-${i + 1}.mp4`);
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration; // Already updated to narration length
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  // Replace original with extended version
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch {
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
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
                await writeFile(videoPath, buffer);

                // Extend video to match narration duration if needed
                const targetDuration = segment.duration; // Already updated to narration length
                const actualVideoDuration = await getVideoDuration(videoPath);

                if (actualVideoDuration < targetDuration - 0.1) {
                  const extendedPath = resolve(absOutputDir, `scene-${i + 1}-extended.mp4`);
                  await extendVideoNaturally(videoPath, targetDuration, extendedPath);
                  // Replace original with extended version
                  await unlink(videoPath);
                  await rename(extendedPath, videoPath);
                }

                videoPaths.push(videoPath);
                result.videos!.push(videoPath);
              } else {
                videoPaths.push("");
                result.failedScenes!.push(i + 1);
              }
            } catch {
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

    // Save project file
    const projectPath = resolve(absOutputDir, "project.vibe.json");
    await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
    result.projectPath = projectPath;
    result.totalDuration = currentTime;

    // Step 6: AI Review & Auto-fix (optional, --review flag)
    if (options.review) {
      try {
        const storyboardFile = resolve(absOutputDir, "storyboard.json");
        // Export project to temp MP4 for review (use first valid video as proxy)
        const reviewTarget = videoPaths.find((p) => p && p !== "") || imagePaths.find((p) => p && p !== "");
        if (reviewTarget) {
          const reviewResult = await executeReview({
            videoPath: reviewTarget,
            storyboardPath: existsSync(storyboardFile) ? storyboardFile : undefined,
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
  generator?: "kling" | "runway";
  /** Image generation provider */
  imageProvider?: "gemini" | "openai" | "stability";
  /** ElevenLabs voice name or ID */
  voice?: string;
  /** Video aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Max retries per video generation call */
  retries?: number;
  /** Reference scene number for character consistency (auto-detects if not specified) */
  referenceScene?: number;
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
    const storyboardPath = resolve(outputDir, "storyboard.json");

    if (!existsSync(outputDir)) {
      return { ...result, error: `Project directory not found: ${outputDir}` };
    }

    if (!existsSync(storyboardPath)) {
      return { ...result, error: `Storyboard not found: ${storyboardPath}` };
    }

    const storyboardContent = await readFile(storyboardPath, "utf-8");
    const segments: StoryboardSegment[] = JSON.parse(storyboardContent);

    // Validate scenes
    for (const sceneNum of options.scenes) {
      if (sceneNum < 1 || sceneNum > segments.length) {
        return { ...result, error: `Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.` };
      }
    }

    const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);

    // Get API keys
    let videoApiKey: string | undefined;
    if (regenerateVideo) {
      if (options.generator === "kling" || !options.generator) {
        videoApiKey = (await getApiKey("KLING_API_KEY", "Kling")) ?? undefined;
        if (!videoApiKey) {
          return { ...result, error: "Kling API key required" };
        }
      } else {
        videoApiKey = (await getApiKey("RUNWAY_API_SECRET", "Runway")) ?? undefined;
        if (!videoApiKey) {
          return { ...result, error: "Runway API key required" };
        }
      }
    }

    // Process each scene
    for (const sceneNum of options.scenes) {
      const segment = segments[sceneNum - 1];
      const imagePath = resolve(outputDir, `scene-${sceneNum}.png`);
      const videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      if (regenerateVideo && videoApiKey) {
        if (!existsSync(imagePath)) {
          result.failedScenes.push(sceneNum);
          continue;
        }

        const imageBuffer = await readFile(imagePath);
        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = options.retries ?? DEFAULT_VIDEO_RETRIES;

        if (options.generator === "kling" || !options.generator) {
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
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
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
                result.failedScenes.push(sceneNum);
              }
            } catch {
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
                const response = await fetch(waitResult.videoUrl);
                const buffer = Buffer.from(await response.arrayBuffer());
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
                result.failedScenes.push(sceneNum);
              }
            } catch {
              result.failedScenes.push(sceneNum);
            }
          } else {
            result.failedScenes.push(sceneNum);
          }
        }
      }
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
