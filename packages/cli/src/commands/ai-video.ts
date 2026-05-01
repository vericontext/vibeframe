/**
 * @module ai-video
 * @description Library functions for video generation, status, cancel, and
 * extension. Powers the manifest tools `generate_video`,
 * `generate_video_status`, `generate_video_cancel`, `generate_video_extend`
 * (the user reaches these via `vibe generate video[-...]`).
 *
 * The legacy `vibe ai video / video-status / video-cancel / kling / kling-status /
 * video-extend` Commander registrations were removed alongside the dead
 * `commands/ai.ts` orchestrator (the `vibe ai *` namespace was never
 * `addCommand`'d to `program`).
 *
 * @see MODELS.md for AI model configuration
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FalProvider,
  GeminiProvider,
  GrokProvider,
  KlingProvider,
  RunwayProvider,
} from "@vibeframe/ai-providers";
import { resolveUploadHost } from "../utils/upload-host.js";
import { downloadVideo } from "./ai-helpers.js";
import { hasApiKey } from "../utils/api-key.js";

// ============================================================================
// Video Generation
// ============================================================================

export interface VideoGenerateOptions {
  prompt: string;
  provider?: "grok" | "runway" | "kling" | "veo" | "seedance" | "fal";
  image?: string;
  duration?: number;
  ratio?: string;
  seed?: number;
  mode?: string;
  negative?: string;
  resolution?: string;
  veoModel?: string;
  runwayModel?: string;
  seedanceModel?: string;
  output?: string;
  wait?: boolean;
  apiKey?: string;
}

export interface VideoGenerateResult {
  success: boolean;
  taskId?: string;
  status?: string;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  provider?: string;
  error?: string;
}

export async function executeVideoGenerate(
  options: VideoGenerateOptions
): Promise<VideoGenerateResult> {
  const {
    prompt,
    provider = "kling",
    image,
    duration = 5,
    ratio = "16:9",
    seed,
    mode = "std",
    negative,
    resolution,
    veoModel = "3.1-fast",
    seedanceModel = "quality",
    output,
    wait = true,
    apiKey,
  } = options;

  try {
    const envKeyMap: Record<string, string> = {
      grok: "XAI_API_KEY",
      runway: "RUNWAY_API_SECRET",
      kling: "KLING_API_KEY",
      veo: "GOOGLE_API_KEY",
      seedance: "FAL_API_KEY",
      fal: "FAL_API_KEY",
    };
    const envKey = envKeyMap[provider] || "";
    const key = apiKey || (hasApiKey(envKey) ? process.env[envKey] : undefined);
    if (!key) return { success: false, error: `${envKeyMap[provider]} required for ${provider}` };

    let referenceImage: string | undefined;
    let referenceImageBuffer: Buffer | undefined;
    let referenceImageMimeType: string | undefined;
    if (image) {
      const imagePath = resolve(process.cwd(), image);
      const imageBuffer = await readFile(imagePath);
      const ext = image.toLowerCase().split(".").pop();
      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
      };
      const mimeType = mimeTypes[ext || "png"] || "image/png";
      referenceImageBuffer = imageBuffer;
      referenceImageMimeType = mimeType;
      referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    }

    if (provider === "seedance" || provider === "fal") {
      const fal = new FalProvider();
      await fal.initialize({ apiKey: key });

      let falImage = referenceImage;
      if (falImage && falImage.startsWith("data:")) {
        const uploadHost = await resolveUploadHost();
        const upload = await uploadHost.uploadImage(referenceImageBuffer!, {
          filename: image,
          mimeType: referenceImageMimeType,
        });
        falImage = upload.url;
      }

      const model =
        seedanceModel === "fast" || seedanceModel === "seedance-2.0-fast"
          ? "seedance-2.0-fast"
          : "seedance-2.0";
      const result = await fal.generateVideo(prompt, {
        prompt,
        referenceImage: falImage,
        duration,
        aspectRatio: ratio as "16:9" | "9:16" | "1:1" | "4:5",
        negativePrompt: negative,
        model,
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Seedance generation failed" };

      let outputPath: string | undefined;
      if (output && result.videoUrl) {
        const buffer = await downloadVideo(result.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: result.videoUrl,
        outputPath,
        provider: "seedance",
      };
    } else if (provider === "runway") {
      const runway = new RunwayProvider();
      await runway.initialize({ apiKey: key });

      const result = await runway.generateVideo(prompt, {
        prompt,
        referenceImage,
        duration: duration as 5 | 10,
        aspectRatio: ratio as "16:9" | "9:16",
        seed,
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Runway generation failed" };
      if (!wait)
        return { success: true, taskId: result.id, status: "processing", provider: "runway" };

      const finalResult = await runway.waitForCompletion(result.id, () => {}, 300000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Runway generation failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        duration: finalResult.duration,
        outputPath,
        provider: "runway",
      };
    } else if (provider === "kling") {
      const kling = new KlingProvider();
      await kling.initialize({ apiKey: key });
      if (!kling.isConfigured()) return { success: false, error: "Invalid Kling API key format" };

      let klingImage = referenceImage;
      if (klingImage && klingImage.startsWith("data:")) {
        const uploadHost = await resolveUploadHost();
        const upload = await uploadHost.uploadImage(referenceImageBuffer!, {
          filename: image,
          mimeType: referenceImageMimeType,
        });
        klingImage = upload.url;
      }

      const result = await kling.generateVideo(prompt, {
        prompt,
        referenceImage: klingImage,
        duration: duration as 5 | 10,
        aspectRatio: ratio as "16:9" | "9:16" | "1:1",
        negativePrompt: negative,
        mode: mode as "std" | "pro",
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Kling generation failed" };
      const taskType = referenceImage ? "image2video" : "text2video";
      if (!wait)
        return { success: true, taskId: result.id, status: "processing", provider: "kling" };

      const finalResult = await kling.waitForCompletion(result.id, taskType, () => {}, 600000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Kling generation failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        duration: finalResult.duration,
        outputPath,
        provider: "kling",
      };
    } else if (provider === "veo") {
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: key });

      const veoModelMap: Record<string, string> = {
        "3.0": "veo-3.0-generate-preview",
        "3.1": "veo-3.1-generate-preview",
        "3.1-fast": "veo-3.1-fast-generate-preview",
      };
      const model = veoModelMap[veoModel] || "veo-3.1-fast-generate-preview";
      const veoDuration = duration <= 6 ? 6 : 8;

      const result = await gemini.generateVideo(prompt, {
        prompt,
        referenceImage,
        duration: veoDuration,
        aspectRatio: ratio as "16:9" | "9:16" | "1:1",
        model: model as
          | "veo-3.0-generate-preview"
          | "veo-3.1-generate-preview"
          | "veo-3.1-fast-generate-preview",
        negativePrompt: negative,
        resolution: resolution as "720p" | "1080p" | "4k" | undefined,
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Veo generation failed" };
      if (!wait) return { success: true, taskId: result.id, status: "processing", provider: "veo" };

      const finalResult = await gemini.waitForVideoCompletion(result.id, () => {}, 300000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Veo generation failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        outputPath,
        provider: "veo",
      };
    } else if (provider === "grok") {
      const grok = new GrokProvider();
      await grok.initialize({ apiKey: key });

      const result = await grok.generateVideo(prompt, {
        prompt,
        referenceImage,
        duration,
        aspectRatio: ratio as "16:9" | "9:16" | "1:1",
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Grok generation failed" };
      if (!wait)
        return { success: true, taskId: result.id, status: "processing", provider: "grok" };

      const finalResult = await grok.waitForCompletion(result.id, () => {}, 300000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Grok generation failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        duration: finalResult.duration,
        outputPath,
        provider: "grok",
      };
    }

    return { success: false, error: `Unsupported provider: ${provider}` };
  } catch (error) {
    return {
      success: false,
      error: `Video generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Video Status (Runway / Kling)
// ============================================================================

export interface VideoStatusOptions {
  taskId: string;
  provider?: "runway" | "kling";
  taskType?: "text2video" | "image2video";
  wait?: boolean;
  output?: string;
  apiKey?: string;
}

export interface VideoStatusResult {
  success: boolean;
  taskId?: string;
  status?: string;
  progress?: number;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  error?: string;
}

export async function executeVideoStatus(options: VideoStatusOptions): Promise<VideoStatusResult> {
  const {
    taskId,
    provider = "runway",
    taskType = "text2video",
    wait = false,
    output,
    apiKey,
  } = options;

  try {
    const envKeyMap: Record<string, string> = {
      runway: "RUNWAY_API_SECRET",
      kling: "KLING_API_KEY",
    };
    const key = apiKey || process.env[envKeyMap[provider] || ""];
    if (!key) return { success: false, error: `${envKeyMap[provider]} required` };

    if (provider === "runway") {
      const runway = new RunwayProvider();
      await runway.initialize({ apiKey: key });

      let result = await runway.getGenerationStatus(taskId);

      if (
        wait &&
        result.status !== "completed" &&
        result.status !== "failed" &&
        result.status !== "cancelled"
      ) {
        result = await runway.waitForCompletion(taskId, () => {});
      }

      let outputPath: string | undefined;
      if (output && result.videoUrl) {
        const buffer = await downloadVideo(result.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId,
        status: result.status,
        progress: result.progress,
        videoUrl: result.videoUrl,
        outputPath,
      };
    } else if (provider === "kling") {
      const kling = new KlingProvider();
      await kling.initialize({ apiKey: key });

      let result = await kling.getGenerationStatus(taskId, taskType);

      if (
        wait &&
        result.status !== "completed" &&
        result.status !== "failed" &&
        result.status !== "cancelled"
      ) {
        result = await kling.waitForCompletion(taskId, taskType, () => {});
      }

      let outputPath: string | undefined;
      if (output && result.videoUrl) {
        const buffer = await downloadVideo(result.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId,
        status: result.status,
        videoUrl: result.videoUrl,
        duration: result.duration,
        outputPath,
      };
    }

    return { success: false, error: `Unsupported provider: ${provider}` };
  } catch (error) {
    return {
      success: false,
      error: `Status check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Video Cancel (Runway)
// ============================================================================

export interface VideoCancelOptions {
  taskId: string;
  apiKey?: string;
}

export interface VideoCancelResult {
  success: boolean;
  error?: string;
}

export async function executeVideoCancel(options: VideoCancelOptions): Promise<VideoCancelResult> {
  const { taskId, apiKey } = options;

  try {
    const key = apiKey || process.env.RUNWAY_API_SECRET;
    if (!key) return { success: false, error: "RUNWAY_API_SECRET required" };

    const runway = new RunwayProvider();
    await runway.initialize({ apiKey: key });

    const success = await runway.cancelGeneration(taskId);
    return { success };
  } catch (error) {
    return {
      success: false,
      error: `Cancel failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Video Extend (Kling / Veo)
// ============================================================================

export interface VideoExtendOptions {
  videoId: string;
  provider?: "kling" | "veo";
  prompt?: string;
  duration?: number;
  negative?: string;
  veoModel?: string;
  output?: string;
  wait?: boolean;
  apiKey?: string;
}

export interface VideoExtendResult {
  success: boolean;
  taskId?: string;
  status?: string;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  error?: string;
}

export async function executeVideoExtend(options: VideoExtendOptions): Promise<VideoExtendResult> {
  const {
    videoId,
    provider = "kling",
    prompt,
    duration = 5,
    negative,
    veoModel = "3.1",
    output,
    wait = true,
    apiKey,
  } = options;

  try {
    if (provider === "kling") {
      const key = apiKey || process.env.KLING_API_KEY;
      if (!key) return { success: false, error: "KLING_API_KEY required" };

      const kling = new KlingProvider();
      await kling.initialize({ apiKey: key });
      if (!kling.isConfigured()) return { success: false, error: "Invalid Kling API key format" };

      const result = await kling.extendVideo(videoId, {
        prompt,
        negativePrompt: negative,
        duration: String(duration) as "5" | "10",
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Kling extension failed" };
      if (!wait) return { success: true, taskId: result.id, status: "processing" };

      const finalResult = await kling.waitForExtendCompletion(result.id, () => {}, 600000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Kling extension failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        duration: finalResult.duration,
        outputPath,
      };
    } else if (provider === "veo") {
      const key = apiKey || process.env.GOOGLE_API_KEY;
      if (!key) return { success: false, error: "GOOGLE_API_KEY required" };

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: key });

      const veoModelMap: Record<string, string> = {
        "3.0": "veo-3.0-generate-preview",
        "3.1": "veo-3.1-generate-preview",
        "3.1-fast": "veo-3.1-fast-generate-preview",
      };
      const model = veoModelMap[veoModel] || "veo-3.1-generate-preview";

      const result = await gemini.extendVideo(videoId, prompt, {
        duration: duration as 4 | 6 | 8,
        model: model as
          | "veo-3.0-generate-preview"
          | "veo-3.1-generate-preview"
          | "veo-3.1-fast-generate-preview",
      });

      if (result.status === "failed")
        return { success: false, error: result.error || "Veo extension failed" };
      if (!wait) return { success: true, taskId: result.id, status: "processing" };

      const finalResult = await gemini.waitForVideoCompletion(result.id, () => {}, 300000);
      if (finalResult.status !== "completed")
        return { success: false, error: finalResult.error || "Veo extension failed" };

      let outputPath: string | undefined;
      if (output && finalResult.videoUrl) {
        const buffer = await downloadVideo(finalResult.videoUrl, key);
        outputPath = resolve(process.cwd(), output);
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        taskId: result.id,
        status: "completed",
        videoUrl: finalResult.videoUrl,
        outputPath,
      };
    }

    return { success: false, error: `Unsupported provider: ${provider}` };
  } catch (error) {
    return {
      success: false,
      error: `Video extension failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
