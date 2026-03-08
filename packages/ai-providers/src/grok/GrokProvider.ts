import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";

/**
 * Grok Imagine model versions
 * - grok-imagine-video: Text/Image to Video (1-15 sec, $4.20/min)
 */
export type GrokModel = "grok-imagine-video";

/** Default model */
const DEFAULT_MODEL: GrokModel = "grok-imagine-video";

/**
 * Grok video generation options
 */
export interface GrokVideoOptions {
  /** Duration in seconds (1-15) */
  duration?: number;
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Reference image URL for image-to-video */
  referenceImage?: string;
  /** Enable audio generation */
  audio?: boolean;
}

/**
 * Grok video creation response
 */
interface GrokCreateResponse {
  request_id: string;
}

/**
 * Grok video status response
 */
interface GrokStatusResponse {
  status: "pending" | "done" | "expired";
  video?: {
    url: string;
    duration?: number;
  };
  model?: string;
}

/**
 * xAI Grok Imagine provider for video generation
 * Supports text-to-video and image-to-video with native audio
 */
export class GrokProvider implements AIProvider {
  id = "grok";
  name = "xAI Grok Imagine";
  description = "AI video generation with Grok Imagine (native audio, 1-15 sec)";
  capabilities: AICapability[] = ["text-to-video", "image-to-video"];
  iconUrl = "/icons/xai.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.x.ai/v1";
  private pollingInterval = 3000;

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
   * Generate video using Grok Imagine
   */
  async generateVideo(
    prompt: string,
    options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "xAI API key not configured. Set XAI_API_KEY environment variable.",
      };
    }

    try {
      const duration = Math.min(15, Math.max(1, options?.duration || 5));

      const body: Record<string, unknown> = {
        model: DEFAULT_MODEL,
        prompt,
        duration,
        aspect_ratio: options?.aspectRatio || "16:9",
      };

      // Add reference image for image-to-video
      if (options?.referenceImage) {
        const imageData = options.referenceImage as string;
        if (imageData.startsWith("http")) {
          body.image_url = imageData;
        } else if (imageData.startsWith("data:")) {
          body.image = imageData;
        }
      }

      const response = await fetch(`${this.baseUrl}/videos/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id: "",
          status: "failed",
          error: `Grok API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as GrokCreateResponse;

      return {
        id: data.request_id,
        status: "pending",
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
   * Get generation status
   */
  async getGenerationStatus(id: string): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id,
        status: "failed",
        error: "xAI API key not configured",
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/videos/${id}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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

      const data = (await response.json()) as GrokStatusResponse;

      const statusMap: Record<string, VideoResult["status"]> = {
        pending: "pending",
        done: "completed",
        expired: "failed",
      };

      return {
        id,
        status: statusMap[data.status] || "pending",
        videoUrl: data.video?.url,
        error: data.status === "expired" ? "Generation expired" : undefined,
      };
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
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 300000 // 5 minutes
  ): Promise<VideoResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getGenerationStatus(id);

      if (onProgress) {
        onProgress(result);
      }

      if (result.status === "completed" || result.status === "failed") {
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
   * Cancel generation (if supported)
   */
  async cancelGeneration(id: string): Promise<boolean> {
    if (!this.apiKey) return false;

    try {
      const response = await fetch(`${this.baseUrl}/videos/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const grokProvider = new GrokProvider();
