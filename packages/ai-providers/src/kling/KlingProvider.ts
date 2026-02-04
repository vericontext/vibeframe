import { createHmac } from "node:crypto";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";

/**
 * Kling model versions
 * - kling-v1: Original model
 * - kling-v1-5: Improved v1.5 (pro mode only)
 * - kling-v1-6: Latest v1 series (std/pro)
 * - kling-v2-master: v2.0 master (std/pro, faster)
 * - kling-v2-1-master: v2.1 master (std/pro)
 * - kling-v2-5-turbo: v2.5 turbo (fastest, best quality/speed ratio)
 */
export type KlingModel =
  | "kling-v1"
  | "kling-v1-5"
  | "kling-v1-6"
  | "kling-v2-master"
  | "kling-v2-1-master"
  | "kling-v2-5-turbo";

/**
 * Kling video generation options
 */
export interface KlingVideoOptions {
  /** Text prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model name */
  model?: KlingModel;
  /** Config for generation (0-1, controls prompt adherence) */
  cfg?: number;
  /** Generation mode: std (standard, faster) or pro (professional, higher quality) */
  mode?: "std" | "pro";
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Duration in seconds: 5 or 10 */
  duration?: "5" | "10";
  /** Reference image URL or base64 for image-to-video */
  imageUrl?: string;
  /** Image tail for end frame */
  imageTail?: string;
  /** Camera control settings */
  cameraControl?: {
    type?: "simple" | "down_back" | "forward_up" | "right_turn_forward" | "left_turn_forward";
    horizontal?: number;
    vertical?: number;
    pan?: number;
    tilt?: number;
    roll?: number;
    zoom?: number;
  };
}

/**
 * Kling task response
 */
interface KlingTaskResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    created_at?: number;
    updated_at?: number;
    task_result?: {
      videos?: Array<{
        id: string;
        url: string;
        duration: string;
      }>;
    };
  };
}

/**
 * Kling AI provider for high-quality video generation
 * Supports Kling v1, v1.5, v1.6, v2.0, and v2.1 models
 *
 * Model capabilities:
 * - v1/v1.5: Original models (v1.5 pro mode only)
 * - v1.6: Improved quality, std/pro modes
 * - v2.0/v2.1: Fastest generation, std/pro modes
 *
 * Note: image2video requires image URL (not base64) for v2.x models
 */
/**
 * Options for video extension
 */
export interface KlingVideoExtendOptions {
  /** Text prompt for continuation */
  prompt?: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Duration in seconds: 5 or 10 */
  duration?: "5" | "10";
}

/** Default model for Kling - v2.5 turbo is fastest */
const DEFAULT_MODEL: KlingModel = "kling-v2-5-turbo";

/** Models that support std mode (faster, cheaper) */
const STD_MODE_MODELS: KlingModel[] = ["kling-v1-6", "kling-v2-master", "kling-v2-1-master", "kling-v2-5-turbo"];

export class KlingProvider implements AIProvider {
  id = "kling";
  name = "Kling AI";
  description = "High-quality AI video generation with Kling v2.5 Turbo (fastest)";
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "video-extend"];
  iconUrl = "/icons/kling.svg";
  isAvailable = true;

  private accessKey?: string;
  private secretKey?: string;
  private baseUrl = "https://api.klingai.com/v1";
  private pollingInterval = 3000; // Faster polling for v2.x

  async initialize(config: ProviderConfig): Promise<void> {
    // API key format: "access_key:secret_key"
    if (config.apiKey) {
      const parts = config.apiKey.split(":");
      if (parts.length === 2) {
        this.accessKey = parts[0];
        this.secretKey = parts[1];
      } else {
        this.accessKey = config.apiKey;
      }
    }
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!(this.accessKey && this.secretKey);
  }

  /**
   * Generate JWT token for Kling API authentication
   */
  private generateToken(): string {
    if (!this.accessKey || !this.secretKey) {
      throw new Error("Kling API credentials not configured");
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      iss: this.accessKey,
      exp: now + 1800, // 30 minutes
      nbf: now - 5,
    };

    const base64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.secretKey)
      .update(`${base64Header}.${base64Payload}`)
      .digest("base64url");

    return `${base64Header}.${base64Payload}.${signature}`;
  }

  /**
   * Generate video from text prompt or image
   */
  async generateVideo(
    prompt: string,
    options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id: "",
        status: "failed",
        error: "Kling API credentials not configured. Use format: KLING_ACCESS_KEY:KLING_SECRET_KEY",
      };
    }

    try {
      const token = this.generateToken();

      // Determine model - use provided or default
      const model: KlingModel = (options?.model as KlingModel) || DEFAULT_MODEL;

      // Determine mode - std only supported on newer models
      let mode = options?.mode || "std";
      if (!STD_MODE_MODELS.includes(model) && mode === "std") {
        mode = "pro"; // Fallback to pro for older models
      }

      // Map aspect ratio
      const aspectRatioMap: Record<string, string> = {
        "16:9": "16:9",
        "9:16": "9:16",
        "1:1": "1:1",
        "4:5": "1:1", // fallback
      };

      const body: Record<string, unknown> = {
        prompt,
        model_name: model,
        mode,
        aspect_ratio: aspectRatioMap[options?.aspectRatio || "16:9"] || "16:9",
        duration: options?.duration === 10 ? "10" : "5",
      };

      if (options?.negativePrompt) {
        body.negative_prompt = options.negativePrompt;
      }

      // CFG scale (0-1)
      if (options?.cfg !== undefined) {
        body.cfg_scale = options.cfg;
      }

      // If reference image is provided, use image-to-video endpoint
      if (options?.referenceImage) {
        const imageInput = options.referenceImage;

        // Check if it's a URL (http/https) or needs base64 conversion
        if (typeof imageInput === "string") {
          if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
            // Use URL directly for v2.x models (they prefer URLs)
            body.image = imageInput;
          } else if (imageInput.startsWith("data:")) {
            // Already a data URI
            body.image = imageInput;
          } else {
            // Assume it's raw base64, add data URI prefix
            body.image = `data:image/png;base64,${imageInput}`;
          }
        } else {
          // Blob - convert to data URI
          body.image = await this.blobToDataUri(imageInput as Blob);
        }

        const response = await fetch(`${this.baseUrl}/videos/image2video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        return this.handleResponse(response);
      }

      // Text-to-video
      const response = await fetch(`${this.baseUrl}/videos/text2video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      return this.handleResponse(response);
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate video from image (image-to-video)
   */
  async generateFromImage(
    imageData: string | Blob,
    prompt: string,
    options?: Omit<KlingVideoOptions, "prompt" | "imageUrl">
  ): Promise<VideoResult> {
    const imageUri = typeof imageData === "string"
      ? imageData
      : await this.blobToDataUri(imageData);

    return this.generateVideo(prompt, {
      prompt,
      referenceImage: imageUri,
      aspectRatio: options?.aspectRatio as GenerateOptions["aspectRatio"],
      duration: options?.duration ? parseInt(options.duration) : undefined,
      negativePrompt: options?.negativePrompt,
    });
  }

  /**
   * Handle API response
   */
  private async handleResponse(response: Response): Promise<VideoResult> {
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      return {
        id: "",
        status: "failed",
        error: `API error (${response.status}): ${errorMessage}`,
      };
    }

    const data = (await response.json()) as KlingTaskResponse;

    if (data.code !== 0) {
      return {
        id: "",
        status: "failed",
        error: data.message || "API returned error",
      };
    }

    return {
      id: data.data.task_id,
      status: "pending",
      progress: 0,
    };
  }

  /**
   * Get generation status
   */
  async getGenerationStatus(id: string, type: "text2video" | "image2video" = "text2video"): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id,
        status: "failed",
        error: "Kling API credentials not configured",
      };
    }

    try {
      const token = this.generateToken();

      const response = await fetch(`${this.baseUrl}/videos/${type}/${id}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id,
          status: "failed",
          error: `Failed to get status: ${errorText}`,
        };
      }

      const data = (await response.json()) as KlingTaskResponse;

      if (data.code !== 0) {
        return {
          id,
          status: "failed",
          error: data.message,
        };
      }

      const statusMap: Record<string, VideoResult["status"]> = {
        submitted: "pending",
        processing: "processing",
        succeed: "completed",
        failed: "failed",
      };

      const result: VideoResult = {
        id: data.data.task_id,
        status: statusMap[data.data.task_status] || "pending",
      };

      if (data.data.task_status === "succeed" && data.data.task_result?.videos?.length) {
        const video = data.data.task_result.videos[0];
        result.videoUrl = video.url;
        result.duration = parseFloat(video.duration);
      }

      if (data.data.task_status === "failed") {
        result.error = data.data.task_status_msg || "Generation failed";
      }

      return result;
    } catch (error) {
      return {
        id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for generation to complete
   */
  async waitForCompletion(
    id: string,
    type: "text2video" | "image2video" = "text2video",
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 600000 // 10 minutes default (Kling can take longer)
  ): Promise<VideoResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getGenerationStatus(id, type);

      if (onProgress) {
        onProgress(result);
      }

      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        return result;
      }

      await this.sleep(this.pollingInterval);
    }

    return {
      id,
      status: "failed",
      error: "Generation timed out",
    };
  }

  /**
   * Extend an existing video using Kling AI
   * Uses the video-extend endpoint to continue the video
   */
  async extendVideo(
    videoData: string | Blob,
    options?: KlingVideoExtendOptions
  ): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id: "",
        status: "failed",
        error: "Kling API credentials not configured. Use format: KLING_ACCESS_KEY:KLING_SECRET_KEY",
      };
    }

    try {
      const token = this.generateToken();

      // Convert video to data URI if needed
      const videoUri = typeof videoData === "string"
        ? videoData
        : await this.blobToDataUri(videoData);

      const body: Record<string, unknown> = {
        video: videoUri,
        duration: options?.duration || "5",
      };

      if (options?.prompt) {
        body.prompt = options.prompt;
      }

      if (options?.negativePrompt) {
        body.negative_prompt = options.negativePrompt;
      }

      const response = await fetch(`${this.baseUrl}/videos/video-extend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      return this.handleResponse(response);
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get video extension status
   */
  async getExtendStatus(id: string): Promise<VideoResult> {
    if (!this.isConfigured()) {
      return {
        id,
        status: "failed",
        error: "Kling API credentials not configured",
      };
    }

    try {
      const token = this.generateToken();

      const response = await fetch(`${this.baseUrl}/videos/video-extend/${id}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id,
          status: "failed",
          error: `Failed to get status: ${errorText}`,
        };
      }

      const data = (await response.json()) as KlingTaskResponse;

      if (data.code !== 0) {
        return {
          id,
          status: "failed",
          error: data.message,
        };
      }

      const statusMap: Record<string, VideoResult["status"]> = {
        submitted: "pending",
        processing: "processing",
        succeed: "completed",
        failed: "failed",
      };

      const result: VideoResult = {
        id: data.data.task_id,
        status: statusMap[data.data.task_status] || "pending",
      };

      if (data.data.task_status === "succeed" && data.data.task_result?.videos?.length) {
        const video = data.data.task_result.videos[0];
        result.videoUrl = video.url;
        result.duration = parseFloat(video.duration);
      }

      if (data.data.task_status === "failed") {
        result.error = data.data.task_status_msg || "Extension failed";
      }

      return result;
    } catch (error) {
      return {
        id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for video extension to complete
   */
  async waitForExtendCompletion(
    id: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 600000
  ): Promise<VideoResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getExtendStatus(id);

      if (onProgress) {
        onProgress(result);
      }

      if (result.status === "completed" || result.status === "failed" || result.status === "cancelled") {
        return result;
      }

      await this.sleep(this.pollingInterval);
    }

    return {
      id,
      status: "failed",
      error: "Extension timed out",
    };
  }

  /**
   * Cancel generation (not supported by Kling API)
   */
  async cancelGeneration(_id: string): Promise<boolean> {
    // Kling API does not support cancellation
    return false;
  }

  /**
   * Convert Blob to data URI
   */
  private async blobToDataUri(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = blob.type || "image/png";
    return `data:${mimeType};base64,${base64}`;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const klingProvider = new KlingProvider();
