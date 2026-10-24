import type { AIProvider, AICapability, ProviderConfig } from "../interface/types.js";
import { defaultModel, findModel, modelAliases } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { fromBase64, type ImageGenerator, type ImageRequest, type ImageResultSet } from "../image/contract.js";
import { resolveCatalogModel } from "../video/models.js";
import { ProviderError, classifyProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";

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
export class GrokProvider implements AIProvider, VideoGenerator, ImageGenerator {
  id = "grok";
  readonly imageProvider = "grok";
  readonly imageInput = "either" as const;
  name = "xAI Grok Imagine";
  description = "AI video generation with Grok Imagine (native audio, 1-15 sec)";
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "text-to-image", "image-editing"];
  iconUrl = "/icons/xai.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.x.ai/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── ImageGenerator ────────────────────────────────────────────────────

  /** Grok Imagine edits one image at a time. */
  maxEditImages(): number {
    return 1;
  }

  async createImage(request: ImageRequest): Promise<ImageResultSet> {
    const apiKey = this.requireKey();
    const model = resolveCatalogModel(this.imageProvider, "image", request.model).id as GrokImageModel;
    const inputs = request.images ?? [];
    if (inputs.length > 1) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.imageProvider,
        message: `Grok Imagine edits one image at a time, not ${inputs.length}.`,
      });
    }
    // Grok takes quality low/medium/auto; the 2.0 model defaults to medium.
    const quality =
      request.quality === "low" || request.quality === "medium"
        ? request.quality
        : model === "grok-imagine-image-2.0"
          ? "medium"
          : undefined;
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: inputs.length ? 1 : (request.count ?? 1),
      response_format: "b64_json",
      ...(quality ? { quality } : {}),
      ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
    };
    if (inputs.length) {
      const [img] = inputs;
      body.image = { url: `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`, type: "image_url" };
    } else if (request.resolution) {
      body.resolution = request.resolution.toLowerCase();
    }
    const response = await providerRequest(this.imageProvider, `${this.baseUrl}/images/${inputs.length ? "edits" : "generations"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { data?: Array<{ b64_json?: string }> };
    const images = (data.data ?? [])
      .filter((img) => img.b64_json)
      .map((img) => ({ bytes: fromBase64(img.b64_json!), mimeType: "image/jpeg" }));
    if (images.length === 0) {
      throw new ProviderError({ kind: "provider", provider: this.imageProvider, message: "Grok returned no image." });
    }
    return { images, model };
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
}

export const grokProvider = new GrokProvider();
