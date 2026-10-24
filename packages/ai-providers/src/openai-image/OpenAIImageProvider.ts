import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";
import { defaultModel } from "../catalog/catalog.js";
import { fromBase64, openAiImageSize, type ImageGenerator, type ImageRequest, type ImageResultSet } from "../image/contract.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveCatalogModel } from "../video/models.js";

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

/** Default text-to-image model. */
export const OPENAI_IMAGE_DEFAULT_MODEL = defaultModel("openai", "image").id as GPTImageModel;

/**
 * OpenAI Image provider (GPT Image 1.5 / GPT Image 2 / DALL-E)
 */
export class OpenAIImageProvider implements AIProvider, ImageGenerator {
  id = "openai-image";
  name = "OpenAI GPT Image";
  description = "AI image generation with GPT Image 1.5 (default) and GPT Image 2 (opt-in)";
  capabilities: AICapability[] = ["text-to-image", "background-removal", "image-editing"];
  iconUrl = "/icons/openai.svg";
  isAvailable = true;
  readonly imageProvider = "openai";

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
  // ── ImageGenerator ────────────────────────────────────────────────────

  /** GPT Image edits take up to 16 input images. */
  maxEditImages(): number {
    return 16;
  }

  async createImage(request: ImageRequest): Promise<ImageResultSet> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.imageProvider, message: "OpenAI API key not configured" });
    }
    const model = resolveCatalogModel(this.imageProvider, "image", request.model).id;
    const size = openAiSize(request);
    let response: Response;
    if (request.images?.length) {
      if (request.images.length > this.maxEditImages()) {
        throw new ProviderError({
          kind: "invalid-request",
          provider: this.imageProvider,
          message: `GPT Image edits take up to ${this.maxEditImages()} images, not ${request.images.length}.`,
        });
      }
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", request.prompt);
      for (const image of request.images) {
        form.append("image[]", new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), "image.png");
      }
      if (request.mask) form.append("mask", new Blob([new Uint8Array(request.mask)], { type: "image/png" }), "mask.png");
      if (request.quality) form.append("quality", request.quality);
      if (size) form.append("size", size);
      if (request.count) form.append("n", String(request.count));
      response = await providerRequest(this.imageProvider, `${this.baseUrl}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } else {
      const body: Record<string, unknown> = {
        model,
        prompt: request.prompt,
        n: request.count ?? 1,
        // GPT Image models take quality low/medium/high and no response_format.
        quality: request.quality ?? "medium",
      };
      if (size) body.size = size;
      response = await providerRequest(this.imageProvider, `${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
    }
    const data = (await response.json()) as { data?: Array<{ b64_json?: string; revised_prompt?: string }> };
    const images = (data.data ?? [])
      .filter((img) => img.b64_json)
      .map((img) => ({ bytes: fromBase64(img.b64_json!), mimeType: "image/png", revisedPrompt: img.revised_prompt }));
    if (images.length === 0) {
      throw new ProviderError({ kind: "provider", provider: this.imageProvider, message: "OpenAI returned no image." });
    }
    return { images, model };
  }
}

export const openaiImageProvider = new OpenAIImageProvider();

/** An explicit `size` wins; otherwise the aspect ratio picks one of the three GPT Image sizes. */
function openAiSize(request: ImageRequest): string | undefined {
  const explicit = request.providerOptions?.size;
  if (typeof explicit === "string" && explicit !== "auto") return explicit;
  return openAiImageSize(request.aspectRatio);
}
