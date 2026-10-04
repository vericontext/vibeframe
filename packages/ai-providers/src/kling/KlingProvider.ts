import { createHmac } from "node:crypto";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";
import { defaultModel, findModel, modelAliases } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { ProviderError, classifyProviderError, isProviderError, type ProviderErrorKind } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";
import { waitForVideoJob } from "../video/wait.js";

/**
 * Kling model versions on the text2video / image2video endpoints
 * - kling-v3: default (3-15 sec, multi-shot)
 * - kling-v2-6: v2.6 (5 or 10 sec)
 * - kling-v2-5-turbo: v2.5 turbo (5 or 10 sec, cheapest)
 *
 * `kling-v3-omni` is not accepted here; it only runs on the omni-video
 * endpoint, which VibeFrame does not call yet.
 */
export type KlingModel = "kling-v3" | "kling-v2-6" | "kling-v2-5-turbo";

/**
 * Resolve a `--kling-model` alias: `v3` (default), `v2.6`, or `v2.5-turbo`.
 * Full model IDs pass through. Unknown aliases throw.
 */
export function resolveKlingModel(alias?: string): KlingModel {
  const model = findModel("kling", "video", alias);
  if (model) return model.id as KlingModel;
  throw new Error(`Unknown Kling model "${alias}". Valid: ${modelAliases("kling", "video").join(", ")}.`);
}

/**
 * Kling takes duration as a string. v3 accepts 3-15 seconds; the v2.x
 * models accept only 5 or 10.
 */
export function klingDuration(model: KlingModel, seconds?: number): string {
  const requested = typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds) : 5;
  if (model === "kling-v3") return String(Math.max(3, Math.min(15, requested)));
  return requested >= 10 ? "10" : "5";
}

/**
 * Kling video generation options
 */
export interface KlingVideoOptions {
  /** Text prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model name */
  model?: KlingModel;
  /** Config for generation (0-1, controls prompt adherence) */
  cfg?: number;
  /** Generation mode: std (standard, faster) or pro (professional, higher quality) */
  mode?: "std" | "pro";
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Duration in seconds: 5 or 10 */
  duration?: "5" | "10";
  /** Reference image URL or base64 for image-to-video */
  imageUrl?: string;
  /** Image tail for end frame */
  imageTail?: string;
  /** Camera control settings */
  cameraControl?: {
    type?: "simple" | "down_back" | "forward_up" | "right_turn_forward" | "left_turn_forward";
    horizontal?: number;
    vertical?: number;
    pan?: number;
    tilt?: number;
    roll?: number;
    zoom?: number;
  };
}

/**
 * Kling task response
 */
interface KlingTaskResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    created_at?: number;
    updated_at?: number;
    task_result?: {
      videos?: Array<{
        id: string;
        url: string;
        duration: string;
      }>;
    };
  };
}

/**
 * Kling AI provider for high-quality video generation
 *
 * Supported models (v2.5+):
 * - kling-v3: default (3-15 sec, multi-shot)
 * - kling-v2-6: High quality (5 or 10 sec)
 * - kling-v2-5-turbo: Fastest, cheapest (5 or 10 sec)
 *
 * Note: image2video requires image URL (not base64) for all supported models.
 * Use ImgBB or similar service to upload base64 images before passing to Kling.
 */
/**
 * Options for video extension
 */
export interface KlingVideoExtendOptions {
  /** Text prompt for continuation */
  prompt?: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Duration in seconds: 5 or 10 */
  duration?: "5" | "10";
}

/** Default model for Kling - v2.5 turbo is fastest */
const DEFAULT_MODEL = defaultModel("kling", "video").id as KlingModel;

/** All v2.5+ models support std mode */
const STD_MODE_MODELS: KlingModel[] = ["kling-v2-5-turbo", "kling-v2-6", "kling-v3"];

type KlingTaskType = "text2video" | "image2video" | "video-extend";

const STATUS: Record<KlingTaskResponse["data"]["task_status"], VideoJobState["status"]> = {
  submitted: "pending",
  processing: "processing",
  succeed: "completed",
  failed: "failed",
};

/**
 * Kling's service codes (https://kling.ai/document-api/api/get-started/error-codes).
 * They arrive with misleading HTTP statuses (exhausted credits are 429), and
 * sometimes inside a 200 body, so they decide the kind on their own.
 */
export function klingErrorKind(code: string | number | undefined): ProviderErrorKind | undefined {
  const n = Number(code);
  if (!Number.isInteger(n) || n === 0) return undefined;
  if (n >= 1000 && n <= 1004) return "auth";
  if (n >= 1100 && n <= 1102) return "quota";
  if (n === 1103 || n === 1304) return "auth";
  if (n === 1200 || n === 1201) return "invalid-request";
  if (n === 1202 || n === 1203) return "not-found";
  if (n === 1300 || n === 1301) return "moderation";
  if (n === 1302 || n === 1303) return "rate-limit";
  if (n >= 5000 && n <= 5002) return "provider";
  return undefined;
}

export class KlingProvider implements AIProvider, VideoGenerator {
  id = "kling";
  name = "Kling AI";
  description = "AI video generation with Kling v3";
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "video-extend"];
  iconUrl = "/icons/kling.svg";
  isAvailable = true;
  /** Kling's legacy endpoints take image URLs only. */
  readonly imageInput = "url" as const;

  private apiKey?: string;
  private accessKey?: string;
  private secretKey?: string;
  private baseUrl = "https://api.klingai.com/v1";
  private pollingInterval = 3000;

  async initialize(config: ProviderConfig): Promise<void> {
    // Either a single API key, or the legacy "access_key:secret_key" pair.
    if (config.apiKey) {
      const parts = config.apiKey.split(":");
      if (parts.length === 2 && parts[0] && parts[1]) {
        this.accessKey = parts[0];
        this.secretKey = parts[1];
      } else {
        this.apiKey = config.apiKey;
      }
    }
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!(this.apiKey || (this.accessKey && this.secretKey));
  }

  // ── VideoGenerator ────────────────────────────────────────────────────

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    const token = this.token();
    if (request.from?.kind === "edit") {
      throw new ProviderError({ kind: "unsupported", provider: this.id, message: "Kling cannot edit an earlier video; it can extend one." });
    }
    if (request.from) return this.submitExtend(request, token);

    const model = resolveVideoModel(this.id, request.model).id as KlingModel;
    // Kling's legacy endpoints take an image URL, not base64 or a data URI.
    if (request.image && !/^https?:\/\//.test(request.image)) {
      throw this.invalid("Kling needs an image URL for image-to-video, not base64. Upload the image first.");
    }
    const mode = (request.providerOptions?.mode as "std" | "pro" | undefined) ?? "std";
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      model_name: model,
      mode: STD_MODE_MODELS.includes(model) ? mode : "pro",
      aspect_ratio: request.aspectRatio === "9:16" || request.aspectRatio === "1:1" ? request.aspectRatio : "16:9",
      duration: klingDuration(model, request.durationSec),
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (typeof request.providerOptions?.cfg === "number") body.cfg_scale = request.providerOptions.cfg;
    if (request.image) body.image = request.image;

    const type: KlingTaskType = request.image ? "image2video" : "text2video";
    const taskId = await this.post(`/videos/${type}`, body, token);
    return { provider: this.id, id: taskId, model, submittedAt: new Date().toISOString(), meta: { type } };
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    const type = job.meta?.type as KlingTaskType | undefined;
    if (!type) {
      // A bare task ID (typed in by a user) does not say which endpoint
      // created it; Kling answers "not found" on the wrong one.
      try {
        return await this.getVideoJob({ ...job, meta: { ...job.meta, type: "text2video" } });
      } catch (error) {
        if (!(isProviderError(error) && error.kind === "not-found")) throw error;
        return this.getVideoJob({ ...job, meta: { ...job.meta, type: "image2video" } });
      }
    }
    const response = await providerRequest(this.id, `${this.baseUrl}/videos/${type}/${job.id}`, {
      headers: this.headers(this.token()),
    }, this.requestOptions());
    const { data } = this.unwrap((await response.json()) as KlingTaskResponse);
    const state: VideoJobState = { status: STATUS[data.task_status] ?? "pending" };
    const video = data.task_result?.videos?.[0];
    if (data.task_status === "succeed" && video) {
      state.videoUrl = video.url;
      state.outputId = video.id;
      state.durationSec = parseFloat(video.duration);
    }
    if (data.task_status === "failed") {
      state.error = classifyProviderError({ provider: this.id, message: data.task_status_msg || "Generation failed" }).toJSON();
    }
    return state;
  }

  async downloadVideo(_job: VideoJob, state: VideoJobState): Promise<Uint8Array> {
    if (!state.videoUrl) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: "Kling job has no video to download." });
    }
    const response = await providerRequest(this.id, state.videoUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Extend a finished Kling video (`POST /videos/video-extend` with its `video_id`). */
  private async submitExtend(request: VideoRequest, token: string): Promise<VideoJob> {
    const source = request.from!.job;
    if (source.provider !== this.id) {
      throw this.invalid(`Kling can only extend a Kling video, not a ${source.provider} job.`);
    }
    const sourceState = await this.getVideoJob(source);
    if (sourceState.status !== "completed" || !sourceState.outputId) {
      throw this.invalid(`Kling job ${source.id} has no finished video to extend (status: ${sourceState.status}).`);
    }
    const body: Record<string, unknown> = {
      video_id: sourceState.outputId,
      duration: request.durationSec !== undefined && request.durationSec >= 10 ? "10" : "5",
    };
    if (request.prompt) body.prompt = request.prompt;
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    const taskId = await this.post("/videos/video-extend", body, token);
    return { provider: this.id, id: taskId, model: source.model, submittedAt: new Date().toISOString(), meta: { type: "video-extend" } };
  }

  // ── Older interface, kept until every caller uses the contract ────────

  async generateVideo(prompt: string, options?: GenerateOptions): Promise<VideoResult> {
    try {
      const image = options?.referenceImage;
      if (image !== undefined && typeof image !== "string") {
        throw this.invalid("Kling needs an image URL for image-to-video, not a Blob. Upload the image first.");
      }
      const job = await this.submitVideo({
        prompt,
        model: options?.model,
        durationSec: options?.duration,
        aspectRatio: options?.aspectRatio,
        negativePrompt: options?.negativePrompt,
        image,
        providerOptions: { mode: options?.mode, cfg: options?.cfg },
      });
      return { id: job.id, status: "pending", progress: 0 };
    } catch (error) {
      return { id: "", status: "failed", error: this.legacyMessage(error) };
    }
  }

  /**
   * Generate video from image (image-to-video)
   */
  async generateFromImage(
    imageData: string | Blob,
    prompt: string,
    options?: Omit<KlingVideoOptions, "prompt" | "imageUrl">
  ): Promise<VideoResult> {
    return this.generateVideo(prompt, {
      prompt,
      referenceImage: imageData,
      aspectRatio: options?.aspectRatio as GenerateOptions["aspectRatio"],
      duration: options?.duration ? parseInt(options.duration) : undefined,
      negativePrompt: options?.negativePrompt,
    });
  }

  async getGenerationStatus(id: string, type: "text2video" | "image2video" = "text2video"): Promise<VideoResult> {
    return this.legacyStatus(id, type);
  }

  async waitForCompletion(
    id: string,
    type: "text2video" | "image2video" = "text2video",
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 600000
  ): Promise<VideoResult> {
    return this.legacyWait(id, type, onProgress, maxWaitMs);
  }

  /**
   * Extend an existing video by its Kling video ID (`VideoResult.videoId`).
   */
  async extendVideo(videoId: string, options?: KlingVideoExtendOptions): Promise<VideoResult> {
    try {
      const body: Record<string, unknown> = { video_id: videoId, duration: options?.duration || "5" };
      if (options?.prompt) body.prompt = options.prompt;
      if (options?.negativePrompt) body.negative_prompt = options.negativePrompt;
      const taskId = await this.post("/videos/video-extend", body, this.token());
      return { id: taskId, status: "pending", progress: 0 };
    } catch (error) {
      return { id: "", status: "failed", error: this.legacyMessage(error) };
    }
  }

  async getExtendStatus(id: string): Promise<VideoResult> {
    return this.legacyStatus(id, "video-extend");
  }

  async waitForExtendCompletion(
    id: string,
    onProgress?: (result: VideoResult) => void,
    maxWaitMs: number = 600000
  ): Promise<VideoResult> {
    return this.legacyWait(id, "video-extend", onProgress, maxWaitMs);
  }

  /** Kling's API has no cancel endpoint. */
  async cancelGeneration(_id: string): Promise<boolean> {
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private token(): string {
    if (this.apiKey) return this.apiKey;
    if (this.accessKey && this.secretKey) return this.generateToken();
    throw new ProviderError({
      kind: "auth",
      provider: this.id,
      message: "Kling API credentials not configured. Set KLING_API_KEY to your Kling API key (or the legacy ACCESS_KEY:SECRET_KEY pair).",
    });
  }

  private generateToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const payload = { iss: this.accessKey, exp: now + 1800, nbf: now - 5 };
    const base64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.secretKey!)
      .update(`${base64Header}.${base64Payload}`)
      .digest("base64url");
    return `${base64Header}.${base64Payload}.${signature}`;
  }

  private headers(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  private requestOptions() {
    return { classify: ({ code }: { code?: string }) => klingErrorKind(code) };
  }

  private async post(path: string, body: Record<string, unknown>, token: string): Promise<string> {
    const response = await providerRequest(this.id, `${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(token),
      body: JSON.stringify(body),
    }, this.requestOptions());
    return this.unwrap((await response.json()) as KlingTaskResponse).data.task_id;
  }

  /** A 200 response can still carry a non-zero service code. */
  private unwrap(response: KlingTaskResponse): KlingTaskResponse {
    if (response.code === 0) return response;
    const kind = klingErrorKind(response.code);
    const message = `${response.message || "Kling API error"} (code ${response.code})`;
    throw kind
      ? new ProviderError({ kind, provider: this.id, code: String(response.code), message })
      : classifyProviderError({ provider: this.id, code: String(response.code), message });
  }

  private invalid(message: string): ProviderError {
    return new ProviderError({ kind: "invalid-request", provider: this.id, message });
  }

  private legacyJob(id: string, type: KlingTaskType): VideoJob {
    return { provider: this.id, id, model: DEFAULT_MODEL, submittedAt: new Date(0).toISOString(), meta: { type } };
  }

  private toVideoResult(id: string, state: VideoJobState): VideoResult {
    return {
      id,
      status: state.status,
      videoUrl: state.videoUrl,
      videoId: state.outputId,
      duration: state.durationSec,
      ...(state.error ? { error: state.error.message } : {}),
    };
  }

  private async legacyStatus(id: string, type: KlingTaskType): Promise<VideoResult> {
    try {
      return this.toVideoResult(id, await this.getVideoJob(this.legacyJob(id, type)));
    } catch (error) {
      return { id, status: "failed", error: this.legacyMessage(error) };
    }
  }

  private async legacyWait(
    id: string,
    type: KlingTaskType,
    onProgress: ((result: VideoResult) => void) | undefined,
    maxWaitMs: number
  ): Promise<VideoResult> {
    try {
      const state = await waitForVideoJob(this, this.legacyJob(id, type), {
        timeoutMs: maxWaitMs,
        intervalMs: this.pollingInterval,
        onProgress: onProgress && ((s) => onProgress(this.toVideoResult(id, s))),
      });
      return this.toVideoResult(id, state);
    } catch (error) {
      return { id, status: "failed", error: this.legacyMessage(error) };
    }
  }

  private legacyMessage(error: unknown): string {
    return isProviderError(error) || error instanceof Error ? error.message : "Unknown error";
  }
}

export const klingProvider = new KlingProvider();
