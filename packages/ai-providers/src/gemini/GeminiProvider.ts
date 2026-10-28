import type { Clip } from "@vibeframe/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  EditSuggestion,
} from "../interface/types.js";

import {
  generateMotion as generateMotionImpl,
  refineMotion as refineMotionImpl,
  GEMINI_MOTION_MODELS,
} from "./gemini-motion.js";
import type { GeminiMotionOptions } from "./gemini-motion.js";
import { GEMINI_DEFAULT_TEXT_MODEL, resolveGeminiTextModel } from "./gemini-models.js";
import type { GeminiTextModel } from "./gemini-models.js";
import type { RemotionComponent, StoryboardSegment } from "../claude/ClaudeProvider.js";
import { analyzeContent as analyzeContentImpl } from "./gemini-storyboard.js";
import { fromBase64, type ImageGenerator, type ImageRequest, type ImageResultSet } from "../image/contract.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveCatalogModel } from "../video/models.js";
import { geminiGenerateContent, geminiGenerateText, type GeminiPart } from "./gemini-text.js";
import { isText, parseJsonReply } from "../shared/json-reply.js";
import type { TextGenerator, TextRequest, TextResult } from "../text/contract.js";

/**
 * Video analysis options for Gemini
 */
export interface GeminiVideoOptions {
  /** Model to use for analysis */
  model?: GeminiTextModel;
  /** MIME type of the video (for inline data) */
  mimeType?: string;
  /** Frames per second to sample (default: 1) */
  fps?: number;
  /** Start offset in seconds for clipping */
  startOffset?: number;
  /** End offset in seconds for clipping */
  endOffset?: number;
  /** Use low resolution mode (fewer tokens) */
  lowResolution?: boolean;
}

/**
 * Video analysis result
 */
export interface GeminiVideoResult {
  response: string;
  model: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
}

/**
 * Image analysis options for Gemini vision
 */
export interface GeminiImageAnalysisOptions {
  /** Model to use for analysis */
  model?: GeminiTextModel;
  /** Use low resolution mode (fewer tokens) */
  lowResolution?: boolean;
}

/**
 * Image analysis result
 */
export type GeminiImageAnalysisResult = GeminiVideoResult;

/** What each Gemini image model accepts, from Google's image-generation guide. */
const GEMINI_IMAGE_CAPABILITIES: Record<string, { sizes: string[]; webSearch: boolean; imageSearch: boolean; maxInputs: number }> = {
  "gemini-nano-banana-2.1": { sizes: ["1K", "2K", "4K"], webSearch: true, imageSearch: true, maxInputs: 14 },
  "gemini-3.1-flash-image": { sizes: ["512px", "1K", "2K", "4K"], webSearch: true, imageSearch: true, maxInputs: 14 },
  "gemini-3.1-flash-lite-image": { sizes: ["1K"], webSearch: false, imageSearch: false, maxInputs: 14 },
  "gemini-3-pro-image": { sizes: ["1K", "2K", "4K"], webSearch: true, imageSearch: false, maxInputs: 14 },
};

function geminiImageCapabilities(modelId: string) {
  return GEMINI_IMAGE_CAPABILITIES[modelId] ?? { sizes: ["1K"], webSearch: false, imageSearch: false, maxInputs: 3 };
}

/**
 * Google Gemini provider for image generation and editing, vision, and text
 * - Image: Nano Banana 2.1 (gemini-nano-banana-2.1) / Nano Banana Pro (gemini-3-pro-image)
 */
export class GeminiProvider implements AIProvider, ImageGenerator, TextGenerator {
  id = "gemini";
  name = "Google Gemini";
  description = "Image (Nano Banana), vision, and text generation";
  capabilities: AICapability[] = ["text-to-image", "auto-edit", "vision"];
  iconUrl = "/icons/gemini.svg";
  isAvailable = true;
  readonly imageProvider = "gemini";
  readonly textProvider = "gemini";

  private apiKey?: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** One bounded model call; see the text contract. Throws `ProviderError`. */
  async generateText(request: TextRequest): Promise<TextResult> {
    return geminiGenerateText({ apiKey: this.apiKey, baseUrl: this.baseUrl }, request);
  }

  // ── ImageGenerator ────────────────────────────────────────────────────

  /** Nano Banana edits take up to 3 input images, Pro up to 14. */
  maxEditImages(model?: string): number {
    return geminiImageCapabilities(resolveCatalogModel("gemini", "image", model).id).maxInputs;
  }

  async createImage(request: ImageRequest): Promise<ImageResultSet> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.imageProvider, message: "Google API key not configured" });
    }
    const modelId = resolveCatalogModel(this.imageProvider, "image", request.model).id;
    const caps = geminiImageCapabilities(modelId);
    const inputs = request.images ?? [];
    if (inputs.length > this.maxEditImages(modelId)) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.imageProvider,
        message: `${modelId} edits take up to ${this.maxEditImages(modelId)} images, not ${inputs.length}.`,
      });
    }

    const imageConfig: Record<string, string> = {};
    if (request.aspectRatio) imageConfig.aspectRatio = request.aspectRatio;
    else if (inputs.length === 0) imageConfig.aspectRatio = "1:1";
    if (request.resolution) {
      if (!caps.sizes.includes(request.resolution)) {
        throw new ProviderError({
          kind: "invalid-request",
          provider: this.imageProvider,
          message: `${modelId} renders ${caps.sizes.join(", ")}, not ${request.resolution}.`,
        });
      }
      imageConfig.imageSize = request.resolution;
    }
    const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
    if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig;
    if (request.providerOptions?.thinkingConfig) generationConfig.thinkingConfig = request.providerOptions.thinkingConfig;

    const payload: Record<string, unknown> = {
      contents: [
        {
          parts: [
            { text: request.prompt },
            ...inputs.map((img) => ({ inlineData: { mimeType: img.mimeType, data: Buffer.from(img.bytes).toString("base64") } })),
          ],
        },
      ],
      generationConfig,
    };
    const wantsImageSearch = request.providerOptions?.imageSearchGrounding === true;
    const wantsWebSearch = request.providerOptions?.grounding === true;
    if ((wantsImageSearch && !caps.imageSearch) || (wantsWebSearch && !caps.webSearch)) {
      throw new ProviderError({
        kind: "unsupported",
        provider: this.imageProvider,
        message: `${modelId} does not support ${wantsImageSearch && !caps.imageSearch ? "Image Search" : "Google Search"} grounding.`,
      });
    }
    if (wantsImageSearch) {
      payload.tools = [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }];
    } else if (wantsWebSearch) {
      payload.tools = [{ googleSearch: {} }];
    }

    // The key goes in a header so it never lands in a URL, log, or error message.
    const response = await providerRequest(this.imageProvider, `${this.baseUrl}/models/${modelId}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string } }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };

    const parts = (data.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought);
    const images = parts
      .filter((part) => part.inlineData)
      .map((part) => ({ bytes: fromBase64(part.inlineData!.data), mimeType: part.inlineData!.mimeType }));
    if (images.length === 0) {
      const blockReason = data.promptFeedback?.blockReason;
      const finishReason = data.candidates?.[0]?.finishReason;
      throw new ProviderError({
        kind: blockReason || finishReason === "SAFETY" || finishReason === "IMAGE_SAFETY" ? "moderation" : "provider",
        provider: this.imageProvider,
        message: blockReason
          ? `Blocked by safety filter: ${blockReason}`
          : `Model returned no image${finishReason ? ` (finishReason: ${finishReason})` : ""}`,
      });
    }
    return { images, model: modelId, text: parts.find((part) => part.text)?.text };
  }

  /**
   * Ask Gemini about a video: inline bytes, a Files API URI, or a YouTube URL.
   * Throws a `ProviderError` on every failure.
   */
  async analyzeVideo(
    videoData: Buffer | string,
    prompt: string,
    options: GeminiVideoOptions = {}
  ): Promise<GeminiVideoResult> {
    const videoMetadata: Record<string, unknown> = {};
    if (options.fps !== undefined) videoMetadata.fps = options.fps;
    if (options.startOffset !== undefined) videoMetadata.start_offset = `${options.startOffset}s`;
    if (options.endOffset !== undefined) videoMetadata.end_offset = `${options.endOffset}s`;
    const metadata = Object.keys(videoMetadata).length > 0 ? { video_metadata: videoMetadata } : {};
    const videoPart: GeminiPart = typeof videoData === "string"
      ? { file_data: { file_uri: videoData }, ...metadata }
      : { inline_data: { mime_type: options.mimeType || "video/mp4", data: videoData.toString("base64") }, ...metadata };
    return this.analyze([videoPart, { text: prompt }], options);
  }

  /**
   * Ask Gemini about one image or several (for comparison).
   * Throws a `ProviderError` on every failure.
   */
  async analyzeImage(
    imageData: Buffer | Buffer[],
    prompt: string,
    options: GeminiImageAnalysisOptions = {}
  ): Promise<GeminiImageAnalysisResult> {
    const buffers = Array.isArray(imageData) ? imageData : [imageData];
    const imageParts: GeminiPart[] = buffers.map((buf) => ({
      inline_data: { mime_type: "image/png", data: buf.toString("base64") },
    }));
    return this.analyze([...imageParts, { text: prompt }], options);
  }

  private async analyze(
    parts: GeminiPart[],
    options: { model?: string; lowResolution?: boolean }
  ): Promise<GeminiVideoResult> {
    const result = await geminiGenerateContent({ apiKey: this.apiKey, baseUrl: this.baseUrl }, {
      model: resolveGeminiTextModel(options.model),
      contents: [{ role: "user", parts }],
      maxOutputTokens: 8192,
      lowResolution: options.lowResolution,
    });
    return {
      response: result.text,
      model: result.model,
      promptTokens: result.promptTokens,
      responseTokens: result.responseTokens,
      totalTokens: result.totalTokens,
    };
  }

  /** Suggest timeline edits for an instruction. Throws a `ProviderError` on every failure. */
  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    const clipsInfo = clips.map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      duration: clip.duration,
      effects: clip.effects?.map((e) => e.type) || [],
    }));

    const prompt = `You are a video editing assistant. Analyze the following clips and user instruction to suggest edits.

Clips:
${JSON.stringify(clipsInfo, null, 2)}

User instruction: "${instruction}"

Respond with a JSON array of edit suggestions. Each suggestion should have:
- type: one of "trim", "cut", "add-effect", "reorder", "delete", "split", "merge"
- description: brief explanation of the edit
- clipIds: array of clip IDs to apply this edit to
- params: object with parameters for the edit (e.g., newDuration, effectType, startTime)
- confidence: number 0-1 indicating confidence

Available effect types: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia

Example response:
[{"type":"trim","description":"Trim intro to 3 seconds","clipIds":["clip-1"],"params":{"newDuration":3},"confidence":0.9}]

Respond with ONLY the JSON array, no other text.`;

    const { text } = await geminiGenerateContent({ apiKey: this.apiKey, baseUrl: this.baseUrl }, {
      model: GEMINI_DEFAULT_TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      maxOutputTokens: 8192,
    });
    const suggestions = parseJsonReply<Array<{
      type: string;
      description: string;
      clipIds: string[];
      params: Record<string, unknown>;
      confidence: number;
    }>>(text, {
      provider: "gemini",
      label: "Gemini",
      task: "edit suggestion",
      shape: "array",
      isValid: (items) => items.every((s) => isText(s?.type) && Array.isArray(s.clipIds)),
    });

    return suggestions.map((s) => ({
      id: crypto.randomUUID(),
      type: s.type as EditSuggestion["type"],
      description: s.description,
      clipIds: s.clipIds,
      params: s.params ?? {},
      confidence: s.confidence,
    }));
  }

  /**
   * Supported model aliases for motion graphic generation
   */
  static readonly MOTION_MODELS = GEMINI_MOTION_MODELS;

  // ---------------------------------------------------------------------------
  // Delegated methods — Motion (gemini-motion.ts)
  // ---------------------------------------------------------------------------

  /**
   * Generate a Remotion motion graphic component using Gemini.
   * Mirrors ClaudeProvider.generateMotion but calls the Gemini generateContent API.
   */
  async generateMotion(
    description: string,
    options: GeminiMotionOptions = {}
  ): Promise<RemotionComponent> {
    return generateMotionImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, description, options);
  }

  /**
   * Refine an existing Remotion motion graphic component based on instructions.
   */
  async refineMotion(
    existingCode: string,
    instructions: string,
    options: GeminiMotionOptions = {}
  ): Promise<RemotionComponent> {
    return refineMotionImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, existingCode, instructions, options);
  }

  /**
   * Generate a storyboard from script content using the default Gemini Flash model.
   * Alternative to ClaudeProvider.analyzeContent for when Claude is unavailable.
   */
  async analyzeContent(
    content: string,
    targetDuration?: number,
    options?: { creativity?: "low" | "high" }
  ): Promise<StoryboardSegment[]> {
    return analyzeContentImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, content, targetDuration, options);
  }
}

export const geminiProvider = new GeminiProvider();
