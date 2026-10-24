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
import type { GeminiMotionOptions, GeminiMotionResult } from "./gemini-motion.js";
import { GEMINI_DEFAULT_TEXT_MODEL, resolveGeminiTextModel } from "./gemini-models.js";
import type { GeminiTextModel } from "./gemini-models.js";
import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { analyzeContent as analyzeContentImpl } from "./gemini-storyboard.js";
import { fromBase64, type ImageGenerator, type ImageRequest, type ImageResultSet } from "../image/contract.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveCatalogModel } from "../video/models.js";
import { geminiGenerateText } from "./gemini-text.js";
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
  success: boolean;
  response?: string;
  model?: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  error?: string;
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
export interface GeminiImageAnalysisResult {
  success: boolean;
  response?: string;
  model?: string;
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  error?: string;
}

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
   * Video analysis options
   */
  async analyzeVideo(
    videoData: Buffer | string,
    prompt: string,
    options: GeminiVideoOptions = {}
  ): Promise<GeminiVideoResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    const modelId = resolveGeminiTextModel(options.model);

    try {
      // Build the video part
      let videoPart: Record<string, unknown>;

      if (typeof videoData === "string") {
        // YouTube URL or file URI
        if (videoData.includes("youtube.com") || videoData.includes("youtu.be")) {
          videoPart = {
            file_data: { file_uri: videoData },
          };
        } else {
          // Assume it's a file URI from Files API
          videoPart = {
            file_data: { file_uri: videoData },
          };
        }
      } else {
        // Buffer - inline data
        videoPart = {
          inline_data: {
            mime_type: options.mimeType || "video/mp4",
            data: videoData.toString("base64"),
          },
        };
      }

      // Add video metadata if specified
      const videoMetadata: Record<string, unknown> = {};
      if (options.fps !== undefined) {
        videoMetadata.fps = options.fps;
      }
      if (options.startOffset !== undefined) {
        videoMetadata.start_offset = `${options.startOffset}s`;
      }
      if (options.endOffset !== undefined) {
        videoMetadata.end_offset = `${options.endOffset}s`;
      }

      if (Object.keys(videoMetadata).length > 0) {
        videoPart.video_metadata = videoMetadata;
      }

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: 8192,
      };

      if (options.lowResolution) {
        generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";
      }

      const payload = {
        contents: [{
          parts: [
            videoPart,
            { text: prompt },
          ],
        }],
        generationConfig,
      };

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No response from model",
        };
      }

      const textParts = parts.filter((p) => p.text).map((p) => p.text);
      const responseText = textParts.join("\n");

      return {
        success: true,
        response: responseText,
        model: modelId,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Analyze image(s) using Gemini vision
   * Supports single or multiple images for comparison analysis
   */
  async analyzeImage(
    imageData: Buffer | Buffer[],
    prompt: string,
    options: GeminiImageAnalysisOptions = {}
  ): Promise<GeminiImageAnalysisResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    const modelId = resolveGeminiTextModel(options.model);

    try {
      // Build image parts
      const buffers = Array.isArray(imageData) ? imageData : [imageData];
      const imageParts: Array<Record<string, unknown>> = buffers.map((buf) => ({
        inline_data: {
          mime_type: "image/png",
          data: buf.toString("base64"),
        },
      }));

      // Build generation config
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: 8192,
      };

      if (options.lowResolution) {
        generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";
      }

      const payload = {
        contents: [{
          parts: [
            ...imageParts,
            { text: prompt },
          ],
        }],
        generationConfig,
      };

      const response = await fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No response from model",
        };
      }

      const textParts = parts.filter((p) => p.text).map((p) => p.text);
      const responseText = textParts.join("\n");

      return {
        success: true,
        response: responseText,
        model: modelId,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
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

      const response = await fetch(
        `${this.baseUrl}/models/${GEMINI_DEFAULT_TEXT_MODEL}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 1024,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Gemini API error:", error);
        return this.fallbackAutoEdit(clips, instruction);
      }

      const data = await response.json() as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        type: string;
        description: string;
        clipIds: string[];
        params: Record<string, unknown>;
        confidence: number;
      }>;

      return suggestions.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type as EditSuggestion["type"],
        description: s.description,
        clipIds: s.clipIds,
        params: s.params,
        confidence: s.confidence,
      }));
    } catch (error) {
      console.error("Gemini autoEdit error:", error);
      return this.fallbackAutoEdit(clips, instruction);
    }
  }

  /**
   * Fallback to simple pattern matching when API fails
   */
  private fallbackAutoEdit(clips: Clip[], instruction: string): EditSuggestion[] {
    const suggestions: EditSuggestion[] = [];
    const lowerInstruction = instruction.toLowerCase();

    if (lowerInstruction.includes("trim") || lowerInstruction.includes("shorten")) {
      const timeMatch = lowerInstruction.match(/(\d+)\s*(s|sec|seconds?)/);
      const duration = timeMatch ? parseInt(timeMatch[1]) : 3;

      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "trim",
          description: `Trim clip to ${duration} seconds`,
          clipIds: [clip.id],
          params: { newDuration: duration },
          confidence: 0.8,
        });
      });
    }

    if (lowerInstruction.includes("fade")) {
      const isFadeOut = lowerInstruction.includes("out");
      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "add-effect",
          description: `Add fade ${isFadeOut ? "out" : "in"} effect`,
          clipIds: [clip.id],
          params: {
            effectType: isFadeOut ? "fadeOut" : "fadeIn",
            duration: 1,
          },
          confidence: 0.9,
        });
      });
    }

    return suggestions;
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
  ): Promise<GeminiMotionResult> {
    if (!this.apiKey) {
      return { success: false, error: "Google API key not configured" };
    }
    return generateMotionImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, description, options);
  }

  /**
   * Refine an existing Remotion motion graphic component based on instructions.
   */
  async refineMotion(
    existingCode: string,
    instructions: string,
    options: GeminiMotionOptions = {}
  ): Promise<GeminiMotionResult> {
    if (!this.apiKey) {
      return { success: false, error: "Google API key not configured" };
    }
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
    if (!this.apiKey) return [];
    return analyzeContentImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, content, targetDuration, options);
  }
}

export const geminiProvider = new GeminiProvider();
