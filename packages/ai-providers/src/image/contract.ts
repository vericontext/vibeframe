/**
 * The image contract every image provider implements.
 *
 * Image APIs answer in one call, so there is no job: a request goes in and
 * images come back as bytes (providers that return URLs are asked for
 * base64 instead), or a `ProviderError` is thrown. A request with input
 * images is an edit.
 */

export interface ImageInput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ImageRequest {
  prompt: string;
  /** Catalog model ID or alias; the provider's default when omitted. */
  model?: string;
  /** "16:9", "9:16", "1:1", ... Providers map it to their own size field. */
  aspectRatio?: string;
  /** Output size class where the provider has one (Gemini "1K"/"2K"/"4K", Grok "1k"/"2k"). */
  resolution?: string;
  quality?: "low" | "medium" | "high";
  /** Images to produce. Default 1. */
  count?: number;
  /** Input images: present means edit or compose. */
  images?: ImageInput[];
  /** Edit mask (OpenAI only). */
  mask?: Uint8Array;
  /** Provider-specific settings with no shared meaning (Gemini grounding). */
  providerOptions?: Record<string, unknown>;
}

export interface GeneratedImage extends ImageInput {
  /** The prompt the provider actually used, when it rewrites prompts. */
  revisedPrompt?: string;
}

export interface ImageResultSet {
  images: GeneratedImage[];
  /** The catalog model ID that produced them. */
  model: string;
  /** Text the model returned alongside the images (Gemini). */
  text?: string;
}

export interface ImageGenerator {
  /** Catalog provider id ("openai", "gemini", "grok"). */
  readonly imageProvider: string;
  /** Most input images one edit accepts for `model`; 0 means the provider cannot edit. */
  maxEditImages(model?: string): number;
  /** Generate, or edit when `request.images` is set. Throws `ProviderError`. */
  createImage(request: ImageRequest): Promise<ImageResultSet>;
}

/** Base64 to bytes. */
export function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

/** Map an aspect ratio to OpenAI's three GPT Image sizes. */
export function openAiImageSize(aspectRatio?: string): "1024x1024" | "1536x1024" | "1024x1536" | undefined {
  if (!aspectRatio) return undefined;
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!(w > 0 && h > 0)) return undefined;
  return w > h ? "1536x1024" : w < h ? "1024x1536" : "1024x1024";
}
