/**
 * @module _shared/video-providers
 * @description Per-provider `generateVideoWithRetry*` helpers used by the
 * script-to-video pipeline. Each wraps a single AI provider's video
 * generation API in a retry loop with onProgress callbacks. Split out of
 * `ai-script-pipeline.ts` in v0.69 (Plan G Phase 4).
 */

import chalk from "chalk";
import type {
  GeminiProvider,
  GrokProvider,
  KlingProvider,
  RunwayProvider,
} from "@vibeframe/ai-providers";
import { sleep, RETRY_DELAY_MS, type StoryboardSegment } from "./video-utils.js";

/** Generate video with retry logic for Grok provider. */
export async function generateVideoWithRetryGrok(
  grok: GrokProvider,
  segment: StoryboardSegment,
  options: {
    duration: number;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string;
  },
  maxRetries: number,
  onProgress?: (message: string) => void,
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

      const providerErr = result.error || "Grok returned failed status";
      if (attempt < maxRetries) {
        onProgress?.(
          `⚠ ${providerErr.slice(0, 50)}... retry ${attempt + 1}/${maxRetries}`,
        );
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
 * Generate video with retry logic for Kling provider.
 * Supports image-to-video with URL (v2.5/v2.6 models).
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
  onProgress?: (message: string) => void,
): Promise<{ taskId: string; type: "text2video" | "image2video" } | null> {
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
        mode: "std", // std mode for faster generation
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

/** Generate video with retry logic for Runway provider. */
export async function generateVideoWithRetryRunway(
  runway: RunwayProvider,
  segment: StoryboardSegment,
  referenceImage: string,
  options: {
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16";
  },
  maxRetries: number,
  onProgress?: (message: string) => void,
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

/** Generate video with retry logic for Veo (Gemini) provider. */
export async function generateVideoWithRetryVeo(
  gemini: GeminiProvider,
  segment: StoryboardSegment,
  options: {
    duration: 4 | 6 | 8;
    aspectRatio: "16:9" | "9:16" | "1:1";
    referenceImage?: string;
  },
  maxRetries: number,
  onProgress?: (message: string) => void,
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
