import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types";

/**
 * Kling 2.x provider for high-quality video generation
 */
export class KlingProvider implements AIProvider {
  id = "kling";
  name = "Kling 2.x";
  description = "High-quality AI video generation with Kling 2.x";
  capabilities: AICapability[] = ["text-to-video", "image-to-video"];
  iconUrl = "/icons/kling.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.klingai.com/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async generateVideo(
    prompt: string,
    options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Kling API key not configured",
      };
    }

    try {
      // TODO: Implement actual Kling API integration
      const response = await fetch(`${this.baseUrl}/videos/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: options?.negativePrompt,
          duration: options?.duration || 5,
          aspect_ratio: options?.aspectRatio || "16:9",
          seed: options?.seed,
          ...(options?.referenceImage && {
            image_reference: options.referenceImage,
          }),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          id: "",
          status: "failed",
          error: `Generation failed: ${error}`,
        };
      }

      const data = await response.json();

      return {
        id: data.task_id,
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

  async getGenerationStatus(id: string): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id,
        status: "failed",
        error: "Kling API key not configured",
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/videos/${id}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        return {
          id,
          status: "failed",
          error: "Failed to get generation status",
        };
      }

      const data = await response.json();

      const statusMap: Record<string, VideoResult["status"]> = {
        queued: "queued",
        processing: "processing",
        completed: "completed",
        failed: "failed",
      };

      return {
        id: data.task_id,
        status: statusMap[data.status] || "pending",
        videoUrl: data.video_url,
        thumbnailUrl: data.thumbnail_url,
        duration: data.duration,
        width: data.width,
        height: data.height,
        progress: data.progress,
      };
    } catch (error) {
      return {
        id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async cancelGeneration(id: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/videos/${id}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

export const klingProvider = new KlingProvider();
