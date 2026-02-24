import { Command } from "commander";
import { readFile, writeFile, mkdir, unlink, rename, stat } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  GeminiProvider,
  OpenAIProvider,
  OpenAIImageProvider,
  ClaudeProvider,
  ElevenLabsProvider,
  KlingProvider,
  RunwayProvider,
  StabilityProvider,
} from "@vibeframe/ai-providers";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { Project, type ProjectFile } from "../engine/index.js";
import { getAudioDuration, getVideoDuration, extendVideoNaturally } from "../utils/audio.js";
import { applyTextOverlays, type TextOverlayStyle, type VideoReviewFeedback } from "./ai-edit.js";
import { executeReview } from "./ai-review.js";
import { formatTime } from "./ai-helpers.js";

const execAsync = promisify(exec);

// Helper type for storyboard segments
interface StoryboardSegment {
  index?: number;
  description: string;
  visuals: string;
  visualStyle?: string;
  characterDescription?: string;
  previousSceneLink?: string;
  narration?: string;
  audio?: string;
  textOverlays?: string[];
  duration: number;
  startTime: number;
}

// Default retry count for video generation
const DEFAULT_VIDEO_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload image to ImgBB and return the URL
 * Used for Kling v2.5/v2.6 image-to-video which requires URL (not base64)
 */
async function uploadToImgbb(
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
async function extendVideoToTarget(
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
async function generateVideoWithRetryKling(
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
async function generateVideoWithRetryRunway(
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
async function waitForVideoWithRetry(
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

export interface ScriptToVideoOptions {
  script: string;
  outputDir?: string;
  duration?: number;
  voice?: string;
  generator?: "runway" | "kling";
  imageProvider?: "openai" | "dalle" | "stability" | "gemini";
  aspectRatio?: "16:9" | "9:16" | "1:1";
  imagesOnly?: boolean;
  noVoiceover?: boolean;
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

/**
 * Result of script-to-video pipeline
 */
export interface ScriptToVideoResult {
  success: boolean;
  outputDir: string;
  scenes: number;
  storyboardPath?: string;
  projectPath?: string;
  /** @deprecated Use narrationEntries for proper segment tracking */
  narrations?: string[];
  /** Narration entries with segment index tracking */
  narrationEntries?: NarrationEntry[];
  images?: string[];
  videos?: string[];
  totalDuration?: number;
  failedScenes?: number[];
  /** Failed narration scene numbers (1-indexed) */
  failedNarrations?: number[];
  error?: string;
  /** Review feedback from Gemini (when --review is used) */
  reviewFeedback?: VideoReviewFeedback;
  /** List of auto-applied fixes (when --review-auto-apply is used) */
  appliedFixes?: string[];
  /** Path to reviewed/fixed video (when review auto-applied) */
  reviewedVideoPath?: string;
}

/**
 * Execute the script-to-video pipeline programmatically
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

/**
 * Options for scene regeneration
 */
export interface RegenerateSceneOptions {
  projectDir: string;
  scenes: number[];
  videoOnly?: boolean;
  narrationOnly?: boolean;
  imageOnly?: boolean;
  generator?: "kling" | "runway";
  imageProvider?: "gemini" | "openai" | "stability";
  voice?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  retries?: number;
  /** Reference scene number for character consistency (auto-detects if not specified) */
  referenceScene?: number;
}

/**
 * Result of scene regeneration
 */
export interface RegenerateSceneResult {
  success: boolean;
  regeneratedScenes: number[];
  failedScenes: number[];
  error?: string;
}

/**
 * Execute scene regeneration programmatically
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

export function registerScriptPipelineCommands(aiCommand: Command): void {
// Script-to-Video command
aiCommand
  .command("script-to-video")
  .description("Generate complete video from text script using AI pipeline")
  .argument("<script>", "Script text or file path (use -f for file)")
  .option("-f, --file", "Treat script argument as file path")
  .option("-o, --output <path>", "Output project file path", "script-video.vibe.json")
  .option("-d, --duration <seconds>", "Target total duration in seconds")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-g, --generator <engine>", "Video generator: kling | runway", "kling")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | stability", "gemini")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--images-only", "Generate images only, skip video generation")
  .option("--no-voiceover", "Skip voiceover generation")
  .option("--output-dir <dir>", "Directory for generated assets", "script-video-output")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--sequential", "Generate videos one at a time (slower but more reliable)")
  .option("--concurrency <count>", "Max concurrent video tasks in parallel mode (default: 3)", "3")
  .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
  .option("--no-text-overlay", "Skip text overlay step")
  .option("--text-style <style>", "Text overlay style: lower-third, center-bold, subtitle, minimal", "lower-third")
  .option("--review", "Run AI review after assembly (requires GOOGLE_API_KEY)")
  .option("--review-auto-apply", "Auto-apply fixable issues from AI review")
  .action(async (script: string, options) => {
    try {
      // Load environment variables from .env file
      loadEnv();

      // Get all required API keys upfront
      const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
      if (!claudeApiKey) {
        console.error(chalk.red("Anthropic API key required for storyboard generation"));
        process.exit(1);
      }

      // Get image provider API key
      let imageApiKey: string | undefined;
      const imageProvider = options.imageProvider || "openai";

      if (imageProvider === "openai" || imageProvider === "dalle") {
        imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("OpenAI API key required for DALL-E image generation"));
          process.exit(1);
        }
      } else if (imageProvider === "stability") {
        imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("Stability API key required for image generation"));
          process.exit(1);
        }
      } else if (imageProvider === "gemini") {
        imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
        if (!imageApiKey) {
          console.error(chalk.red("Google API key required for Gemini image generation"));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`Unknown image provider: ${imageProvider}. Use openai, stability, or gemini`));
        process.exit(1);
      }

      let elevenlabsApiKey: string | undefined;
      if (options.voiceover !== false) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          console.error(chalk.red("ElevenLabs API key required for voiceover (or use --no-voiceover)"));
          process.exit(1);
        }
        elevenlabsApiKey = key;
      }

      let videoApiKey: string | undefined;
      if (!options.imagesOnly) {
        if (options.generator === "kling") {
          const key = await getApiKey("KLING_API_KEY", "Kling");
          if (!key) {
            console.error(chalk.red("Kling API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        } else {
          const key = await getApiKey("RUNWAY_API_SECRET", "Runway");
          if (!key) {
            console.error(chalk.red("Runway API key required (or use --images-only)"));
            process.exit(1);
          }
          videoApiKey = key;
        }
      }

      // Read script content
      let scriptContent = script;
      if (options.file) {
        const filePath = resolve(process.cwd(), script);
        scriptContent = await readFile(filePath, "utf-8");
      }

      // Determine output directory for assets
      // If -o looks like a directory and --output-dir is not explicitly set, use -o directory for assets
      let effectiveOutputDir = options.outputDir;
      const outputLooksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") && !options.output.endsWith(".vibe.json"));

      if (outputLooksLikeDirectory && options.outputDir === "script-video-output") {
        // User specified a directory for -o but didn't set --output-dir, use -o directory for assets
        effectiveOutputDir = options.output;
      }

      // Create output directory
      const outputDir = resolve(process.cwd(), effectiveOutputDir);
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        console.error(chalk.red("Invalid creativity level. Use 'low' or 'high'."));
        process.exit(1);
      }

      console.log();
      console.log(chalk.bold.cyan("🎬 Script-to-Video Pipeline"));
      console.log(chalk.dim("─".repeat(60)));
      if (creativity === "high") {
        console.log(chalk.yellow("🎨 High creativity mode: Generating varied, unexpected scenes"));
      }
      console.log();

      // Step 1: Generate storyboard with Claude
      const storyboardSpinnerText = creativity === "high"
        ? "📝 Analyzing script with Claude (high creativity)..."
        : "📝 Analyzing script with Claude...";
      const storyboardSpinner = ora(storyboardSpinnerText).start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey: claudeApiKey });

      const segments = await claude.analyzeContent(
        scriptContent,
        options.duration ? parseFloat(options.duration) : undefined,
        { creativity: creativity as "low" | "high" | undefined }
      );

      if (segments.length === 0) {
        storyboardSpinner.fail(chalk.red("Failed to generate storyboard (check API key and error above)"));
        process.exit(1);
      }

      let totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
      storyboardSpinner.succeed(chalk.green(`Generated ${segments.length} scenes (total: ${totalDuration}s)`));

      // Save storyboard
      const storyboardPath = resolve(outputDir, "storyboard.json");
      await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
      console.log(chalk.dim(`  → Saved: ${storyboardPath}`));
      console.log();

      // Step 2: Generate per-scene voiceovers with ElevenLabs
      const perSceneTTS: { path: string; duration: number; segmentIndex: number }[] = [];
      const failedNarrations: { sceneNum: number; error: string }[] = [];

      if (options.voiceover !== false && elevenlabsApiKey) {
        const ttsSpinner = ora("🎙️ Generating voiceovers with ElevenLabs...").start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        let totalCharacters = 0;

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          const narrationText = segment.narration || segment.description;

          if (!narrationText) continue;

          ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}...`;

          let ttsResult = await elevenlabs.textToSpeech(narrationText, {
            voiceId: options.voice,
          });

          if (!ttsResult.success || !ttsResult.audioBuffer) {
            const errorMsg = ttsResult.error || "Unknown error";
            failedNarrations.push({ sceneNum: i + 1, error: errorMsg });
            ttsSpinner.text = `🎙️ Generating narration ${i + 1}/${segments.length}... (failed)`;
            console.log(chalk.yellow(`\n  ⚠ Narration ${i + 1} failed: ${errorMsg}`));
            continue;
          }

          const audioPath = resolve(outputDir, `narration-${i + 1}.mp3`);
          await writeFile(audioPath, ttsResult.audioBuffer);

          // Get actual audio duration using ffprobe
          let actualDuration = await getAudioDuration(audioPath);

          // Auto speed-adjust if narration slightly exceeds video bracket (5s or 10s)
          const videoBracket = segment.duration > 5 ? 10 : 5;
          const overageRatio = actualDuration / videoBracket;
          if (overageRatio > 1.0 && overageRatio <= 1.15) {
            // Narration exceeds bracket by 0-15% — regenerate slightly faster
            const adjustedSpeed = Math.min(1.2, parseFloat(overageRatio.toFixed(2)));
            ttsSpinner.text = `🎙️ Narration ${i + 1}: adjusting speed to ${adjustedSpeed}x...`;
            const speedResult = await elevenlabs.textToSpeech(narrationText, {
              voiceId: options.voice,
              speed: adjustedSpeed,
            });
            if (speedResult.success && speedResult.audioBuffer) {
              await writeFile(audioPath, speedResult.audioBuffer);
              actualDuration = await getAudioDuration(audioPath);
              ttsResult = speedResult;
              console.log(chalk.dim(`  → Speed-adjusted narration ${i + 1}: ${adjustedSpeed}x → ${actualDuration.toFixed(1)}s`));
            }
          }

          // Update segment duration to match actual narration length
          segment.duration = actualDuration;

          perSceneTTS.push({ path: audioPath, duration: actualDuration, segmentIndex: i });
          totalCharacters += ttsResult.characterCount || 0;

          console.log(chalk.dim(`  → Saved: ${audioPath} (${actualDuration.toFixed(1)}s)`));
        }

        // Recalculate startTime for all segments based on updated durations
        let currentTime = 0;
        for (const segment of segments) {
          segment.startTime = currentTime;
          currentTime += segment.duration;
        }

        // Update total duration
        totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

        // Show success with failed count if any
        if (failedNarrations.length > 0) {
          ttsSpinner.warn(chalk.yellow(`Generated ${perSceneTTS.length}/${segments.length} narrations (${failedNarrations.length} failed)`));
        } else {
          ttsSpinner.succeed(chalk.green(`Generated ${perSceneTTS.length}/${segments.length} narrations (${totalCharacters} chars, ${totalDuration.toFixed(1)}s total)`));
        }

        // Re-save storyboard with updated durations
        await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
        console.log();
      }

      // Step 3: Generate images with selected provider
      const providerNames: Record<string, string> = {
        openai: "OpenAI GPT Image 1.5",
        dalle: "OpenAI GPT Image 1.5", // backward compatibility
        stability: "Stability AI",
        gemini: "Gemini",
      };
      const imageSpinner = ora(`🎨 Generating visuals with ${providerNames[imageProvider]}...`).start();

      // Determine image size/aspect ratio based on provider
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

      const imagePaths: string[] = [];

      // Store first scene image for style continuity
      let firstSceneImage: Buffer | undefined;

      // Initialize the selected provider
      let openaiImageInstance: OpenAIImageProvider | undefined;
      let stabilityInstance: StabilityProvider | undefined;
      let geminiInstance: GeminiProvider | undefined;

      if (imageProvider === "openai" || imageProvider === "dalle") {
        openaiImageInstance = new OpenAIImageProvider();
        await openaiImageInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "stability") {
        stabilityInstance = new StabilityProvider();
        await stabilityInstance.initialize({ apiKey: imageApiKey });
      } else if (imageProvider === "gemini") {
        geminiInstance = new GeminiProvider();
        await geminiInstance.initialize({ apiKey: imageApiKey });
      }

      // Get character description from first segment (should be same across all)
      const characterDescription = segments[0]?.characterDescription;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        imageSpinner.text = `🎨 Generating image ${i + 1}/${segments.length}: ${segment.description.slice(0, 30)}...`;

        // Build comprehensive image prompt with character description
        let imagePrompt = segment.visuals;

        // Add character description to ensure consistency
        if (characterDescription) {
          imagePrompt = `CHARACTER (must match exactly): ${characterDescription}. SCENE: ${imagePrompt}`;
        }

        // Add visual style
        if (segment.visualStyle) {
          imagePrompt = `${imagePrompt}. STYLE: ${segment.visualStyle}`;
        }

        // For scenes after the first, add extra continuity instruction (OpenAI/Stability)
        // Gemini uses editImage with reference instead
        if (i > 0 && firstSceneImage && imageProvider !== "gemini") {
          imagePrompt = `${imagePrompt}. CRITICAL: The character must look IDENTICAL to the first scene - same face, hair, clothing, accessories.`;
        }

        try {
          let imageBuffer: Buffer | undefined;
          let imageUrl: string | undefined;
          let imageError: string | undefined;

          if ((imageProvider === "openai" || imageProvider === "dalle") && openaiImageInstance) {
            const imageResult = await openaiImageInstance.generateImage(imagePrompt, {
              size: dalleImageSizes[options.aspectRatio] || "1536x1024",
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
              aspectRatio: stabilityAspectRatios[options.aspectRatio] || "16:9",
              model: "sd3.5-large",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              // Stability returns base64 or URL
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
            // Gemini: use editImage with first scene reference for subsequent scenes
            if (i > 0 && firstSceneImage) {
              // Use editImage to maintain style continuity with first scene
              const editPrompt = `Create a new scene for a video: ${imagePrompt}. IMPORTANT: Maintain the exact same character appearance, clothing, environment style, color palette, and art style as the reference image.`;
              const imageResult = await geminiInstance.editImage([firstSceneImage], editPrompt, {
                aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              });
              if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
                const img = imageResult.images[0];
                if (img.base64) {
                  imageBuffer = Buffer.from(img.base64, "base64");
                }
              } else {
                imageError = imageResult.error;
              }
            } else {
              // First scene: use regular generateImage
              const imageResult = await geminiInstance.generateImage(imagePrompt, {
                aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              });
              if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
                const img = imageResult.images[0];
                if (img.base64) {
                  imageBuffer = Buffer.from(img.base64, "base64");
                }
              } else {
                imageError = imageResult.error;
              }
            }
          }

          // Save the image
          const imagePath = resolve(outputDir, `scene-${i + 1}.png`);

          if (imageBuffer) {
            await writeFile(imagePath, imageBuffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = imageBuffer;
            }
          } else if (imageUrl) {
            const response = await fetch(imageUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            await writeFile(imagePath, buffer);
            imagePaths.push(imagePath);
            // Store first successful image for style continuity
            if (!firstSceneImage) {
              firstSceneImage = buffer;
            }
          } else {
            const errorMsg = imageError || "Unknown error";
            console.log(chalk.yellow(`\n  ⚠ Failed to generate image for scene ${i + 1}: ${errorMsg}`));
            imagePaths.push("");
          }
        } catch (err) {
          console.log(chalk.yellow(`\n  ⚠ Error generating image for scene ${i + 1}: ${err}`));
          imagePaths.push("");
        }

        // Small delay to avoid rate limiting
        if (i < segments.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const successfulImages = imagePaths.filter((p) => p !== "").length;
      imageSpinner.succeed(chalk.green(`Generated ${successfulImages}/${segments.length} images with ${providerNames[imageProvider]}`));
      console.log();

      // Step 4: Generate videos (if not images-only)
      const videoPaths: string[] = [];
      const failedScenes: number[] = []; // Track failed scenes for summary
      const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

      if (!options.imagesOnly && videoApiKey) {
        const videoSpinner = ora(`🎬 Generating videos with ${options.generator === "kling" ? "Kling" : "Runway"}...`).start();

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          // Check for ImgBB API key for image-to-video support (from config or env)
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          const useImageToVideo = !!imgbbApiKey;

          if (useImageToVideo) {
            videoSpinner.text = `🎬 Uploading images to ImgBB for image-to-video...`;
          }

          // Upload images to ImgBB if API key is available (for Kling v2.x image-to-video)
          const imageUrls: (string | undefined)[] = [];
          if (useImageToVideo) {
            for (let i = 0; i < imagePaths.length; i++) {
              if (imagePaths[i] && imagePaths[i] !== "") {
                try {
                  const imageBuffer = await readFile(imagePaths[i]);
                  const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
                  if (uploadResult.success && uploadResult.url) {
                    imageUrls[i] = uploadResult.url;
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Failed to upload image ${i + 1}: ${uploadResult.error}`));
                    imageUrls[i] = undefined;
                  }
                } catch {
                  imageUrls[i] = undefined;
                }
              } else {
                imageUrls[i] = undefined;
              }
            }
            const uploadedCount = imageUrls.filter((u) => u).length;
            if (uploadedCount > 0) {
              videoSpinner.text = `🎬 Uploaded ${uploadedCount}/${imagePaths.length} images to ImgBB`;
            }
          }

          // Sequential mode: generate one video at a time (slower but more reliable)
          if (options.sequential) {
            for (let i = 0; i < segments.length; i++) {
              const segment = segments[i] as StoryboardSegment;
              videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: Starting...`;

              const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
              const referenceImage = imageUrls[i];

              let completed = false;
              for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  0, // Handle retries at this level
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${msg}`;
                  }
                );

                if (!result) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Submit failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                    continue;
                  }
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1}`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                  break;
                }

                try {
                  const waitResult = await kling.waitForCompletion(
                    result.taskId,
                    result.type,
                    (status) => {
                      videoSpinner.text = `🎬 Scene ${i + 1}/${segments.length}: ${status.status}...`;
                    },
                    600000
                  );

                  if (waitResult.status === "completed" && waitResult.videoUrl) {
                    const videoPath = resolve(outputDir, `scene-${i + 1}.mp4`);
                    const response = await fetch(waitResult.videoUrl);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    await writeFile(videoPath, buffer);

                    // Extend video to match narration duration if needed
                    await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${i + 1}`, {
                      kling,
                      videoId: waitResult.videoId,
                      onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                    });

                    videoPaths[i] = videoPath;
                    completed = true;
                    console.log(chalk.green(`\n  ✓ Scene ${i + 1} completed`));
                  } else if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Failed, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                } catch (err) {
                  if (attempt < maxRetries) {
                    videoSpinner.text = `🎬 Scene ${i + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                    await sleep(RETRY_DELAY_MS);
                  } else {
                    console.log(chalk.yellow(`\n  ⚠ Error for scene ${i + 1}: ${err}`));
                    videoPaths[i] = "";
                    failedScenes.push(i + 1);
                  }
                }
              }
            }
          } else {
            // Parallel mode (default): batch-based submission respecting concurrency limit
            const concurrency = Math.max(1, parseInt(options.concurrency) || 3);

            for (let batchStart = 0; batchStart < segments.length; batchStart += concurrency) {
              const batchEnd = Math.min(batchStart + concurrency, segments.length);
              const batchNum = Math.floor(batchStart / concurrency) + 1;
              const totalBatches = Math.ceil(segments.length / concurrency);

              if (totalBatches > 1) {
                videoSpinner.text = `🎬 Batch ${batchNum}/${totalBatches}: submitting scenes ${batchStart + 1}-${batchEnd}...`;
              }

              // Phase 1: Submit batch
              const tasks: Array<{ taskId: string; index: number; segment: StoryboardSegment; type: "text2video" | "image2video" }> = [];

              for (let i = batchStart; i < batchEnd; i++) {
                const segment = segments[i] as StoryboardSegment;
                videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

                const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
                const referenceImage = imageUrls[i];

                const result = await generateVideoWithRetryKling(
                  kling,
                  segment,
                  {
                    duration: videoDuration,
                    aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                    referenceImage,
                  },
                  maxRetries,
                  (msg) => {
                    videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
                  }
                );

                if (result) {
                  tasks.push({ taskId: result.taskId, index: i, segment, type: result.type });
                  if (!videoPaths[i]) videoPaths[i] = "";
                } else {
                  console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
                  videoPaths[i] = "";
                  failedScenes.push(i + 1);
                }
              }

              // Phase 2: Wait for batch completion
              videoSpinner.text = `🎬 Waiting for batch ${batchNum} (${tasks.length} video${tasks.length > 1 ? "s" : ""})...`;

              for (const task of tasks) {
                let completed = false;
                let currentTaskId = task.taskId;
                let currentType = task.type;

                for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
                  try {
                    const result = await kling.waitForCompletion(
                      currentTaskId,
                      currentType,
                      (status) => {
                        videoSpinner.text = `🎬 Scene ${task.index + 1}: ${status.status}...`;
                      },
                      600000
                    );

                    if (result.status === "completed" && result.videoUrl) {
                      const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                      const response = await fetch(result.videoUrl);
                      const buffer = Buffer.from(await response.arrayBuffer());
                      await writeFile(videoPath, buffer);

                      // Extend video to match narration duration if needed
                      await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                        kling,
                        videoId: result.videoId,
                        onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                      });

                      videoPaths[task.index] = videoPath;
                      completed = true;
                    } else if (attempt < maxRetries) {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);

                      const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                      const retryReferenceImage = imageUrls[task.index];

                      const retryResult = await generateVideoWithRetryKling(
                        kling,
                        task.segment,
                        {
                          duration: videoDuration,
                          aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
                          referenceImage: retryReferenceImage,
                        },
                        0
                      );

                      if (retryResult) {
                        currentTaskId = retryResult.taskId;
                        currentType = retryResult.type;
                      } else {
                        videoPaths[task.index] = "";
                        failedScenes.push(task.index + 1);
                        completed = true;
                      }
                    } else {
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    }
                  } catch (err) {
                    if (attempt >= maxRetries) {
                      console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                      videoPaths[task.index] = "";
                      failedScenes.push(task.index + 1);
                    } else {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                      await sleep(RETRY_DELAY_MS);
                    }
                  }
                }
              }

              if (totalBatches > 1 && batchEnd < segments.length) {
                console.log(chalk.dim(`  → Batch ${batchNum}/${totalBatches} complete`));
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          // Submit all video generation tasks with retry logic
          const tasks: Array<{ taskId: string; index: number; imagePath: string; referenceImage: string; segment: StoryboardSegment }> = [];

          for (let i = 0; i < segments.length; i++) {
            if (!imagePaths[i]) {
              videoPaths.push("");
              continue;
            }

            const segment = segments[i] as StoryboardSegment;
            videoSpinner.text = `🎬 Submitting video task ${i + 1}/${segments.length}...`;

            const imageBuffer = await readFile(imagePaths[i]);
            const ext = extname(imagePaths[i]).toLowerCase().slice(1);
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
            const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

            // Use 10s video if narration > 5s to avoid video ending before narration
            const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;

            const result = await generateVideoWithRetryRunway(
              runway,
              segment,
              referenceImage,
              {
                duration: videoDuration,
                aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
              },
              maxRetries,
              (msg) => {
                videoSpinner.text = `🎬 Scene ${i + 1}: ${msg}`;
              }
            );

            if (result) {
              tasks.push({ taskId: result.taskId, index: i, imagePath: imagePaths[i], referenceImage, segment });
            } else {
              console.log(chalk.yellow(`\n  ⚠ Failed to start video generation for scene ${i + 1} (after ${maxRetries} retries)`));
              videoPaths[i] = "";
              failedScenes.push(i + 1);
            }
          }

          // Wait for all tasks to complete with retry logic
          videoSpinner.text = `🎬 Waiting for ${tasks.length} video(s) to complete...`;

          for (const task of tasks) {
            let completed = false;
            let currentTaskId = task.taskId;

            for (let attempt = 0; attempt <= maxRetries && !completed; attempt++) {
              try {
                const result = await runway.waitForCompletion(
                  currentTaskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${task.index + 1}: ${progress}...`;
                  },
                  300000 // 5 minute timeout per video
                );

                if (result.status === "completed" && result.videoUrl) {
                  const videoPath = resolve(outputDir, `scene-${task.index + 1}.mp4`);
                  const response = await fetch(result.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, task.segment.duration, outputDir, `Scene ${task.index + 1}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoPaths[task.index] = videoPath;
                  completed = true;
                } else if (attempt < maxRetries) {
                  // Resubmit task on failure
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);

                  const videoDuration = (task.segment.duration > 5 ? 10 : 5) as 5 | 10;
                  const retryResult = await generateVideoWithRetryRunway(
                    runway,
                    task.segment,
                    task.referenceImage,
                    {
                      duration: videoDuration,
                      aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
                    },
                    0, // No nested retries
                    (msg) => {
                      videoSpinner.text = `🎬 Scene ${task.index + 1}: ${msg}`;
                    }
                  );

                  if (retryResult) {
                    currentTaskId = retryResult.taskId;
                  } else {
                    videoPaths[task.index] = "";
                    failedScenes.push(task.index + 1);
                    completed = true; // Exit retry loop
                  }
                } else {
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  console.log(chalk.yellow(`\n  ⚠ Error completing video for scene ${task.index + 1}: ${err}`));
                  videoPaths[task.index] = "";
                  failedScenes.push(task.index + 1);
                } else {
                  videoSpinner.text = `🎬 Scene ${task.index + 1}: Error, retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              }
            }
          }
        }

        const successfulVideos = videoPaths.filter((p) => p && p !== "").length;
        videoSpinner.succeed(chalk.green(`Generated ${successfulVideos}/${segments.length} videos`));
        console.log();
      }

      // Step 4.5: Apply text overlays (if segments have textOverlays)
      if (options.textOverlay !== false) {
        const overlaySegments = segments.filter(
          (s: StoryboardSegment, i: number) => s.textOverlays && s.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== ""
        );
        if (overlaySegments.length > 0) {
          const overlaySpinner = ora(`Applying text overlays to ${overlaySegments.length} scene(s)...`).start();
          let overlayCount = 0;
          for (let i = 0; i < segments.length; i++) {
            const segment = segments[i] as StoryboardSegment;
            if (segment.textOverlays && segment.textOverlays.length > 0 && videoPaths[i] && videoPaths[i] !== "") {
              try {
                const overlayOutput = videoPaths[i].replace(/(\.[^.]+)$/, "-overlay$1");
                const overlayResult = await applyTextOverlays({
                  videoPath: videoPaths[i],
                  texts: segment.textOverlays,
                  outputPath: overlayOutput,
                  style: (options.textStyle as TextOverlayStyle) || "lower-third",
                });
                if (overlayResult.success && overlayResult.outputPath) {
                  videoPaths[i] = overlayResult.outputPath;
                  overlayCount++;
                }
              } catch {
                // Silent fallback: keep original video
              }
            }
          }
          overlaySpinner.succeed(chalk.green(`Applied text overlays to ${overlayCount} scene(s)`));
          console.log();
        }
      }

      // Step 5: Assemble project
      const assembleSpinner = ora("Assembling project...").start();

      const project = new Project("Script-to-Video Output");
      project.setAspectRatio(options.aspectRatio as "16:9" | "9:16" | "1:1");

      // Clear default tracks and create new ones
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

      // Add per-scene narration sources and clips
      for (const tts of perSceneTTS) {
        const segment = segments[tts.segmentIndex];
        const audioSource = project.addSource({
          name: `Narration ${tts.segmentIndex + 1}`,
          url: tts.path,
          type: "audio",
          duration: tts.duration,
        });

        project.addClip({
          sourceId: audioSource.id,
          trackId: audioTrack.id,
          startTime: segment.startTime,
          duration: tts.duration,
          sourceStartOffset: 0,
          sourceEndOffset: tts.duration,
        });
      }

      // Add video/image sources and clips
      let currentTime = 0;
      const videoClipIds: string[] = [];
      const fadeDuration = 0.3; // Fade duration in seconds for smooth transitions

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const hasVideo = videoPaths[i] && videoPaths[i] !== "";
        const hasImage = imagePaths[i] && imagePaths[i] !== "";

        if (!hasVideo && !hasImage) {
          // Skip if no visual asset
          currentTime += segment.duration;
          continue;
        }

        const assetPath = hasVideo ? videoPaths[i] : imagePaths[i];
        const mediaType = hasVideo ? "video" : "image";

        const source = project.addSource({
          name: `Scene ${i + 1}`,
          url: assetPath,
          type: mediaType as "video" | "image",
          duration: segment.duration,
        });

        const clip = project.addClip({
          sourceId: source.id,
          trackId: videoTrack.id,
          startTime: currentTime,
          duration: segment.duration,
          sourceStartOffset: 0,
          sourceEndOffset: segment.duration,
        });

        videoClipIds.push(clip.id);
        currentTime += segment.duration;
      }

      // Add fade effects to video clips for smoother scene transitions
      for (let i = 0; i < videoClipIds.length; i++) {
        const clipId = videoClipIds[i];
        const clip = project.getClips().find(c => c.id === clipId);
        if (!clip) continue;

        // Add fadeIn effect (except for first clip)
        if (i > 0) {
          project.addEffect(clipId, {
            type: "fadeIn",
            startTime: 0,
            duration: fadeDuration,
            params: {},
          });
        }

        // Add fadeOut effect (except for last clip)
        if (i < videoClipIds.length - 1) {
          project.addEffect(clipId, {
            type: "fadeOut",
            startTime: clip.duration - fadeDuration,
            duration: fadeDuration,
            params: {},
          });
        }
      }

      // Save project file
      let outputPath = resolve(process.cwd(), options.output);

      // Detect if output looks like a directory (ends with / or no .json extension)
      const looksLikeDirectory =
        options.output.endsWith("/") ||
        (!options.output.endsWith(".json") &&
          !options.output.endsWith(".vibe.json"));

      if (looksLikeDirectory) {
        // Create directory if it doesn't exist
        if (!existsSync(outputPath)) {
          await mkdir(outputPath, { recursive: true });
        }
        outputPath = resolve(outputPath, "project.vibe.json");
      } else if (
        existsSync(outputPath) &&
        (await stat(outputPath)).isDirectory()
      ) {
        // Existing directory without trailing slash
        outputPath = resolve(outputPath, "project.vibe.json");
      } else {
        // File path - ensure parent directory exists
        const parentDir = dirname(outputPath);
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }
      }

      await writeFile(
        outputPath,
        JSON.stringify(project.toJSON(), null, 2),
        "utf-8"
      );

      assembleSpinner.succeed(chalk.green("Project assembled"));

      // Step 6: AI Review (optional)
      if (options.review) {
        const reviewSpinner = ora("Reviewing video with Gemini AI...").start();
        try {
          const reviewTarget = videoPaths.find((p) => p && p !== "");
          if (reviewTarget) {
            const storyboardFile = resolve(effectiveOutputDir, "storyboard.json");
            const reviewResult = await executeReview({
              videoPath: reviewTarget,
              storyboardPath: existsSync(storyboardFile) ? storyboardFile : undefined,
              autoApply: options.reviewAutoApply,
              model: "flash",
            });

            if (reviewResult.success && reviewResult.feedback) {
              reviewSpinner.succeed(chalk.green(`AI Review: ${reviewResult.feedback.overallScore}/10`));
              if (reviewResult.appliedFixes && reviewResult.appliedFixes.length > 0) {
                for (const fix of reviewResult.appliedFixes) {
                  console.log(chalk.green(`  + ${fix}`));
                }
              }
              if (reviewResult.feedback.recommendations.length > 0) {
                for (const rec of reviewResult.feedback.recommendations) {
                  console.log(chalk.dim(`  * ${rec}`));
                }
              }
            } else {
              reviewSpinner.warn(chalk.yellow("AI review completed but no actionable feedback"));
            }
          } else {
            reviewSpinner.warn(chalk.yellow("No videos available for review"));
          }
        } catch {
          reviewSpinner.warn(chalk.yellow("AI review skipped (non-critical error)"));
        }
        console.log();
      }

      // Final summary
      console.log();
      console.log(chalk.bold.green("Script-to-Video complete!"));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📄 Project: ${chalk.cyan(outputPath)}`);
      console.log(`  🎬 Scenes: ${segments.length}`);
      console.log(`  ⏱️  Duration: ${totalDuration}s`);
      console.log(`  📁 Assets: ${effectiveOutputDir}/`);
      if (perSceneTTS.length > 0 || failedNarrations.length > 0) {
        const narrationInfo = `${perSceneTTS.length}/${segments.length}`;
        if (failedNarrations.length > 0) {
          const failedSceneNums = failedNarrations.map((f) => f.sceneNum).join(", ");
          console.log(`  🎙️  Narrations: ${narrationInfo} narration-*.mp3`);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${failedSceneNums}`));
        } else {
          console.log(`  🎙️  Narrations: ${perSceneTTS.length} narration-*.mp3`);
        }
      }
      console.log(`  🖼️  Images: ${successfulImages} scene-*.png`);
      if (!options.imagesOnly) {
        const videoCount = videoPaths.filter((p) => p && p !== "").length;
        console.log(`  🎥 Videos: ${videoCount}/${segments.length} scene-*.mp4`);
        if (failedScenes.length > 0) {
          const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
          console.log(chalk.yellow(`     ⚠ Failed: scene ${uniqueFailedScenes.join(", ")} (fallback to image)`));
        }
      }
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe project info ${options.output}`));
      console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));

      // Show regeneration hint if there were failures
      if (!options.imagesOnly && failedScenes.length > 0) {
        const uniqueFailedScenes = [...new Set(failedScenes)].sort((a, b) => a - b);
        console.log();
        console.log(chalk.dim("💡 To regenerate failed scenes:"));
        for (const sceneNum of uniqueFailedScenes) {
          console.log(chalk.dim(`  vibe ai regenerate-scene ${effectiveOutputDir}/ --scene ${sceneNum} --video-only`));
        }
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Script-to-Video failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Regenerate Scene command
aiCommand
  .command("regenerate-scene")
  .description("Regenerate a specific scene in a script-to-video project")
  .argument("<project-dir>", "Path to the script-to-video output directory")
  .requiredOption("--scene <numbers>", "Scene number(s) to regenerate (1-based), e.g., 3 or 3,4,5")
  .option("--video-only", "Only regenerate video")
  .option("--narration-only", "Only regenerate narration")
  .option("--image-only", "Only regenerate image")
  .option("-g, --generator <engine>", "Video generator: kling | runway", "kling")
  .option("-i, --image-provider <provider>", "Image provider: gemini | openai | stability", "gemini")
  .option("-v, --voice <id>", "ElevenLabs voice ID for narration")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio: 16:9 | 9:16 | 1:1", "16:9")
  .option("--retries <count>", "Number of retries for video generation failures", String(DEFAULT_VIDEO_RETRIES))
  .option("--reference-scene <num>", "Use another scene's image as reference for character consistency")
  .action(async (projectDir: string, options) => {
    try {
      const outputDir = resolve(process.cwd(), projectDir);
      const storyboardPath = resolve(outputDir, "storyboard.json");
      const projectPath = resolve(outputDir, "project.vibe.json");

      // Validate project directory
      if (!existsSync(outputDir)) {
        console.error(chalk.red(`Project directory not found: ${outputDir}`));
        process.exit(1);
      }

      if (!existsSync(storyboardPath)) {
        console.error(chalk.red(`Storyboard not found: ${storyboardPath}`));
        console.error(chalk.dim("This command requires a storyboard.json file from script-to-video output"));
        process.exit(1);
      }

      // Parse scene number(s) - supports "3" or "3,4,5"
      const sceneNums = options.scene.split(",").map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n) && n >= 1);
      if (sceneNums.length === 0) {
        console.error(chalk.red("Scene number must be a positive integer (1-based), e.g., --scene 3 or --scene 3,4,5"));
        process.exit(1);
      }

      // Load storyboard
      const storyboardContent = await readFile(storyboardPath, "utf-8");
      const segments: StoryboardSegment[] = JSON.parse(storyboardContent);

      // Validate all scene numbers
      for (const sceneNum of sceneNums) {
        if (sceneNum > segments.length) {
          console.error(chalk.red(`Scene ${sceneNum} does not exist. Storyboard has ${segments.length} scenes.`));
          process.exit(1);
        }
      }

      // Determine what to regenerate
      const regenerateVideo = options.videoOnly || (!options.narrationOnly && !options.imageOnly);
      const regenerateNarration = options.narrationOnly || (!options.videoOnly && !options.imageOnly);
      const regenerateImage = options.imageOnly || (!options.videoOnly && !options.narrationOnly);

      console.log();
      console.log(chalk.bold.cyan(`🔄 Regenerating Scene${sceneNums.length > 1 ? "s" : ""} ${sceneNums.join(", ")}`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(`  📁 Project: ${outputDir}`);
      console.log(`  🎬 Scenes: ${sceneNums.join(", ")} of ${segments.length}`);
      console.log();

      // Get required API keys (once, before processing scenes)
      let imageApiKey: string | undefined;
      let videoApiKey: string | undefined;
      let elevenlabsApiKey: string | undefined;

      if (regenerateImage) {
        const imageProvider = options.imageProvider || "openai";
        if (imageProvider === "openai" || imageProvider === "dalle") {
          imageApiKey = (await getApiKey("OPENAI_API_KEY", "OpenAI")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("OpenAI API key required for image generation"));
            process.exit(1);
          }
        } else if (imageProvider === "stability") {
          imageApiKey = (await getApiKey("STABILITY_API_KEY", "Stability AI")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("Stability API key required for image generation"));
            process.exit(1);
          }
        } else if (imageProvider === "gemini") {
          imageApiKey = (await getApiKey("GOOGLE_API_KEY", "Google")) ?? undefined;
          if (!imageApiKey) {
            console.error(chalk.red("Google API key required for Gemini image generation"));
            process.exit(1);
          }
        }
      }

      if (regenerateVideo) {
        if (options.generator === "kling") {
          const key = await getApiKey("KLING_API_KEY", "Kling");
          if (!key) {
            console.error(chalk.red("Kling API key required"));
            process.exit(1);
          }
          videoApiKey = key;
        } else {
          const key = await getApiKey("RUNWAY_API_SECRET", "Runway");
          if (!key) {
            console.error(chalk.red("Runway API key required"));
            process.exit(1);
          }
          videoApiKey = key;
        }
      }

      if (regenerateNarration) {
        const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
        if (!key) {
          console.error(chalk.red("ElevenLabs API key required for narration"));
          process.exit(1);
        }
        elevenlabsApiKey = key;
      }

      // Process each scene
      for (const sceneNum of sceneNums) {
        const segment = segments[sceneNum - 1];

        console.log(chalk.cyan(`\n── Scene ${sceneNum} ──`));
        console.log(chalk.dim(`  ${segment.description.slice(0, 50)}...`));

        // Step 1: Regenerate narration if needed
        const narrationPath = resolve(outputDir, `narration-${sceneNum}.mp3`);
        let narrationDuration = segment.duration;

      if (regenerateNarration && elevenlabsApiKey) {
        const ttsSpinner = ora(`🎙️ Regenerating narration for scene ${sceneNum}...`).start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey: elevenlabsApiKey });

        const narrationText = segment.narration || segment.description;

        const ttsResult = await elevenlabs.textToSpeech(narrationText, {
          voiceId: options.voice,
        });

        if (!ttsResult.success || !ttsResult.audioBuffer) {
          ttsSpinner.fail(chalk.red(`Failed to generate narration: ${ttsResult.error || "Unknown error"}`));
          process.exit(1);
        }

        await writeFile(narrationPath, ttsResult.audioBuffer);
        narrationDuration = await getAudioDuration(narrationPath);

        // Update segment duration in storyboard
        segment.duration = narrationDuration;

        ttsSpinner.succeed(chalk.green(`Generated narration (${narrationDuration.toFixed(1)}s)`));
      }

      // Step 2: Regenerate image if needed
      let imagePath = resolve(outputDir, `scene-${sceneNum}.png`);

      if (regenerateImage && imageApiKey) {
        const imageSpinner = ora(`🎨 Regenerating image for scene ${sceneNum}...`).start();

        const imageProvider = options.imageProvider || "gemini";

        // Build prompt with character description for consistency
        const characterDesc = segment.characterDescription || segments[0]?.characterDescription;
        let imagePrompt = segment.visualStyle
          ? `${segment.visuals}. Style: ${segment.visualStyle}`
          : segment.visuals;

        // Add character description to prompt if available
        if (characterDesc) {
          imagePrompt = `${imagePrompt}\n\nIMPORTANT - Character appearance must match exactly: ${characterDesc}`;
        }

        // Check if we should use reference-based generation for character consistency
        const refSceneNum = options.referenceScene ? parseInt(options.referenceScene) : null;
        let referenceImageBuffer: Buffer | undefined;

        if (refSceneNum && refSceneNum >= 1 && refSceneNum <= segments.length && refSceneNum !== sceneNum) {
          const refImagePath = resolve(outputDir, `scene-${refSceneNum}.png`);
          if (existsSync(refImagePath)) {
            referenceImageBuffer = await readFile(refImagePath);
            imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${refSceneNum} as reference)...`;
          }
        } else if (!refSceneNum) {
          // Auto-detect: use the first available scene image as reference
          for (let i = 1; i <= segments.length; i++) {
            if (i !== sceneNum) {
              const otherImagePath = resolve(outputDir, `scene-${i}.png`);
              if (existsSync(otherImagePath)) {
                referenceImageBuffer = await readFile(otherImagePath);
                imageSpinner.text = `🎨 Regenerating image for scene ${sceneNum} (using scene ${i} as reference)...`;
                break;
              }
            }
          }
        }

        // Determine image size/aspect ratio based on provider
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

        let imageBuffer: Buffer | undefined;
        let imageUrl: string | undefined;
        let imageError: string | undefined;

        if (imageProvider === "openai" || imageProvider === "dalle") {
          const openaiImage = new OpenAIImageProvider();
          await openaiImage.initialize({ apiKey: imageApiKey });
          const imageResult = await openaiImage.generateImage(imagePrompt, {
            size: dalleImageSizes[options.aspectRatio] || "1536x1024",
            quality: "standard",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            imageUrl = imageResult.images[0].url;
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "stability") {
          const stability = new StabilityProvider();
          await stability.initialize({ apiKey: imageApiKey });
          const imageResult = await stability.generateImage(imagePrompt, {
            aspectRatio: stabilityAspectRatios[options.aspectRatio] || "16:9",
            model: "sd3.5-large",
          });
          if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
            const img = imageResult.images[0];
            if (img.base64) {
              imageBuffer = Buffer.from(img.base64, "base64");
            } else if (img.url) {
              imageUrl = img.url;
            }
          } else {
            imageError = imageResult.error;
          }
        } else if (imageProvider === "gemini") {
          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey: imageApiKey });

          // Use editImage with reference for character consistency
          if (referenceImageBuffer) {
            // Extract the main action from the scene description (take first action if multiple)
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
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          } else {
            // No reference image, use regular generation
            const imageResult = await gemini.generateImage(imagePrompt, {
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
            });
            if (imageResult.success && imageResult.images && imageResult.images.length > 0) {
              const img = imageResult.images[0];
              if (img.base64) {
                imageBuffer = Buffer.from(img.base64, "base64");
              }
            } else {
              imageError = imageResult.error;
            }
          }
        }

        if (imageBuffer) {
          await writeFile(imagePath, imageBuffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else if (imageUrl) {
          const response = await fetch(imageUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(imagePath, buffer);
          imageSpinner.succeed(chalk.green("Generated image"));
        } else {
          const errorMsg = imageError || "Unknown error";
          imageSpinner.fail(chalk.red(`Failed to generate image: ${errorMsg}`));
          process.exit(1);
        }
      }

      // Step 3: Regenerate video if needed
      let videoPath = resolve(outputDir, `scene-${sceneNum}.mp4`);

      if (regenerateVideo && videoApiKey) {
        const videoSpinner = ora(`🎬 Regenerating video for scene ${sceneNum}...`).start();

        // Check if image exists
        if (!existsSync(imagePath)) {
          videoSpinner.fail(chalk.red(`Reference image not found: ${imagePath}`));
          console.error(chalk.dim("Generate an image first with --image-only or regenerate all assets"));
          process.exit(1);
        }

        const imageBuffer = await readFile(imagePath);
        const ext = extname(imagePath).toLowerCase().slice(1);
        const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        const referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

        const videoDuration = (segment.duration > 5 ? 10 : 5) as 5 | 10;
        const maxRetries = parseInt(options.retries) || DEFAULT_VIDEO_RETRIES;

        let videoGenerated = false;

        if (options.generator === "kling") {
          const kling = new KlingProvider();
          await kling.initialize({ apiKey: videoApiKey });

          if (!kling.isConfigured()) {
            videoSpinner.fail(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
            process.exit(1);
          }

          // Try to use image-to-video if ImgBB API key is available
          const imgbbApiKey = await getApiKeyFromConfig("imgbb") || process.env.IMGBB_API_KEY;
          let imageUrl: string | undefined;

          if (imgbbApiKey) {
            videoSpinner.text = `🎬 Uploading image to ImgBB...`;
            const uploadResult = await uploadToImgbb(imageBuffer, imgbbApiKey);
            if (uploadResult.success && uploadResult.url) {
              imageUrl = uploadResult.url;
              videoSpinner.text = `🎬 Starting image-to-video generation...`;
            } else {
              console.log(chalk.yellow(`\n  ⚠ ImgBB upload failed, falling back to text-to-video`));
            }
          }

          const result = await generateVideoWithRetryKling(
            kling,
            segment,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio as "16:9" | "9:16" | "1:1",
              referenceImage: imageUrl, // Use uploaded URL for image-to-video
            },
            maxRetries
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await kling.waitForCompletion(
                  result.taskId,
                  result.type,
                  (status) => {
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${status.status}...`;
                  },
                  600000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const response = await fetch(waitResult.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    kling,
                    videoId: waitResult.videoId,
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        } else {
          // Runway
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey: videoApiKey });

          const result = await generateVideoWithRetryRunway(
            runway,
            segment,
            referenceImage,
            {
              duration: videoDuration,
              aspectRatio: options.aspectRatio === "1:1" ? "16:9" : (options.aspectRatio as "16:9" | "9:16"),
            },
            maxRetries,
            (msg) => {
              videoSpinner.text = `🎬 Scene ${sceneNum}: ${msg}`;
            }
          );

          if (result) {
            videoSpinner.text = `🎬 Waiting for video to complete...`;

            for (let attempt = 0; attempt <= maxRetries && !videoGenerated; attempt++) {
              try {
                const waitResult = await runway.waitForCompletion(
                  result.taskId,
                  (status) => {
                    const progress = status.progress !== undefined ? `${status.progress}%` : status.status;
                    videoSpinner.text = `🎬 Scene ${sceneNum}: ${progress}...`;
                  },
                  300000
                );

                if (waitResult.status === "completed" && waitResult.videoUrl) {
                  const response = await fetch(waitResult.videoUrl);
                  const buffer = Buffer.from(await response.arrayBuffer());
                  await writeFile(videoPath, buffer);

                  // Extend video to match narration duration if needed (Runway - no Kling extend)
                  await extendVideoToTarget(videoPath, segment.duration, outputDir, `Scene ${sceneNum}`, {
                    onProgress: (msg) => { videoSpinner.text = `🎬 ${msg}`; },
                  });

                  videoGenerated = true;
                } else if (attempt < maxRetries) {
                  videoSpinner.text = `🎬 Scene ${sceneNum}: Retry ${attempt + 1}/${maxRetries}...`;
                  await sleep(RETRY_DELAY_MS);
                }
              } catch (err) {
                if (attempt >= maxRetries) {
                  throw err;
                }
                videoSpinner.text = `🎬 Scene ${sceneNum}: Error, retry ${attempt + 1}/${maxRetries}...`;
                await sleep(RETRY_DELAY_MS);
              }
            }
          }
        }

        if (videoGenerated) {
          videoSpinner.succeed(chalk.green("Generated video"));
        } else {
          videoSpinner.fail(chalk.red("Failed to generate video after all retries"));
          process.exit(1);
        }
      }

      // Step 4: Recalculate startTime for ALL segments and re-save storyboard
      {
        let currentTime = 0;
        for (const seg of segments) {
          seg.startTime = currentTime;
          currentTime += seg.duration;
        }
        await writeFile(storyboardPath, JSON.stringify(segments, null, 2), "utf-8");
        console.log(chalk.dim(`  → Updated storyboard: ${storyboardPath}`));
      }

      // Step 5: Update project.vibe.json if it exists — update ALL clips' startTime/duration
      if (existsSync(projectPath)) {
        const updateSpinner = ora("📦 Updating project file...").start();

        try {
          const projectContent = await readFile(projectPath, "utf-8");
          const projectData = JSON.parse(projectContent) as ProjectFile;

          // Find and update the source for this scene
          const sceneName = `Scene ${sceneNum}`;
          const narrationName = `Narration ${sceneNum}`;

          // Update video/image source
          const videoSource = projectData.state.sources.find((s) => s.name === sceneName);
          if (videoSource) {
            const hasVideo = existsSync(videoPath);
            videoSource.url = hasVideo ? videoPath : imagePath;
            videoSource.type = hasVideo ? "video" : "image";
            videoSource.duration = segment.duration;
          }

          // Update narration source
          const narrationSource = projectData.state.sources.find((s) => s.name === narrationName);
          if (narrationSource && regenerateNarration) {
            narrationSource.duration = narrationDuration;
          }

          // Update ALL clips' startTime and duration based on recalculated segments
          for (const clip of projectData.state.clips) {
            const source = projectData.state.sources.find((s) => s.id === clip.sourceId);
            if (!source) continue;

            // Match source name to segment (e.g., "Scene 1" → segment 0, "Narration 2" → segment 1)
            const sceneMatch = source.name.match(/^Scene (\d+)$/);
            const narrationMatch = source.name.match(/^Narration (\d+)$/);
            const segIdx = sceneMatch ? parseInt(sceneMatch[1]) - 1 : narrationMatch ? parseInt(narrationMatch[1]) - 1 : -1;

            if (segIdx >= 0 && segIdx < segments.length) {
              const seg = segments[segIdx];
              clip.startTime = seg.startTime;
              clip.duration = seg.duration;
              clip.sourceEndOffset = seg.duration;
              // Also update the source duration to match segment
              source.duration = seg.duration;
            }
          }

          await writeFile(projectPath, JSON.stringify(projectData, null, 2), "utf-8");
          updateSpinner.succeed(chalk.green("Updated project file (all clips synced)"));
        } catch (err) {
          updateSpinner.warn(chalk.yellow(`Could not update project file: ${err}`));
        }
      }

        console.log(chalk.green(`  ✓ Scene ${sceneNum} done`));
      } // End of for loop over sceneNums

      // Final summary
      console.log();
      console.log(chalk.bold.green(`✅ ${sceneNums.length} scene${sceneNums.length > 1 ? "s" : ""} regenerated successfully!`));
      console.log(chalk.dim("─".repeat(60)));
      console.log();
      console.log(chalk.dim("Next steps:"));
      console.log(chalk.dim(`  vibe export ${outputDir}/ -o final.mp4`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Scene regeneration failed"));
      console.error(error);
      process.exit(1);
    }
  });

}
