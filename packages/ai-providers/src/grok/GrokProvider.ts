import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";
import type { ImageResult } from "../openai-image/OpenAIImageProvider.js";

/**
 * Grok Imagine model versions
 * - grok-imagine-video-1.5: Text/Image to Video, default (1-15 sec, native audio, up to 1080p)
 * - grok-imagine-video-1.5-lite: cheaper 1.5 tier
 * - grok-imagine-video: previous generation
 * - grok-imagine-image: Text to Image ($0.02/image)
 * - grok-imagine-image-2.0: Text to Image, higher quality ($0.04-0.08/image by quality)
 */
export type GrokModel = GrokVideoModel | "grok-imagine-image" | "grok-imagine-image-2.0";

/** Grok Imagine video models. */
export type GrokVideoModel =
  | "grok-imagine-video-1.5"
  | "grok-imagine-video-1.5-lite"
  | "grok-imagine-video";

/**
 * Resolve a `--grok-model` alias: `1.5` (default), `lite`, or `classic`.
 * Full model IDs pass through. Unknown aliases throw.
 */
export function resolveGrokVideoModel(alias?: string): GrokVideoModel {
  const key = (alias ?? "1.5").trim().toLowerCase();
  const aliases: Record<string, GrokVideoModel> = {
    "1.5": "grok-imagine-video-1.5",
    "grok-imagine-video-1.5": "grok-imagine-video-1.5",
    lite: "grok-imagine-video-1.5-lite",
    "1.5-lite": "grok-imagine-video-1.5-lite",
    "grok-imagine-video-1.5-lite": "grok-imagine-video-1.5-lite",
    classic: "grok-imagine-video",
    "grok-imagine-video": "grok-imagine-video",
  };
  if (Object.hasOwn(aliases, key)) return aliases[key];
  throw new Error(`Unknown Grok video model "${alias}". Valid: 1.5, lite, classic.`);
}

/** Grok Imagine image models. `grok-imagine-image-pro` was retired on 2026-05-15. */
export type GrokImageModel = "grok-imagine-image" | "grok-imagine-image-2.0";

/** `grok-imagine-image-2.0` quality tier; `auto` lets xAI pick (edits bill as medium). */
export type GrokImageQuality = "low" | "medium" | "auto";

/**
 * Resolve a CLI image model alias for Grok. `pro`, `2.0`, and `quality`
 * select grok-imagine-image-2.0 at medium quality; anything else selects
 * the base grok-imagine-image.
 */
export function resolveGrokImageModel(alias?: string): {
  model: GrokImageModel;
  quality?: GrokImageQuality;
} {
  if (alias === "pro" || alias === "2.0" || alias === "quality" || alias === "grok-imagine-image-2.0") {
    return { model: "grok-imagine-image-2.0", quality: "medium" };
  }
  return { model: "grok-imagine-image" };
}

/** Default model */
const DEFAULT_MODEL: GrokVideoModel = "grok-imagine-video-1.5";

/** xAI defaults video to 480p when `resolution` is omitted; ask for 720p instead. */
const DEFAULT_VIDEO_RESOLUTION = "720p";
const GROK_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];

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
 * Grok image generation options
 */
export interface GrokImageOptions {
  /** Model to use (default: grok-imagine-image) */
  model?: GrokImageModel;
  /** Quality tier (grok-imagine-image-2.0 only) */
  quality?: GrokImageQuality;
  /** Number of images (1-10, default: 1) */
  n?: number;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Resolution: 1k or 2k */
  resolution?: "1k" | "2k";
  /** Response format */
  responseFormat?: "url" | "b64_json";
}

/**
 * Grok image edit options
 */
export interface GrokEditOptions {
  /** Model to use (default: grok-imagine-image) */
  model?: GrokImageModel;
  /** Quality tier (grok-imagine-image-2.0 only) */
  quality?: GrokImageQuality;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Response format */
  responseFormat?: "url" | "b64_json";
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
  status: "pending" | "done" | "expired" | "failed";
  error?: { code?: string; message?: string };
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
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "text-to-image", "image-editing"];
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
   * Generate image using Grok Imagine
   */
  async generateImage(
    prompt: string,
    options: GrokImageOptions = {}
  ): Promise<ImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "xAI API key not configured. Set XAI_API_KEY environment variable.",
      };
    }

    try {
      const body: Record<string, unknown> = {
        model: options.model || "grok-imagine-image",
        ...(options.quality ? { quality: options.quality } : {}),
        prompt,
        n: options.n || 1,
        response_format: options.responseFormat || "url",
      };

      if (options.aspectRatio) {
        body.aspect_ratio = options.aspectRatio;
      }

      if (options.resolution) {
        body.resolution = options.resolution;
      }

      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }
        return {
          success: false,
          error: errorMessage,
        };
      }

      const data = (await response.json()) as {
        data: Array<{
          url?: string;
          b64_json?: string;
        }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({
          url: img.url,
          base64: img.b64_json,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Edit image using Grok Imagine
   * Supports single image input with text instruction-based editing
   */
  async editImage(
    imageBuffer: Buffer,
    prompt: string,
    options: GrokEditOptions = {}
  ): Promise<ImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "xAI API key not configured. Set XAI_API_KEY environment variable.",
      };
    }

    try {
      // Convert buffer to base64 data URI
      const base64 = imageBuffer.toString("base64");
      const dataUri = `data:image/png;base64,${base64}`;

      const body: Record<string, unknown> = {
        model: options.model || "grok-imagine-image",
        ...(options.quality ? { quality: options.quality } : {}),
        prompt,
        image: {
          url: dataUri,
          type: "image_url",
        },
        n: 1,
        response_format: options.responseFormat || "url",
      };

      if (options.aspectRatio) {
        body.aspect_ratio = options.aspectRatio;
      }

      const response = await fetch(`${this.baseUrl}/images/edits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }
        return {
          success: false,
          error: errorMessage,
        };
      }

      const data = (await response.json()) as {
        data: Array<{
          url?: string;
          b64_json?: string;
        }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({
          url: img.url,
          base64: img.b64_json,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
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
      // xAI API requires integer duration; floats fail with 422 deserialization error.
      const duration = Math.round(Math.min(15, Math.max(1, options?.duration || 5)));

      const body: Record<string, unknown> = {
        model: (options?.model as GrokVideoModel | undefined) || DEFAULT_MODEL,
        prompt,
        duration,
        aspect_ratio: options?.aspectRatio || "16:9",
        resolution: GROK_VIDEO_RESOLUTIONS.includes(options?.resolution ?? "")
          ? options!.resolution
          : DEFAULT_VIDEO_RESOLUTION,
      };
      if (typeof options?.generateAudio === "boolean") {
        body.generate_audio = options.generateAudio;
      }

      // Add reference image for image-to-video
      // xAI API requires image as object: { url: "..." } (works for both URLs and data URIs)
      if (options?.referenceImage) {
        body.image = { url: options.referenceImage as string };
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
        failed: "failed",
      };

      return {
        id,
        status: statusMap[data.status] || "pending",
        videoUrl: data.video?.url,
        error:
          data.status === "expired"
            ? "Generation expired"
            : data.status === "failed"
              ? `Generation failed: ${data.error?.message ?? data.error?.code ?? "unknown error"}`
              : undefined,
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
