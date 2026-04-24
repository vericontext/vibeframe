import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";

/**
 * GPT Image model types
 * - gpt-image-1.5: Default model (best cost/quality ratio)
 * - gpt-image-2: Flagship model released 2026-04-21 (higher fidelity, pricier)
 * - dall-e-3: Legacy model
 */
export type GPTImageModel = "gpt-image-1.5" | "gpt-image-2" | "dall-e-3";

/**
 * GPT Image 1.5 quality tiers
 * - low: $0.009/image (fastest)
 * - medium: $0.035/image
 * - high: $0.133/image (best quality)
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
  /** Quality tier (gpt-image-1.5 / gpt-image-2) or standard/hd (dall-e-3) */
  quality?: GPTImageQuality | "standard" | "hd";
  /** Style (dall-e-3 only) */
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
  /** Model for editing (default: gpt-image-1.5; gpt-image-2 also supported) */
  model?: GPTImageModel;
  /** Quality tier for editing */
  quality?: GPTImageQuality;
}

/** Default model — GPT Image 1.5 for best cost/quality. gpt-image-2 is opt-in (pricier). */
const DEFAULT_MODEL: GPTImageModel = "gpt-image-1.5";

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
   * Uses GPT Image 1.5 by default (fastest, best quality)
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
    const isGPTImage = model === "gpt-image-1.5" || model === "gpt-image-2";

    try {
      // Build request body based on model
      const body: Record<string, unknown> = {
        model,
        prompt,
        n: options.n || 1,
      };

      if (isGPTImage) {
        // GPT Image 1.5 / 2 options - do NOT support response_format
        // Quality values: low, medium, high, auto
        const qualityMap: Record<string, string> = {
          standard: "medium",
          hd: "high",
        };
        const quality = options.quality || "medium";
        body.quality = qualityMap[quality] || quality;
        if (options.size && options.size !== "auto") {
          body.size = options.size;
        }
      } else {
        // DALL-E 3 options
        body.response_format = "url";
        body.size = options.size || "1024x1024";
        body.quality = options.quality === "high" ? "hd" : (options.quality || "standard");
        body.style = options.style || "vivid";
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

  /**
   * Create image variations (uses DALL-E 2)
   */
  async createVariation(
    imageBuffer: Buffer,
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
      const uint8Array = new Uint8Array(imageBuffer);
      formData.append("image", new Blob([uint8Array], { type: "image/png" }), "image.png");
      formData.append("model", "dall-e-2");
      formData.append("n", String(options.n || 1));
      formData.append("size", options.size || "1024x1024");

      const response = await fetch(`${this.baseUrl}/images/variations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `API error: ${response.status} - ${error}`,
        };
      }

      const data = (await response.json()) as {
        data: Array<{ url: string }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({ url: img.url })),
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
