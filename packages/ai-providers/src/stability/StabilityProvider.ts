import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";

/**
 * Image generation options for Stability AI
 */
export interface StabilityImageOptions {
  /** Image size preset */
  size?: "1024x1024" | "1152x896" | "896x1152" | "1216x832" | "832x1216" | "1344x768" | "768x1344" | "1536x640" | "640x1536";
  /** Number of images to generate */
  count?: number;
  /** CFG scale (1-35, default 7) */
  cfgScale?: number;
  /** Number of diffusion steps (10-50, default 30) */
  steps?: number;
  /** Sampler */
  sampler?: "DDIM" | "DDPM" | "K_DPMPP_2M" | "K_DPMPP_2S_ANCESTRAL" | "K_DPM_2" | "K_DPM_2_ANCESTRAL" | "K_EULER" | "K_EULER_ANCESTRAL" | "K_HEUN" | "K_LMS";
  /** Random seed for reproducibility */
  seed?: number;
  /** Style preset */
  stylePreset?: "3d-model" | "analog-film" | "anime" | "cinematic" | "comic-book" | "digital-art" | "enhance" | "fantasy-art" | "isometric" | "line-art" | "low-poly" | "modeling-compound" | "neon-punk" | "origami" | "photographic" | "pixel-art" | "tile-texture";
  /** Negative prompt */
  negativePrompt?: string;
  /** Model to use */
  model?: "sd3-large" | "sd3-large-turbo" | "sd3-medium" | "sd3.5-large" | "sd3.5-large-turbo" | "sd3.5-medium" | "stable-image-core" | "stable-image-ultra";
  /** Aspect ratio (for newer models) */
  aspectRatio?: "16:9" | "1:1" | "21:9" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "9:21";
  /** Output format */
  outputFormat?: "jpeg" | "png" | "webp";
}

/**
 * Image generation result
 */
export interface StabilityImageResult {
  success: boolean;
  /** Generated images as base64 or URLs */
  images?: Array<{
    base64?: string;
    url?: string;
    seed?: number;
    finishReason?: string;
  }>;
  /** Error message if failed */
  error?: string;
}

/**
 * Image-to-image options
 */
export interface StabilityImg2ImgOptions extends StabilityImageOptions {
  /** Strength of transformation (0-1, default 0.35) */
  strength?: number;
  /** Image mode */
  mode?: "image-to-image" | "control-sketch" | "control-structure";
}

/**
 * Upscale options
 */
export interface StabilityUpscaleOptions {
  /** Upscale type */
  type?: "fast" | "conservative" | "creative";
  /** Creativity (0-0.35, for creative upscale) */
  creativity?: number;
  /** Output format */
  outputFormat?: "jpeg" | "png" | "webp";
}

/**
 * Search and Replace options
 */
export interface StabilitySearchReplaceOptions {
  /** Negative prompt (what to avoid in the replacement) */
  negativePrompt?: string;
  /** Random seed for reproducibility */
  seed?: number;
  /** Output format */
  outputFormat?: "jpeg" | "png" | "webp";
}

/**
 * Outpaint options
 */
export interface StabilityOutpaintOptions {
  /** Pixels to extend on the left (0-2000) */
  left?: number;
  /** Pixels to extend on the right (0-2000) */
  right?: number;
  /** Pixels to extend on the top (0-2000) */
  up?: number;
  /** Pixels to extend on the bottom (0-2000) */
  down?: number;
  /** Prompt for the extended area */
  prompt?: string;
  /** Creativity level (0-1, default 0.5) */
  creativity?: number;
  /** Output format */
  outputFormat?: "jpeg" | "png" | "webp";
}

/**
 * Stability AI provider for Stable Diffusion image generation
 */
export class StabilityProvider implements AIProvider {
  id = "stability";
  name = "Stability AI";
  description = "Stable Diffusion image generation with SD3.5 and SDXL";
  capabilities: AICapability[] = ["background-removal", "upscale", "search-replace", "outpaint"];
  iconUrl = "/icons/stability.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.stability.ai";

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
   * Generate images from text prompt using SD3.5 or newer models
   */
  async generateImage(
    prompt: string,
    options: StabilityImageOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const model = options.model || "sd3.5-large";
      const formData = new FormData();

      formData.append("prompt", prompt);
      formData.append("output_format", options.outputFormat || "png");

      if (options.negativePrompt) {
        formData.append("negative_prompt", options.negativePrompt);
      }
      if (options.aspectRatio) {
        formData.append("aspect_ratio", options.aspectRatio);
      }
      if (options.seed !== undefined) {
        formData.append("seed", String(options.seed));
      }
      if (options.stylePreset) {
        formData.append("style_preset", options.stylePreset);
      }

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/generate/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

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
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      // Response is the image directly
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const seed = response.headers.get("seed");
      const finishReason = response.headers.get("finish-reason");

      return {
        success: true,
        images: [{
          base64,
          seed: seed ? parseInt(seed) : undefined,
          finishReason: finishReason || undefined,
        }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate image using legacy SDXL API (supports more options)
   */
  async generateImageSDXL(
    prompt: string,
    options: StabilityImageOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const body: Record<string, unknown> = {
        text_prompts: [
          { text: prompt, weight: 1 },
        ],
        cfg_scale: options.cfgScale || 7,
        steps: options.steps || 30,
        samples: options.count || 1,
      };

      if (options.negativePrompt) {
        (body.text_prompts as Array<{text: string; weight: number}>).push({
          text: options.negativePrompt,
          weight: -1,
        });
      }
      if (options.seed !== undefined) {
        body.seed = options.seed;
      }
      if (options.sampler) {
        body.sampler = options.sampler;
      }
      if (options.stylePreset) {
        body.style_preset = options.stylePreset;
      }

      // Parse size to width/height
      if (options.size) {
        const [width, height] = options.size.split("x").map(Number);
        body.width = width;
        body.height = height;
      } else {
        body.width = 1024;
        body.height = 1024;
      }

      const response = await fetch(`${this.baseUrl}/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

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
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        artifacts: Array<{
          base64: string;
          seed: number;
          finishReason: string;
        }>;
      };

      return {
        success: true,
        images: data.artifacts.map((a) => ({
          base64: a.base64,
          seed: a.seed,
          finishReason: a.finishReason,
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
   * Image-to-image transformation
   */
  async imageToImage(
    imageData: Buffer | Blob,
    prompt: string,
    options: StabilityImg2ImgOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;
      formData.append("image", imageBlob, "image.png");
      formData.append("prompt", prompt);
      formData.append("output_format", options.outputFormat || "png");
      formData.append("strength", String(options.strength || 0.35));
      formData.append("mode", options.mode || "image-to-image");

      if (options.negativePrompt) {
        formData.append("negative_prompt", options.negativePrompt);
      }
      if (options.seed !== undefined) {
        formData.append("seed", String(options.seed));
      }

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/generate/sd3.5-large`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        success: true,
        images: [{ base64 }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Upscale image
   */
  async upscaleImage(
    imageData: Buffer | Blob,
    options: StabilityUpscaleOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;
      formData.append("image", imageBlob, "image.png");
      formData.append("output_format", options.outputFormat || "png");

      const upscaleType = options.type || "fast";
      let endpoint: string;

      if (upscaleType === "creative") {
        endpoint = `${this.baseUrl}/v2beta/stable-image/upscale/creative`;
        if (options.creativity !== undefined) {
          formData.append("creativity", String(options.creativity));
        }
      } else if (upscaleType === "conservative") {
        endpoint = `${this.baseUrl}/v2beta/stable-image/upscale/conservative`;
      } else {
        endpoint = `${this.baseUrl}/v2beta/stable-image/upscale/fast`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        success: true,
        images: [{ base64 }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Remove background from image
   */
  async removeBackground(
    imageData: Buffer | Blob,
    outputFormat: "png" | "webp" = "png"
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;
      formData.append("image", imageBlob, "image.png");
      formData.append("output_format", outputFormat);

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/edit/remove-background`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        success: true,
        images: [{ base64 }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Inpaint/outpaint image
   */
  async inpaint(
    imageData: Buffer | Blob,
    maskData: Buffer | Blob,
    prompt: string,
    options: StabilityImageOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;
      const maskBlob = Buffer.isBuffer(maskData)
        ? new Blob([new Uint8Array(maskData)])
        : maskData;

      formData.append("image", imageBlob, "image.png");
      formData.append("mask", maskBlob, "mask.png");
      formData.append("prompt", prompt);
      formData.append("output_format", options.outputFormat || "png");

      if (options.negativePrompt) {
        formData.append("negative_prompt", options.negativePrompt);
      }
      if (options.seed !== undefined) {
        formData.append("seed", String(options.seed));
      }

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/edit/inpaint`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `API error (${response.status}): ${errorText}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        success: true,
        images: [{ base64 }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Search and replace objects in an image using AI
   */
  async searchAndReplace(
    imageData: Buffer | Blob,
    searchPrompt: string,
    replacePrompt: string,
    options: StabilitySearchReplaceOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;

      formData.append("image", imageBlob, "image.png");
      formData.append("prompt", replacePrompt);
      formData.append("search_prompt", searchPrompt);
      formData.append("output_format", options.outputFormat || "png");

      if (options.negativePrompt) {
        formData.append("negative_prompt", options.negativePrompt);
      }
      if (options.seed !== undefined) {
        formData.append("seed", String(options.seed));
      }

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/edit/search-and-replace`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

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
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const seed = response.headers.get("seed");

      return {
        success: true,
        images: [{
          base64,
          seed: seed ? parseInt(seed) : undefined,
        }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Extend image canvas (outpainting)
   */
  async outpaint(
    imageData: Buffer | Blob,
    options: StabilityOutpaintOptions = {}
  ): Promise<StabilityImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Stability AI API key not configured",
      };
    }

    // Validate that at least one direction is specified
    const { left = 0, right = 0, up = 0, down = 0 } = options;
    if (left === 0 && right === 0 && up === 0 && down === 0) {
      return {
        success: false,
        error: "At least one direction (left, right, up, down) must be specified",
      };
    }

    try {
      const formData = new FormData();

      const imageBlob = Buffer.isBuffer(imageData)
        ? new Blob([new Uint8Array(imageData)])
        : imageData;

      formData.append("image", imageBlob, "image.png");
      formData.append("output_format", options.outputFormat || "png");

      // Add direction values (clamp to 0-2000)
      if (left > 0) {
        formData.append("left", String(Math.min(2000, Math.max(0, left))));
      }
      if (right > 0) {
        formData.append("right", String(Math.min(2000, Math.max(0, right))));
      }
      if (up > 0) {
        formData.append("up", String(Math.min(2000, Math.max(0, up))));
      }
      if (down > 0) {
        formData.append("down", String(Math.min(2000, Math.max(0, down))));
      }

      if (options.prompt) {
        formData.append("prompt", options.prompt);
      }
      if (options.creativity !== undefined) {
        formData.append("creativity", String(Math.min(1, Math.max(0, options.creativity))));
      }

      const response = await fetch(`${this.baseUrl}/v2beta/stable-image/edit/outpaint`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "image/*",
        },
        body: formData,
      });

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
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const seed = response.headers.get("seed");

      return {
        success: true,
        images: [{
          base64,
          seed: seed ? parseInt(seed) : undefined,
        }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const stabilityProvider = new StabilityProvider();
