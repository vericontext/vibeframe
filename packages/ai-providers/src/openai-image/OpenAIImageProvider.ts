import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";

/**
 * GPT Image model types
 * - gpt-image-2.5-sunburst: Default. OpenAI's most capable image model
 *   (2026-09-08); same token prices as gpt-image-2.
 * - gpt-image-2.5-flare: Fast, high-quality everyday tier (2026-09-08).
 * - gpt-image-2: Previous default.
 * - gpt-image-1.5: Shuts down 2026-12-01.
 */
export type GPTImageModel =
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.5-flare"
  | "gpt-image-2"
  | "gpt-image-1.5";

/**
 * GPT Image quality tiers. Prices are per 1024x1024 image: GPT Image 1.5
 * high is $0.133 and GPT Image 2 / 2.5 high is $0.211 (OpenAI pricing,
 * 2026-10-04).
 */
export type GPTImageQuality = "low" | "medium" | "high";

/**
 * Image generation options
 */
export interface ImageOptions {
  /** Model to use */
  model?: GPTImageModel;
  /** Image size */
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  /** Quality tier; the legacy standard/hd names map to medium/high */
  quality?: GPTImageQuality | "standard" | "hd";
  /** Ignored: only DALL-E 3 (shut down 2026-05-12) used it. Kept for CLI compatibility. */
  style?: "vivid" | "natural";
  /** Number of images to generate */
  n?: number;
}

/**
 * Generated image result
 */
export interface ImageResult {
  success: boolean;
  /** Generated images (URL or base64) */
  images?: Array<{
    url?: string;
    base64?: string;
    revisedPrompt?: string;
  }>;
  /** Error message if failed */
  error?: string;
}

/**
 * Image edit options
 */
export interface ImageEditOptions {
  /** Mask image (transparent areas will be edited) */
  mask?: Buffer;
  /** Size of output */
  size?: "1024x1024" | "512x512" | "256x256";
  /** Number of variations */
  n?: number;
  /** Model for editing (default: OPENAI_IMAGE_DEFAULT_MODEL) */
  model?: GPTImageModel;
  /** Quality tier for editing */
  quality?: GPTImageQuality;
}

/** Default text-to-image model. */
export const OPENAI_IMAGE_DEFAULT_MODEL: GPTImageModel = "gpt-image-2.5-sunburst";
const DEFAULT_MODEL = OPENAI_IMAGE_DEFAULT_MODEL;

/**
 * OpenAI Image provider (GPT Image 1.5 / GPT Image 2 / DALL-E)
 */
export class OpenAIImageProvider implements AIProvider {
  id = "openai-image";
  name = "OpenAI GPT Image";
  description = "AI image generation with GPT Image 1.5 (default) and GPT Image 2 (opt-in)";
  capabilities: AICapability[] = ["text-to-image", "background-removal", "image-editing"];
  iconUrl = "/icons/openai.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.openai.com/v1";

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
   * Generate images from text prompt
   * Uses GPT Image 2.5 Sunburst by default
   */
  async generateImage(
    prompt: string,
    options: ImageOptions = {}
  ): Promise<ImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "OpenAI API key not configured",
      };
    }

    const model = options.model || DEFAULT_MODEL;

    try {
      // Build request body based on model
      const body: Record<string, unknown> = {
        model,
        prompt,
        n: options.n || 1,
      };

      // GPT Image models do NOT support response_format.
      // Quality values: low, medium, high, auto.
      const qualityMap: Record<string, string> = {
        standard: "medium",
        hd: "high",
      };
      const quality = options.quality || "medium";
      body.quality = qualityMap[quality] || quality;
      if (options.size && options.size !== "auto") {
        body.size = options.size;
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
        console.error("OpenAI Image API error:", errorText);

        // Parse error to get detailed message
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          // If not JSON, use the raw text
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
          revised_prompt?: string;
        }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({
          url: img.url,
          base64: img.b64_json,
          revisedPrompt: img.revised_prompt,
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
   * Generate thumbnail for video content
   */
  async generateThumbnail(
    description: string,
    style?: "youtube" | "instagram" | "tiktok" | "twitter"
  ): Promise<ImageResult> {
    const stylePrompts: Record<string, string> = {
      youtube: "YouTube thumbnail style, bold text overlay area, vibrant colors, high contrast, attention-grabbing",
      instagram: "Instagram post style, clean aesthetic, lifestyle photography feel, square format optimized",
      tiktok: "TikTok cover style, vertical format, trendy, dynamic, youth-oriented",
      twitter: "Twitter/X card style, professional, clean, horizontal format",
    };

    const styleHint = style ? stylePrompts[style] : "professional video thumbnail";
    const prompt = `Create a video thumbnail: ${description}. Style: ${styleHint}. No text in the image.`;

    const sizeMap: Record<string, ImageOptions["size"]> = {
      youtube: "1536x1024",
      instagram: "1024x1024",
      tiktok: "1024x1536",
      twitter: "1536x1024",
    };

    return this.generateImage(prompt, {
      size: style ? sizeMap[style] : "1536x1024",
      quality: "high",
    });
  }

  /**
   * Generate background image for video
   */
  async generateBackground(
    description: string,
    aspectRatio: "16:9" | "9:16" | "1:1" = "16:9"
  ): Promise<ImageResult> {
    const sizeMap: Record<string, ImageOptions["size"]> = {
      "16:9": "1536x1024",
      "9:16": "1024x1536",
      "1:1": "1024x1024",
    };

    const prompt = `Create a video background: ${description}. Seamless, suitable for video overlay, no focal point in center, subtle and not distracting.`;

    return this.generateImage(prompt, {
      size: sizeMap[aspectRatio],
      quality: "high",
    });
  }

  /**
   * Edit images using GPT Image 1.5
   * Supports up to 16 input images with text instruction-based editing
   */
  async editImage(
    imageBuffers: Buffer[],
    prompt: string,
    options: ImageEditOptions = {}
  ): Promise<ImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "OpenAI API key not configured",
      };
    }

    try {
      const formData = new FormData();
      formData.append("model", options.model || DEFAULT_MODEL);
      formData.append("prompt", prompt);

      // Add images (up to 16)
      for (const buf of imageBuffers) {
        const uint8Array = new Uint8Array(buf);
        formData.append("image[]", new Blob([uint8Array], { type: "image/png" }), "image.png");
      }

      if (options.mask) {
        const maskUint8 = new Uint8Array(options.mask);
        formData.append("mask", new Blob([maskUint8], { type: "image/png" }), "mask.png");
      }

      if (options.quality) {
        formData.append("quality", options.quality);
      }

      if (options.size) {
        formData.append("size", options.size);
      }

      const response = await fetch(`${this.baseUrl}/images/edits`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
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
          b64_json?: string;
          url?: string;
          revised_prompt?: string;
        }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({
          base64: img.b64_json,
          url: img.url,
          revisedPrompt: img.revised_prompt,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

}

export const openaiImageProvider = new OpenAIImageProvider();
