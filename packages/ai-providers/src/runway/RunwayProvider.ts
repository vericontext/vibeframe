import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
} from "../interface/types.js";
import { defaultModel } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { ProviderError, classifyProviderError, isProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";
import { waitForVideoJob } from "../video/wait.js";

/**
 * Runway model versions
 * - gen4.5: Latest flagship model (text-to-video + image-to-video, 12 credits/sec)
 * - gen4_turbo: Previous model (image-to-video only)
 */
export type RunwayModel = "gen4_turbo" | "gen4.5";

/** Default model - Gen-4.5 */
const DEFAULT_MODEL = defaultModel("runway", "video").id as RunwayModel;

/**
 * Runway video generation options
 */
export interface RunwayVideoOptions {
  /** Text prompt describing the video */
  promptText?: string;
  /** Reference image URL or base64 data URI for image-to-video */
  promptImage?: string;
  /** Random seed for reproducibility (0-4294967295) */
  seed?: number;
  /** Model to use */
  model?: RunwayModel;
  /** Duration in seconds (2-10 for gen4.5, 5 or 10 for gen4_turbo) */
  duration?: number;
  /** Aspect ratio */
  ratio?: "16:9" | "9:16";
  /** Enable watermark */
  watermark?: boolean;
}

interface RunwayTaskResponse {
  id: string;
  name?: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED";
  createdAt?: string;
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
}

const RATIOS: Record<string, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "960:960",
};

const STATUS: Record<RunwayTaskResponse["status"], VideoJobState["status"]> = {
  PENDING: "pending",
  RUNNING: "processing",
  SUCCEEDED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  // THROTTLED means queued behind the account's concurrency limit; the
  // task starts on its own, so keep polling.
  THROTTLED: "pending",
};

/**
 * Runway video provider (Gen-4.5 text- and image-to-video).
 *
 * Implements the `VideoGenerator` contract; the older `generateVideo` /
 * `getGenerationStatus` / `waitForCompletion` methods wrap it for callers
 * that have not moved yet.
 */
export class RunwayProvider implements AIProvider, VideoGenerator {
  id = "runway";
  name = "Runway";
  description = "Professional AI video generation with Gen-4.5";
  capabilities: AICapability[] = ["text-to-video", "image-to-video"];
  iconUrl = "/icons/runway.svg";
  isAvailable = true;
  readonly imageInput = "either" as const;

  private static readonly API_VERSION = "2024-11-06";
  private apiKey?: string;
  private baseUrl = "https://api.dev.runwayml.com/v1";
  private pollingInterval = 5000;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── VideoGenerator ────────────────────────────────────────────────────

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    const apiKey = this.requireKey();
    if (request.from) {
      throw new ProviderError({
        kind: "unsupported",
        provider: this.id,
        message: `Runway cannot ${request.from.kind} an earlier video.`,
      });
    }
    const model = resolveVideoModel(this.id, request.model).id as RunwayModel;
    const hasImage = !!request.image;
    const ratio = RATIOS[request.aspectRatio ?? "16:9"];
    if (!ratio) {
      throw this.invalid(`Runway does not support aspect ratio ${request.aspectRatio}. Use 16:9, 9:16, or 1:1 with an image.`);
    }
    // gen4_turbo requires an image; gen4.5 supports text-to-video.
    if (!hasImage && model !== "gen4.5") {
      throw this.invalid(`Runway ${model} requires an input image. Use -i <image> or switch to gen4.5 for text-to-video.`);
    }
    // Gen-4.5 text-to-video only renders 1280:720 and 720:1280; square
    // output needs an input image.
    if (!hasImage && ratio === RATIOS["1:1"]) {
      throw this.invalid(
        "Runway text-to-video supports 16:9 and 9:16 only. Use 16:9 or 9:16, or pass an image (-i) for square output."
      );
    }

    const body: Record<string, unknown> = {
      model,
      promptText: request.prompt,
      ratio,
      duration: this.clampDuration(request.durationSec, model),
    };
    if (hasImage) body.promptImage = request.image;
    if (request.seed !== undefined) body.seed = request.seed;

    const endpoint = hasImage ? "image_to_video" : "text_to_video";
    const response = await providerRequest(this.id, `${this.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: { ...this.headers(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { id: string };
    return { provider: this.id, id: data.id, model, submittedAt: new Date().toISOString() };
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    const apiKey = this.requireKey();
    const response = await providerRequest(this.id, `${this.baseUrl}/tasks/${job.id}`, {
      headers: this.headers(apiKey),
    });
    const task = (await response.json()) as RunwayTaskResponse;
    const state: VideoJobState = {
      status: STATUS[task.status] ?? "pending",
      // Runway reports progress as a 0-1 fraction; the contract uses 0-100.
      progress: typeof task.progress === "number" ? Math.round(task.progress * 100) : undefined,
    };
    if (task.status === "SUCCEEDED" && task.output?.length) {
      state.videoUrl = task.output[0];
    }
    if (task.status === "FAILED") {
      // failureCode tells callers whether a retry can help: SAFETY.INPUT.*
      // never succeeds on retry (and is billed), INTERNAL.* may.
      const reason = task.failure || "Generation failed";
      state.error = classifyProviderError({
        provider: this.id,
        code: task.failureCode,
        message: task.failureCode ? `${reason} (${task.failureCode})` : reason,
      }).toJSON();
    }
    return state;
  }

  /**
   * Cancel a pending or running task. Runway documents cancellation as
   * `DELETE /v1/tasks/{id}` (there is no `/cancel` route).
   */
  async cancelVideoJob(job: VideoJob): Promise<void> {
    const apiKey = this.requireKey();
    await providerRequest(this.id, `${this.baseUrl}/tasks/${job.id}`, {
      method: "DELETE",
      headers: this.headers(apiKey),
    });
  }

  async downloadVideo(_job: VideoJob, state: VideoJobState): Promise<Uint8Array> {
    if (!state.videoUrl) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: "Runway job has no video to download." });
    }
    const response = await providerRequest(this.id, state.videoUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  // ── Older interface, kept until every caller uses the contract ────────

  async generateVideo(prompt: string, options?: GenerateOptions): Promise<VideoResult> {
    try {
      const image = options?.referenceImage;
      const job = await this.submitVideo({
        prompt,
        model: options?.model,
        durationSec: options?.duration,
        aspectRatio: options?.aspectRatio,
        seed: options?.seed,
        image: image === undefined ? undefined : typeof image === "string" ? image : await this.blobToDataUri(image),
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
    promptText: string,
    options?: Omit<RunwayVideoOptions, "promptImage" | "promptText">
  ): Promise<VideoResult> {
    const imageUri = typeof imageData === "string" ? imageData : await this.blobToDataUri(imageData);
    return this.generateVideo(promptText, {
      prompt: promptText,
      referenceImage: imageUri,
      aspectRatio: options?.ratio,
      duration: options?.duration,
      seed: options?.seed,
    });
  }

  async getGenerationStatus(id: string): Promise<VideoResult> {
    try {
      return this.toVideoResult(id, await this.getVideoJob(this.legacyJob(id)));
    } catch (error) {
      return { id, status: "failed", error: this.legacyMessage(error) };
    }
  }

  async cancelGeneration(id: string): Promise<boolean> {
    return this.deleteTask(id);
  }

  /**
   * Cancel a running task, or delete a finished one (`DELETE /v1/tasks/{id}`).
   */
  async deleteTask(id: string): Promise<boolean> {
    try {
      await this.cancelVideoJob(this.legacyJob(id));
      return true;
    } catch {
      return false;
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

  // ── Helpers ───────────────────────────────────────────────────────────

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderError({
        kind: "auth",
        provider: this.id,
        message: "Runway API key not configured. Set RUNWAY_API_SECRET environment variable.",
      });
    }
    return this.apiKey;
  }

  private headers(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": RunwayProvider.API_VERSION };
  }

  private invalid(message: string): ProviderError {
    return new ProviderError({ kind: "invalid-request", provider: this.id, message });
  }

  private legacyJob(id: string): VideoJob {
    return { provider: this.id, id, model: DEFAULT_MODEL, submittedAt: new Date(0).toISOString() };
  }

  private toVideoResult(id: string, state: VideoJobState): VideoResult {
    return {
      id,
      status: state.status,
      progress: state.progress,
      videoUrl: state.videoUrl,
      ...(state.error ? { error: state.error.message } : {}),
    };
  }

  private legacyMessage(error: unknown): string {
    return isProviderError(error) || error instanceof Error ? error.message : "Unknown error";
  }

  /**
   * Clamp duration to valid range for the given model
   */
  private clampDuration(duration: number | undefined, model: RunwayModel): number {
    if (model === "gen4.5") {
      // gen4.5 supports 2-10 seconds (integer)
      const d = duration ?? 5;
      return Math.max(2, Math.min(10, Math.round(d)));
    }
    // gen4_turbo supports 5 or 10
    return duration === 10 ? 10 : 5;
  }

  private async blobToDataUri(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = blob.type || "image/png";
    return `data:${mimeType};base64,${base64}`;
  }
}

export const runwayProvider = new RunwayProvider();
