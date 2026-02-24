import type { Clip } from "@vibeframe/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
  EditSuggestion,
} from "../interface/types.js";

import {
  generateMotion as generateMotionImpl,
  refineMotion as refineMotionImpl,
  GEMINI_MOTION_MODELS,
} from "./gemini-motion.js";
import type { GeminiMotionOptions, GeminiMotionResult } from "./gemini-motion.js";
import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { analyzeContent as analyzeContentImpl } from "./gemini-storyboard.js";

/**
 * Gemini model types for image generation
 */
export type GeminiImageModel = "flash" | "pro" | "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";

/**
 * Image resolution (Pro model only)
 */
export type GeminiImageResolution = "1K" | "2K" | "4K";

/**
 * Image generation options for Gemini (Nano Banana)
 */
export interface GeminiImageOptions {
  /** Model to use: flash (fast) or pro (professional) */
  model?: GeminiImageModel;
  /** Aspect ratio */
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
  /** Image resolution: 1K, 2K, 4K (Pro model only) */
  resolution?: GeminiImageResolution;
  /** Enable Google Search grounding (Pro model only) */
  grounding?: boolean;
  /** Safety filter level */
  safetyFilterLevel?: "block_low_and_above" | "block_medium_and_above" | "block_only_high";
  /** Person generation setting */
  personGeneration?: "dont_allow" | "allow_adult";
}

/**
 * Image editing options for Gemini
 */
export interface GeminiEditOptions {
  /** Model to use: flash (max 3 images) or pro (max 14 images) */
  model?: GeminiImageModel;
  /** Output aspect ratio */
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
  /** Image resolution: 1K, 2K, 4K (Pro model only) */
  resolution?: GeminiImageResolution;
}

/**
 * Image generation result
 */
export interface GeminiImageResult {
  success: boolean;
  images?: Array<{
    base64: string;
    mimeType: string;
  }>;
  description?: string;
  model?: string;
  error?: string;
}

/**
 * Veo model versions for video generation
 * - veo-3.0: Veo 3 (native audio, 4K)
 * - veo-3.1: Veo 3.1 Standard ($0.40/sec)
 * - veo-3.1-fast: Veo 3.1 Fast ($0.15/sec)
 */
export type VeoModel =
  | "veo-3.0-generate-preview"
  | "veo-3.1-generate-preview"
  | "veo-3.1-fast-generate-preview";

/**
 * Veo video generation options
 */
export interface VeoVideoOptions {
  /** Model to use */
  model?: VeoModel;
  /** Duration in seconds (4, 6, or 8) */
  duration?: 4 | 6 | 8;
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Reference image URL or base64 for image-to-video */
  referenceImage?: string;
}

/**
 * Video analysis options for Gemini
 */
export interface GeminiVideoOptions {
  /** Model to use for analysis */
  model?: "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro";
  /** MIME type of the video (for inline data) */
  mimeType?: string;
  /** Frames per second to sample (default: 1) */
  fps?: number;
  /** Start offset in seconds for clipping */
  startOffset?: number;
  /** End offset in seconds for clipping */
  endOffset?: number;
  /** Use low resolution mode (fewer tokens) */
  lowResolution?: boolean;
}

/**
 * Video analysis result
 */
export interface GeminiVideoResult {
  success: boolean;
  response?: string;
  model?: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  error?: string;
}

/**
 * Image analysis options for Gemini vision
 */
export interface GeminiImageAnalysisOptions {
  /** Model to use for analysis */
  model?: "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro";
  /** Use low resolution mode (fewer tokens) */
  lowResolution?: boolean;
}

/**
 * Image analysis result
 */
export interface GeminiImageAnalysisResult {
  success: boolean;
  response?: string;
  model?: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  error?: string;
}

const MODEL_MAP: Record<string, string> = {
  "flash": "gemini-2.5-flash-image",
  "pro": "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
};

/**
 * Google Gemini provider for AI video generation, image generation, and editing
 * - Video: Veo 3.1 Fast / Veo 3.1 (text-to-video, image-to-video)
 * - Image: Nano Banana (gemini-2.5-flash-image) / Nano Banana Pro (gemini-3-pro-image-preview)
 */
export class GeminiProvider implements AIProvider {
  id = "gemini";
  name = "Google Gemini";
  description = "AI video (Veo 3.1) and image (Nano Banana) generation";
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "text-to-image", "auto-edit", "vision"];
  iconUrl = "/icons/gemini.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate video using Google Veo 3.1
   * Supports text-to-video and image-to-video
   */
  async generateVideo(
    prompt: string,
    options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Gemini API key not configured",
      };
    }

    try {
      // Default to Veo 3.1 Fast for better speed/cost ratio
      const model = (options?.model as VeoModel) || "veo-3.1-fast-generate-preview";

      // Map aspect ratio
      const aspectRatioMap: Record<string, string> = {
        "16:9": "16:9",
        "9:16": "9:16",
        "1:1": "1:1",
      };

      const requestBody: Record<string, unknown> = {
        instances: [{
          prompt,
        }],
        parameters: {
          aspectRatio: aspectRatioMap[options?.aspectRatio || "16:9"] || "16:9",
          durationSeconds: Math.max(4, Math.min(8, options?.duration || 8)),
        },
      };

      // Add reference image for image-to-video
      if (options?.referenceImage) {
        const imageData = options.referenceImage as string;
        if (imageData.startsWith("data:")) {
          // Extract base64 from data URI
          const base64 = imageData.split(",")[1];
          const mimeType = imageData.split(";")[0].split(":")[1];
          (requestBody.instances as Array<Record<string, unknown>>)[0].image = {
            bytesBase64Encoded: base64,
            mimeType,
          };
        } else if (imageData.startsWith("http")) {
          (requestBody.instances as Array<Record<string, unknown>>)[0].image = {
            gcsUri: imageData,
          };
        }
      }

      const response = await fetch(
        `${this.baseUrl}/models/${model}:predictLongRunning`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id: "",
          status: "failed",
          error: `Veo API error (${response.status}): ${errorText}`,
        };
      }

      const data = await response.json() as {
        name?: string;
        done?: boolean;
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{
              video?: { uri?: string };
            }>;
          };
          // Legacy format fallback
          generatedVideos?: Array<{
            video?: { uri?: string };
          }>;
        };
        error?: { message: string };
      };

      // Veo uses long-running operations
      if (data.name) {
        return {
          id: data.name,
          status: "pending",
          progress: 0,
        };
      }

      // Immediate response (unlikely for video)
      const immediateUri =
        data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        data.response?.generatedVideos?.[0]?.video?.uri;
      if (immediateUri) {
        return {
          id: crypto.randomUUID(),
          status: "completed",
          videoUrl: immediateUri,
        };
      }

      return {
        id: "",
        status: "failed",
        error: data.error?.message || "Unknown Veo error",
      };
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get status of Veo video generation operation
   */
  async getGenerationStatus(operationName: string): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: operationName,
        status: "failed",
        error: "Gemini API key not configured",
      };
    }

    try {
      // Poll the operation status
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${this.apiKey}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id: operationName,
          status: "failed",
          error: `Status check failed (${response.status}): ${errorText}`,
        };
      }

      const data = await response.json() as {
        name: string;
        done?: boolean;
        metadata?: {
          "@type": string;
        };
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{
              video?: { uri?: string };
            }>;
          };
          // Legacy format fallback
          generatedVideos?: Array<{
            video?: { uri?: string };
          }>;
        };
        error?: {
          code: number;
          message: string;
        };
      };

      if (data.error) {
        return {
          id: operationName,
          status: "failed",
          error: data.error.message,
        };
      }

      // Try new format first, then legacy
      const videoUri =
        data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        data.response?.generatedVideos?.[0]?.video?.uri;

      if (data.done && videoUri) {
        return {
          id: operationName,
          status: "completed",
          videoUrl: videoUri,
        };
      }

      if (data.done) {
        // Log the raw response for debugging
        const rawResponse = JSON.stringify(data.response || {}).slice(0, 500);
        return {
          id: operationName,
          status: "failed",
          error: `Generation completed but no video URL found in response: ${rawResponse}`,
        };
      }

      return {
        id: operationName,
        status: "processing",
        progress: 50,
      };
    } catch (error) {
      return {
        id: operationName,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for Veo video generation to complete with polling
   */
  async waitForVideoCompletion(
    operationName: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 300000 // 5 minutes default
  ): Promise<VideoResult> {
    const startTime = Date.now();
    const pollingInterval = 5000; // 5 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getGenerationStatus(operationName);

      if (onProgress) {
        onProgress(result);
      }

      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        return result;
      }

      await this.sleep(pollingInterval);
    }

    return {
      id: operationName,
      status: "failed",
      error: "Generation timed out",
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cancelGeneration(_id: string): Promise<boolean> {
    // Veo operations cannot be cancelled
    return false;
  }

  /**
   * Resolve model alias to full model ID
   */
  private resolveModel(model?: GeminiImageModel): string {
    if (!model) return MODEL_MAP["flash"];
    return MODEL_MAP[model] || MODEL_MAP["flash"];
  }

  /**
   * Check if model is Pro
   */
  private isProModel(modelId: string): boolean {
    return modelId.includes("pro");
  }

  /**
   * Generate images using Gemini (Nano Banana)
   * Uses generateContent with responseModalities: ["TEXT", "IMAGE"]
   */
  async generateImage(
    prompt: string,
    options: GeminiImageOptions = {}
  ): Promise<GeminiImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    try {
      const modelId = this.resolveModel(options.model);
      const isPro = this.isProModel(modelId);

      // Build image config
      const imageConfig: Record<string, string> = {};
      if (options.aspectRatio) {
        imageConfig.aspectRatio = options.aspectRatio;
      } else {
        imageConfig.aspectRatio = "1:1";
      }

      // Resolution is only for Pro model
      if (options.resolution && isPro) {
        imageConfig.imageSize = options.resolution;
      }

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig,
      };

      // Build payload
      const payload: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
      };

      // Add Google Search grounding (Pro only)
      if (options.grounding && isPro) {
        payload.tools = [{ googleSearch: {} }];
      }

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
              inlineData?: {
                mimeType: string;
                data: string;
              };
            }>;
          };
        }>;
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No content in response",
        };
      }

      // Extract images from parts (skip thought images from Pro model)
      const images: Array<{ base64: string; mimeType: string }> = [];
      let description: string | undefined;

      for (const part of parts) {
        // Skip thought images (Pro model thinking process)
        if (part.thought) continue;

        if (part.inlineData) {
          images.push({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        } else if (part.text) {
          description = part.text;
        }
      }

      if (images.length === 0) {
        return {
          success: false,
          error: "No images in response",
        };
      }

      return {
        success: true,
        images,
        description,
        model: modelId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Edit image(s) using Gemini (Nano Banana)
   * Provide input image(s) with a text prompt to edit/transform/compose
   */
  async editImage(
    imageBuffers: Buffer[],
    prompt: string,
    options: GeminiEditOptions = {}
  ): Promise<GeminiImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    const modelId = this.resolveModel(options.model);
    const isPro = this.isProModel(modelId);

    // Validate image count
    const maxImages = isPro ? 14 : 3;
    if (imageBuffers.length > maxImages) {
      return {
        success: false,
        error: `Too many input images. ${modelId} supports up to ${maxImages} images.`,
      };
    }

    try {
      // Build parts: text prompt first, then images
      const parts: Array<Record<string, unknown>> = [{ text: prompt }];

      for (const buffer of imageBuffers) {
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: buffer.toString("base64"),
          },
        });
      }

      // Build image config
      const imageConfig: Record<string, string> = {};
      if (options.aspectRatio) {
        imageConfig.aspectRatio = options.aspectRatio;
      }
      if (options.resolution && isPro) {
        imageConfig.imageSize = options.resolution;
      }

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        responseModalities: ["TEXT", "IMAGE"],
      };
      if (Object.keys(imageConfig).length > 0) {
        generationConfig.imageConfig = imageConfig;
      }

      const payload = {
        contents: [{ parts }],
        generationConfig,
      };

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
              inlineData?: {
                mimeType: string;
                data: string;
              };
            }>;
          };
        }>;
      };

      const responseParts = data.candidates?.[0]?.content?.parts;
      if (!responseParts || responseParts.length === 0) {
        return {
          success: false,
          error: "No content in response",
        };
      }

      // Extract images (skip thought images)
      const images: Array<{ base64: string; mimeType: string }> = [];
      let description: string | undefined;

      for (const part of responseParts) {
        if (part.thought) continue;

        if (part.inlineData) {
          images.push({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        } else if (part.text) {
          description = part.text;
        }
      }

      if (images.length === 0) {
        return {
          success: false,
          error: "No images in response",
        };
      }

      return {
        success: true,
        images,
        description,
        model: modelId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

/**
   * Video analysis options
   */
  async analyzeVideo(
    videoData: Buffer | string,
    prompt: string,
    options: GeminiVideoOptions = {}
  ): Promise<GeminiVideoResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    const modelId = options.model || "gemini-3-flash-preview";

    try {
      // Build the video part
      let videoPart: Record<string, unknown>;

      if (typeof videoData === "string") {
        // YouTube URL or file URI
        if (videoData.includes("youtube.com") || videoData.includes("youtu.be")) {
          videoPart = {
            file_data: { file_uri: videoData },
          };
        } else {
          // Assume it's a file URI from Files API
          videoPart = {
            file_data: { file_uri: videoData },
          };
        }
      } else {
        // Buffer - inline data
        videoPart = {
          inline_data: {
            mime_type: options.mimeType || "video/mp4",
            data: videoData.toString("base64"),
          },
        };
      }

      // Add video metadata if specified
      const videoMetadata: Record<string, unknown> = {};
      if (options.fps !== undefined) {
        videoMetadata.fps = options.fps;
      }
      if (options.startOffset !== undefined) {
        videoMetadata.start_offset = `${options.startOffset}s`;
      }
      if (options.endOffset !== undefined) {
        videoMetadata.end_offset = `${options.endOffset}s`;
      }

      if (Object.keys(videoMetadata).length > 0) {
        videoPart.video_metadata = videoMetadata;
      }

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        temperature: 0.4,
        maxOutputTokens: 8192,
      };

      if (options.lowResolution) {
        generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";
      }

      const payload = {
        contents: [{
          parts: [
            videoPart,
            { text: prompt },
          ],
        }],
        generationConfig,
      };

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No response from model",
        };
      }

      const textParts = parts.filter((p) => p.text).map((p) => p.text);
      const responseText = textParts.join("\n");

      return {
        success: true,
        response: responseText,
        model: modelId,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Analyze image(s) using Gemini vision
   * Supports single or multiple images for comparison analysis
   */
  async analyzeImage(
    imageData: Buffer | Buffer[],
    prompt: string,
    options: GeminiImageAnalysisOptions = {}
  ): Promise<GeminiImageAnalysisResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    const modelId = options.model || "gemini-3-flash-preview";

    try {
      // Build image parts
      const buffers = Array.isArray(imageData) ? imageData : [imageData];
      const imageParts: Array<Record<string, unknown>> = buffers.map((buf) => ({
        inline_data: {
          mime_type: "image/png",
          data: buf.toString("base64"),
        },
      }));

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        temperature: 0.4,
        maxOutputTokens: 8192,
      };

      if (options.lowResolution) {
        generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";
      }

      const payload = {
        contents: [{
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        }],
        generationConfig,
      };

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No response from model",
        };
      }

      const textParts = parts.filter((p) => p.text).map((p) => p.text);
      const responseText = textParts.join("\n");

      return {
        success: true,
        response: responseText,
        model: modelId,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const clipsInfo = clips.map((clip) => ({
        id: clip.id,
        startTime: clip.startTime,
        duration: clip.duration,
        effects: clip.effects?.map((e) => e.type) || [],
      }));

      const prompt = `You are a video editing assistant. Analyze the following clips and user instruction to suggest edits.

Clips:
${JSON.stringify(clipsInfo, null, 2)}

User instruction: "${instruction}"

Respond with a JSON array of edit suggestions. Each suggestion should have:
- type: one of "trim", "cut", "add-effect", "reorder", "delete", "split", "merge"
- description: brief explanation of the edit
- clipIds: array of clip IDs to apply this edit to
- params: object with parameters for the edit (e.g., newDuration, effectType, startTime)
- confidence: number 0-1 indicating confidence

Available effect types: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia

Example response:
[{"type":"trim","description":"Trim intro to 3 seconds","clipIds":["clip-1"],"params":{"newDuration":3},"confidence":0.9}]

Respond with ONLY the JSON array, no other text.`;

      const response = await fetch(
        `${this.baseUrl}/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1024,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Gemini API error:", error);
        return this.fallbackAutoEdit(clips, instruction);
      }

      const data = await response.json() as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        type: string;
        description: string;
        clipIds: string[];
        params: Record<string, unknown>;
        confidence: number;
      }>;

      return suggestions.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type as EditSuggestion["type"],
        description: s.description,
        clipIds: s.clipIds,
        params: s.params,
        confidence: s.confidence,
      }));
    } catch (error) {
      console.error("Gemini autoEdit error:", error);
      return this.fallbackAutoEdit(clips, instruction);
    }
  }

  /**
   * Fallback to simple pattern matching when API fails
   */
  private fallbackAutoEdit(clips: Clip[], instruction: string): EditSuggestion[] {
    const suggestions: EditSuggestion[] = [];
    const lowerInstruction = instruction.toLowerCase();

    if (lowerInstruction.includes("trim") || lowerInstruction.includes("shorten")) {
      const timeMatch = lowerInstruction.match(/(\d+)\s*(s|sec|seconds?)/);
      const duration = timeMatch ? parseInt(timeMatch[1]) : 3;

      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "trim",
          description: `Trim clip to ${duration} seconds`,
          clipIds: [clip.id],
          params: { newDuration: duration },
          confidence: 0.8,
        });
      });
    }

    if (lowerInstruction.includes("fade")) {
      const isFadeOut = lowerInstruction.includes("out");
      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "add-effect",
          description: `Add fade ${isFadeOut ? "out" : "in"} effect`,
          clipIds: [clip.id],
          params: {
            effectType: isFadeOut ? "fadeOut" : "fadeIn",
            duration: 1,
          },
          confidence: 0.9,
        });
      });
    }

    return suggestions;
  }

  /**
   * Supported model aliases for motion graphic generation
   */
  static readonly MOTION_MODELS = GEMINI_MOTION_MODELS;

  // ---------------------------------------------------------------------------
  // Delegated methods — Motion (gemini-motion.ts)
  // ---------------------------------------------------------------------------

  /**
   * Generate a Remotion motion graphic component using Gemini.
   * Mirrors ClaudeProvider.generateMotion but calls the Gemini generateContent API.
   */
  async generateMotion(
    description: string,
    options: GeminiMotionOptions = {}
  ): Promise<GeminiMotionResult> {
    if (!this.apiKey) {
      return { success: false, error: "Google API key not configured" };
    }
    return generateMotionImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, description, options);
  }

  /**
   * Refine an existing Remotion motion graphic component based on instructions.
   */
  async refineMotion(
    existingCode: string,
    instructions: string,
    options: GeminiMotionOptions = {}
  ): Promise<GeminiMotionResult> {
    if (!this.apiKey) {
      return { success: false, error: "Google API key not configured" };
    }
    return refineMotionImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, existingCode, instructions, options);
  }

  /**
   * Generate a storyboard from script content using Gemini 2.5 Flash.
   * Alternative to ClaudeProvider.analyzeContent for when Claude is unavailable.
   */
  async analyzeContent(
    content: string,
    targetDuration?: number,
    options?: { creativity?: "low" | "high" }
  ): Promise<StoryboardSegment[]> {
    if (!this.apiKey) return [];
    return analyzeContentImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, content, targetDuration, options);
  }
}

export const geminiProvider = new GeminiProvider();
