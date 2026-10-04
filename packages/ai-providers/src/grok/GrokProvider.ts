import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";
import type { ImageResult } from "../openai-image/OpenAIImageProvider.js";
import { defaultModel, findModel, modelAliases } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { ProviderError, classifyProviderError, isProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";
import { waitForVideoJob } from "../video/wait.js";

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
  const model = findModel("grok", "video", alias);
  if (model) return model.id as GrokVideoModel;
  throw new Error(`Unknown Grok video model "${alias}". Valid: ${modelAliases("grok", "video").join(", ")}.`);
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
  // Unknown aliases (including Gemini-only ones like "flash") use the base model.
  const model = (findModel("grok", "image", alias) ?? defaultModel("grok", "image")).id as GrokImageModel;
  return model === "grok-imagine-image-2.0" ? { model, quality: "medium" } : { model };
}

/** Default model */
const DEFAULT_MODEL = defaultModel("grok", "video").id as GrokVideoModel;

/**
 * Edits and extensions run on classic `grok-imagine-video` only: `-1.5` and
 * `-1.5-lite` answer 400 "Video extension is not supported for this model"
 * (probe, 2026-10-04).
 */
const CONTINUATION_MODEL: GrokVideoModel = "grok-imagine-video";

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
const GROK_STATUS: Record<GrokStatusResponse["status"], VideoJobState["status"]> = {
  pending: "pending",
  done: "completed",
  expired: "failed",
  failed: "failed",
};

interface GrokStatusResponse {
  status: "pending" | "done" | "expired" | "failed";
  progress?: number;
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
export class GrokProvider implements AIProvider, VideoGenerator {
  id = "grok";
  readonly imageInput = "either" as const;
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

  // ── VideoGenerator ────────────────────────────────────────────────────

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    const apiKey = this.requireKey();
    const model = resolveVideoModel(this.id, request.model ?? (request.from ? CONTINUATION_MODEL : undefined))
      .id as GrokVideoModel;
    if (request.from && model !== CONTINUATION_MODEL) {
      throw new ProviderError({
        kind: "unsupported",
        provider: this.id,
        message: `Grok ${request.from.kind}s videos with ${CONTINUATION_MODEL} only, not ${model}.`,
      });
    }
    let path: string;
    const body: Record<string, unknown> = { model, prompt: request.prompt };

    if (request.from) {
      // Edit revises an earlier clip; extension adds 2-10 s after it. Both
      // take the earlier clip's video URL (docs: /videos/edits, /videos/extensions).
      const source = await this.continuationSource(request.from.job);
      body.video = { url: source };
      if (request.from.kind === "extend") {
        path = "/videos/extensions";
        body.duration = Math.round(Math.min(10, Math.max(2, request.durationSec ?? 6)));
      } else {
        path = "/videos/edits";
      }
    } else {
      path = "/videos/generations";
      // xAI rejects float durations with a 422 deserialization error.
      body.duration = Math.round(Math.min(15, Math.max(1, request.durationSec || 5)));
      body.aspect_ratio = request.aspectRatio || "16:9";
      // Without `resolution` xAI renders 480p.
      body.resolution = GROK_VIDEO_RESOLUTIONS.includes(request.resolution ?? "")
        ? request.resolution
        : DEFAULT_VIDEO_RESOLUTION;
      if (typeof request.generateAudio === "boolean") body.generate_audio = request.generateAudio;
      // xAI takes the image as an object, for both URLs and data URIs.
      if (request.image) body.image = { url: request.image };
    }

    const response = await providerRequest(this.id, `${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as GrokCreateResponse;
    return { provider: this.id, id: data.request_id, model, submittedAt: new Date().toISOString() };
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    const apiKey = this.requireKey();
    const response = await providerRequest(this.id, `${this.baseUrl}/videos/${job.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await response.json()) as GrokStatusResponse;
    const state: VideoJobState = { status: GROK_STATUS[data.status] ?? "pending", progress: data.progress };
    if (data.status === "done") {
      state.videoUrl = data.video?.url;
      state.durationSec = data.video?.duration;
    }
    if (data.status === "expired") {
      state.error = new ProviderError({ kind: "timeout", provider: this.id, message: "Grok generation expired" }).toJSON();
    }
    if (data.status === "failed") {
      state.error = classifyProviderError({
        provider: this.id,
        code: data.error?.code,
        message: `Generation failed: ${data.error?.message ?? data.error?.code ?? "unknown error"}`,
      }).toJSON();
    }
    return state;
  }

  async downloadVideo(_job: VideoJob, state: VideoJobState): Promise<Uint8Array> {
    if (!state.videoUrl) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: "Grok job has no video to download." });
    }
    const response = await providerRequest(this.id, state.videoUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The finished video URL an edit or extension starts from. */
  private async continuationSource(job: VideoJob): Promise<string> {
    if (job.provider !== this.id) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.id,
        message: `Grok can only continue a Grok video, not a ${job.provider} job.`,
      });
    }
    const state = await this.getVideoJob(job);
    if (state.status !== "completed" || !state.videoUrl) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.id,
        message: `Grok job ${job.id} has no finished video to continue (status: ${state.status}).`,
      });
    }
    return state.videoUrl;
  }

  // ── Older interface, kept until every caller uses the contract ────────

  async generateVideo(prompt: string, options?: GenerateOptions): Promise<VideoResult> {
    try {
      const job = await this.submitVideo({
        prompt,
        model: options?.model,
        durationSec: options?.duration,
        aspectRatio: options?.aspectRatio,
        resolution: options?.resolution,
        generateAudio: options?.generateAudio,
        image: options?.referenceImage as string | undefined,
      });
      return { id: job.id, status: "pending" };
    } catch (error) {
      return { id: "", status: "failed", error: this.legacyMessage(error) };
    }
  }

  async getGenerationStatus(id: string): Promise<VideoResult> {
    try {
      return this.toVideoResult(id, await this.getVideoJob(this.legacyJob(id)));
    } catch (error) {
      return { id, status: "failed", error: this.legacyMessage(error) };
    }
  }

  async waitForCompletion(
    id: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 300000
  ): Promise<VideoResult> {
    try {
      const state = await waitForVideoJob(this, this.legacyJob(id), {
        timeoutMs: maxWaitMs,
        intervalMs: this.pollingInterval,
        onProgress: onProgress && ((s) => onProgress(this.toVideoResult(id, s))),
      });
      return this.toVideoResult(id, state);
    } catch (error) {
      return { id, status: "failed", error: this.legacyMessage(error) };
    }
  }

  /**
   * Best-effort cancel. xAI does not document a video cancel endpoint, so
   * this is not part of the `VideoGenerator` contract for Grok.
   */
  async cancelGeneration(id: string): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/videos/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderError({
        kind: "auth",
        provider: this.id,
        message: "xAI API key not configured. Set XAI_API_KEY environment variable.",
      });
    }
    return this.apiKey;
  }

  private legacyJob(id: string): VideoJob {
    return { provider: this.id, id, model: DEFAULT_MODEL, submittedAt: new Date(0).toISOString() };
  }

  private toVideoResult(id: string, state: VideoJobState): VideoResult {
    return {
      id,
      status: state.status,
      videoUrl: state.videoUrl,
      progress: state.progress,
      ...(state.error ? { error: state.error.message } : {}),
    };
  }

  private legacyMessage(error: unknown): string {
    return isProviderError(error) || error instanceof Error ? error.message : "Unknown error";
  }
}

export const grokProvider = new GrokProvider();
