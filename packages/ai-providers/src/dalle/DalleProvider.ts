import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types";

/**
 * Image generation options
 */
export interface ImageOptions {
  /** Image size */
  size?: "1024x1024" | "1792x1024" | "1024x1792";
  /** Quality */
  quality?: "standard" | "hd";
  /** Style */
  style?: "vivid" | "natural";
  /** Number of images to generate */
  n?: number;
}

/**
 * Generated image result
 */
export interface ImageResult {
  success: boolean;
  /** Generated image URLs */
  images?: Array<{
    url: string;
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
}

/**
 * DALL-E provider for image generation
 */
export class DalleProvider implements AIProvider {
  id = "dalle";
  name = "OpenAI DALL-E";
  description = "AI image generation for thumbnails, backgrounds, and visual assets";
  capabilities: AICapability[] = ["background-removal"];
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

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: options.n || 1,
          size: options.size || "1024x1024",
          quality: options.quality || "standard",
          style: options.style || "vivid",
          response_format: "url",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("DALL-E API error:", error);
        return {
          success: false,
          error: `API error: ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        data: Array<{
          url: string;
          revised_prompt?: string;
        }>;
      };

      return {
        success: true,
        images: data.data.map((img) => ({
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
      youtube: "1792x1024",
      instagram: "1024x1024",
      tiktok: "1024x1792",
      twitter: "1792x1024",
    };

    return this.generateImage(prompt, {
      size: style ? sizeMap[style] : "1792x1024",
      quality: "hd",
      style: "vivid",
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
      "16:9": "1792x1024",
      "9:16": "1024x1792",
      "1:1": "1024x1024",
    };

    const prompt = `Create a video background: ${description}. Seamless, suitable for video overlay, no focal point in center, subtle and not distracting.`;

    return this.generateImage(prompt, {
      size: sizeMap[aspectRatio],
      quality: "hd",
      style: "natural",
    });
  }

  /**
   * Create image variations
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
      formData.append("image", new Blob([uint8Array]), "image.png");
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

export const dalleProvider = new DalleProvider();
