import { createHmac } from "node:crypto";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types";

/**
 * Kling video generation options
 */
export interface KlingVideoOptions {
  /** Text prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model name: kling-v1 or kling-v1-5 */
  model?: "kling-v1" | "kling-v1-5";
  /** Config for generation */
  cfg?: number;
  /** Generation mode: std (standard) or pro (professional) */
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
 * Uses Kling v1.5 model with text-to-video and image-to-video
 */
export class KlingProvider implements AIProvider {
  id = "kling";
  name = "Kling AI";
  description = "High-quality AI video generation with Kling v1.5";
  capabilities: AICapability[] = ["text-to-video", "image-to-video"];
  iconUrl = "/icons/kling.svg";
  isAvailable = true;

  private accessKey?: string;
  private secretKey?: string;
  private baseUrl = "https://api.klingai.com/v1";
  private pollingInterval = 5000;

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
   * Generate video from text prompt
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

      // Map aspect ratio
      const aspectRatioMap: Record<string, string> = {
        "16:9": "16:9",
        "9:16": "9:16",
        "1:1": "1:1",
        "4:5": "1:1", // fallback
      };

      const body: Record<string, unknown> = {
        prompt,
        model_name: "kling-v1-5",
        mode: "std",
        aspect_ratio: aspectRatioMap[options?.aspectRatio || "16:9"] || "16:9",
        duration: options?.duration === 10 ? "10" : "5",
      };

      if (options?.negativePrompt) {
        body.negative_prompt = options.negativePrompt;
      }

      // If reference image is provided, use image-to-video endpoint
      if (options?.referenceImage) {
        const imageData = typeof options.referenceImage === "string"
          ? options.referenceImage
          : await this.blobToDataUri(options.referenceImage as Blob);

        body.image = imageData;

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
