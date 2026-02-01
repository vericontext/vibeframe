import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types";

/**
 * Runway Gen-3 Alpha Turbo video generation options
 */
export interface RunwayVideoOptions {
  /** Text prompt describing the video */
  promptText?: string;
  /** Reference image URL or base64 data URI for image-to-video */
  promptImage?: string;
  /** Random seed for reproducibility (0-4294967295) */
  seed?: number;
  /** Model to use */
  model?: "gen3a_turbo";
  /** Duration in seconds (5 or 10) */
  duration?: 5 | 10;
  /** Aspect ratio */
  ratio?: "16:9" | "9:16";
  /** Enable watermark */
  watermark?: boolean;
}

/**
 * Task response from Runway API
 */
interface RunwayTaskResponse {
  id: string;
  name?: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED";
  createdAt?: string;
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
}

/**
 * Runway Gen-3 Alpha Turbo provider for professional video generation
 */
export class RunwayProvider implements AIProvider {
  id = "runway";
  name = "Runway Gen-3";
  description = "Professional AI video generation with Gen-3 Alpha Turbo";
  capabilities: AICapability[] = [
    "text-to-video",
    "image-to-video",
  ];
  iconUrl = "/icons/runway.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.dev.runwayml.com/v1";
  private pollingInterval = 5000; // 5 seconds

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
   * Generate video from text prompt (text-to-video)
   * Uses Gen-3 Alpha Turbo model
   */
  async generateVideo(
    prompt: string,
    options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Runway API key not configured. Set RUNWAY_API_SECRET environment variable.",
      };
    }

    try {
      const body: Record<string, unknown> = {
        promptText: prompt,
        model: "gen3a_turbo",
        duration: options?.duration === 10 ? 10 : 5,
        ratio: options?.aspectRatio === "9:16" ? "9:16" : "16:9",
        watermark: false,
      };

      if (options?.seed !== undefined) {
        body.seed = options.seed;
      }

      // If reference image is provided, use image-to-video
      if (options?.referenceImage) {
        const imageData = typeof options.referenceImage === "string"
          ? options.referenceImage
          : await this.blobToDataUri(options.referenceImage as Blob);
        body.promptImage = imageData;
      }

      const response = await fetch(`${this.baseUrl}/image_to_video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-11-06",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorData.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          id: "",
          status: "failed",
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as { id: string };

      return {
        id: data.id,
        status: "pending",
        progress: 0,
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
   * Generate video from image (image-to-video)
   */
  async generateFromImage(
    imageData: string | Blob,
    promptText: string,
    options?: Omit<RunwayVideoOptions, "promptImage" | "promptText">
  ): Promise<VideoResult> {
    const imageUri = typeof imageData === "string"
      ? imageData
      : await this.blobToDataUri(imageData);

    return this.generateVideo(promptText, {
      prompt: promptText,
      referenceImage: imageUri,
      aspectRatio: options?.ratio,
      duration: options?.duration,
      seed: options?.seed,
    });
  }

  /**
   * Get status of ongoing generation
   */
  async getGenerationStatus(id: string): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id,
        status: "failed",
        error: "Runway API key not configured",
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/tasks/${id}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-Runway-Version": "2024-11-06",
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

      const data = (await response.json()) as RunwayTaskResponse;

      // Map Runway status to our status
      const statusMap: Record<string, VideoResult["status"]> = {
        PENDING: "pending",
        RUNNING: "processing",
        SUCCEEDED: "completed",
        FAILED: "failed",
        CANCELLED: "cancelled",
        THROTTLED: "failed",
      };

      const result: VideoResult = {
        id: data.id,
        status: statusMap[data.status] || "pending",
        progress: data.progress,
      };

      if (data.status === "SUCCEEDED" && data.output && data.output.length > 0) {
        result.videoUrl = data.output[0];
      }

      if (data.status === "FAILED" || data.status === "THROTTLED") {
        result.error = data.failure || data.failureCode || "Generation failed";
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
   * Cancel ongoing generation
   */
  async cancelGeneration(id: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/tasks/${id}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-Runway-Version": "2024-11-06",
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Delete a completed task
   */
  async deleteTask(id: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/tasks/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-Runway-Version": "2024-11-06",
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait for generation to complete with polling
   */
  async waitForCompletion(
    id: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 300000 // 5 minutes default
  ): Promise<VideoResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.getGenerationStatus(id);

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

export const runwayProvider = new RunwayProvider();
