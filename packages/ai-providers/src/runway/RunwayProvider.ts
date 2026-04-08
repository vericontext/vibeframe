import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";

/**
 * Runway model versions
 * - gen4.5: Latest flagship model (text-to-video + image-to-video, 12 credits/sec)
 * - gen4_turbo: Previous model (image-to-video only)
 */
export type RunwayModel = "gen4_turbo" | "gen4.5";

/** Default model - Gen-4.5 */
const DEFAULT_MODEL: RunwayModel = "gen4.5";

/**
 * Runway video generation options
 */
export interface RunwayVideoOptions {
  /** Text prompt describing the video */
  promptText?: string;
  /** Reference image URL or base64 data URI for image-to-video */
  promptImage?: string;
  /** Random seed for reproducibility (0-4294967295) */
  seed?: number;
  /** Model to use */
  model?: RunwayModel;
  /** Duration in seconds (2-10 for gen4.5, 5 or 10 for gen4_turbo) */
  duration?: number;
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
 * Runway provider for professional video generation
 * Default: Gen-4.5 (text-to-video + image-to-video, 12 credits/sec)
 * Legacy: Gen-4 Turbo (image-to-video only)
 */
export class RunwayProvider implements AIProvider {
  id = "runway";
  name = "Runway";
  description = "Professional AI video generation with Gen-4.5";
  capabilities: AICapability[] = [
    "text-to-video",
    "image-to-video",
  ];
  iconUrl = "/icons/runway.svg";
  isAvailable = true;

  private static readonly API_VERSION = "2024-11-06";
  private static readonly MAX_RETRIES = 3;
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
      // Map user-friendly aspect ratios to Runway API format
      const ratioMap: Record<string, string> = {
        "16:9": "1280:720",
        "9:16": "720:1280",
        "1:1": "960:960",
      };
      const apiRatio = ratioMap[options?.aspectRatio || "16:9"] || "1280:720";

      // Use specified model or default
      const model = (options?.model as RunwayModel) || DEFAULT_MODEL;

      // gen4_turbo requires an image; gen4.5 supports text-to-video
      if (!options?.referenceImage && model !== "gen4.5") {
        return {
          id: "",
          status: "failed",
          error: `Runway ${model} requires an input image. Use -i <image> or switch to gen4.5 for text-to-video.`,
        };
      }

      // Determine endpoint based on whether image is provided
      const hasImage = !!options?.referenceImage;
      const endpoint = hasImage ? "image_to_video" : "text_to_video";

      const body: Record<string, unknown> = {
        model,
        promptText: prompt,
        ratio: apiRatio,
        duration: this.clampDuration(options?.duration, model),
      };

      if (hasImage) {
        const imageData = typeof options!.referenceImage === "string"
          ? options!.referenceImage
          : await this.blobToDataUri(options!.referenceImage as Blob);
        body.promptImage = imageData;
      }

      if (options?.seed !== undefined) {
        body.seed = options.seed;
      }

      const response = await this.fetchWithRetry(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": RunwayProvider.API_VERSION,
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
        console.error(`[Runway] POST /${endpoint} -> ${response.status} ${response.statusText}\n  Model: ${model}, Ratio: ${apiRatio}, Duration: ${body.duration}\n  Response: ${errorText.slice(0, 500)}`);
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
          "X-Runway-Version": RunwayProvider.API_VERSION,
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
          "X-Runway-Version": RunwayProvider.API_VERSION,
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
          "X-Runway-Version": RunwayProvider.API_VERSION,
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
   * Fetch with retry for transient errors (429, 503)
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < RunwayProvider.MAX_RETRIES; attempt++) {
      const response = await fetch(url, init);
      if (response.status !== 429 && response.status !== 503) {
        return response;
      }
      lastResponse = response;
      const retryAfter = response.headers.get("Retry-After");
      const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** (attempt + 1)) * 1000;
      console.error(`[Runway] ${response.status} — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${RunwayProvider.MAX_RETRIES})`);
      await this.sleep(delayMs);
    }
    return lastResponse!;
  }

  /**
   * Clamp duration to valid range for the given model
   */
  private clampDuration(duration: number | undefined, model: RunwayModel): number {
    if (model === "gen4.5") {
      // gen4.5 supports 2-10 seconds (integer)
      const d = duration ?? 5;
      return Math.max(2, Math.min(10, Math.round(d)));
    }
    // gen4_turbo supports 5 or 10
    return duration === 10 ? 10 : 5;
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
