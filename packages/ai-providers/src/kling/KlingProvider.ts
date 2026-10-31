import { createHmac } from "node:crypto";
import type { AIProvider, AICapability, ProviderConfig } from "../interface/types.js";
import { durationProblem, findModel, modelAliases, type ModelSpec } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest, VideoUsage } from "../video/contract.js";
import { ProviderError, classifyProviderError, isProviderError, type ProviderErrorKind } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { recordUsage } from "../usage/meter.js";
import { resolveVideoModel } from "../video/models.js";

/**
 * Kling video models VibeFrame calls (catalog IDs).
 * - Legacy API (`/v1/videos/*`, `model_name` in the body): `kling-v3`
 *   (default, 3-15 s), `kling-v2-6` and `kling-v2-5-turbo` (5 or 10 s).
 * - New API (model in the path, polled through `/tasks`, API key only):
 *   `kling-4.0` (3-30 s) and `kling-3.0-turbo` (3-15 s).
 *
 * `kling-v3-omni` is not accepted: it only runs on the omni-video endpoint,
 * which VibeFrame does not call yet.
 */
export type KlingModel = "kling-v3" | "kling-4.0" | "kling-3.0-turbo" | "kling-v2-6" | "kling-v2-5-turbo";

/**
 * Resolve a `--kling-model` alias: `v3` (default), `4.0`, `3.0-turbo`,
 * `v2.6`, or `v2.5-turbo`. Full model IDs pass through. Unknown aliases throw.
 */
export function resolveKlingModel(alias?: string): KlingModel {
  const model = findModel("kling", "video", alias);
  if (model) return model.id as KlingModel;
  throw new Error(`Unknown Kling model "${alias}". Valid: ${modelAliases("kling", "video").join(", ")}.`);
}

/**
 * The legacy API's duration string for a requested length: clamped into a
 * model's range (v3: 3-15 s), or the nearest allowed value at or below it
 * for models with fixed lengths (v2.x: 5 or 10). Default 5 s.
 */
export function klingDuration(model: KlingModel, seconds?: number): string {
  const requested = typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds) : 5;
  const allowed = findModel("kling", "video", model)?.durationSec ?? [5, 10];
  if ("min" in allowed) return String(Math.max(allowed.min, Math.min(allowed.max, requested)));
  const atOrBelow = allowed.filter((d) => d <= requested);
  return String(atOrBelow.length > 0 ? Math.max(...atOrBelow) : Math.min(...allowed));
}

/** Every Kling response: a service code (0 = success), a message, and the payload. */
interface KlingEnvelope<T> {
  code: number;
  message?: string;
  request_id?: string;
  data: T;
}

/** Legacy task (`/v1/videos/{type}`). */
interface KlingLegacyTask {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  task_result?: { videos?: Array<{ id: string; url: string; duration: string }> };
}

/** New-API task (`POST /{task}/{model}` returns one; `GET /tasks` a list). */
interface KlingTask {
  id: string;
  status: "submitted" | "processing" | "succeeded" | "failed";
  message?: string;
  outputs?: Array<{ type: string; id?: string; url?: string; watermark_url?: string; duration?: string }>;
}

type KlingTaskType = "text2video" | "image2video" | "video-extend" | "text-to-video" | "image-to-video";

const LEGACY_STATUS: Record<KlingLegacyTask["task_status"], VideoJobState["status"]> = {
  submitted: "pending",
  processing: "processing",
  succeed: "completed",
  failed: "failed",
};

const STATUS: Record<KlingTask["status"], VideoJobState["status"]> = {
  submitted: "pending",
  processing: "processing",
  succeeded: "completed",
  failed: "failed",
};

/** Aspect ratios the new text-to-video endpoints share (4.0 also takes 21:9, which VideoRequest has no value for). */
const MODEL_PATH_RATIOS = new Set(["16:9", "9:16", "1:1"]);

/** New-API models whose image-to-video takes a last frame (3.0 Turbo takes the first frame only). */
const LAST_FRAME_MODELS = new Set(["kling-4.0"]);

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

/** A submission, worked out and validated before any request. */
interface KlingPlan {
  spec: ModelSpec;
  api: "legacy" | "model-path";
  path: string;
  type: KlingTaskType;
  body: Record<string, unknown>;
  usage: VideoUsage;
}

/**
 * Kling AI video generation over both of Kling's API generations: the
 * legacy `/v1/videos/*` endpoints for v3, v2.6, v2.5 Turbo, and video
 * extension, and the new model-in-the-path endpoints for Kling 4.0 and 3.0
 * Turbo. The catalog's `api` field picks the generation per model; auth,
 * HTTP, error classification, and usage metering are shared.
 *
 * Image input must be a URL; the CLI uploads local frames first.
 */
export class KlingProvider implements AIProvider, VideoGenerator {
  id = "kling";
  name = "Kling AI";
  description = "AI video generation with Kling v3 and Kling 4.0";
  capabilities: AICapability[] = ["text-to-video", "image-to-video", "video-extend"];
  iconUrl = "/icons/kling.svg";
  isAvailable = true;
  /** VibeFrame sends Kling image URLs only (both APIs also take raw Base64, which is not wired up). */
  readonly imageInput = "url" as const;

  private apiKey?: string;
  private accessKey?: string;
  private secretKey?: string;
  /** API host for servers outside China; both API generations live here (docs, probe 2026-10-04). */
  private baseUrl = "https://api-singapore.klingai.com";

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
      this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    }
  }

  isConfigured(): boolean {
    return !!(this.apiKey || (this.accessKey && this.secretKey));
  }

  // ── VideoGenerator ────────────────────────────────────────────────────

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    if (request.from?.kind === "edit") {
      throw new ProviderError({ kind: "unsupported", provider: this.id, message: "Kling cannot edit an earlier video; it can extend one." });
    }
    if (request.from) return this.submitExtend(request);

    const plan = this.plan(request);
    // Kling takes image URLs here; the CLI uploads local frames first.
    for (const image of [request.image, request.lastFrame]) {
      if (image && !/^https?:\/\//.test(image)) {
        throw this.invalid("Kling needs an image URL for image-to-video, not base64. Upload the image first.");
      }
    }
    const token = plan.api === "model-path" ? this.apiKeyToken(plan.spec) : this.token();
    const id =
      plan.api === "model-path"
        ? (await this.send<KlingTask>(plan.path, plan.body, token)).id
        : (await this.send<KlingLegacyTask>(plan.path, plan.body, token)).task_id;
    // Accepted work is billed by its requested length and resolution.
    recordUsage(plan.usage);
    return {
      provider: this.id,
      id,
      model: plan.spec.id,
      submittedAt: new Date().toISOString(),
      meta: plan.api === "model-path" ? { type: plan.type, api: "model-path" } : { type: plan.type },
    };
  }

  usageFor(request: VideoRequest): VideoUsage {
    if (request.from) {
      throw new ProviderError({ kind: "unsupported", provider: this.id, message: "Kling does not meter video extensions." });
    }
    return this.plan(request).usage;
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    if (job.meta?.api === "model-path" || findModel(this.id, "video", job.model)?.api === "model-path") {
      return this.getTask(job);
    }
    const type = job.meta?.type as KlingTaskType | undefined;
    if (!type) {
      // A bare task ID (typed in by a user) does not say which endpoint
      // created it; Kling answers "not found" on the wrong one.
      try {
        return await this.getVideoJob({ ...job, meta: { ...job.meta, type: "text2video" } });
      } catch (error) {
        if (!(isProviderError(error) && error.kind === "not-found")) throw error;
      }
      try {
        return await this.getVideoJob({ ...job, meta: { ...job.meta, type: "image2video" } });
      } catch (error) {
        // Not a legacy task either: a new-API task, readable with an API key.
        if (!(isProviderError(error) && error.kind === "not-found" && this.apiKey)) throw error;
        return this.getTask(job);
      }
    }
    const response = await providerRequest(this.id, `${this.baseUrl}/v1/videos/${type}/${job.id}`, {
      headers: this.headers(this.token()),
    }, this.requestOptions());
    const data = this.unwrap((await response.json()) as KlingEnvelope<KlingLegacyTask>);
    const state: VideoJobState = { status: LEGACY_STATUS[data.task_status] ?? "pending" };
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

  // ── Planning ──────────────────────────────────────────────────────────

  /** Resolve the model and build the request for its API generation; throws before any request. */
  private plan(request: VideoRequest): KlingPlan {
    const spec = resolveVideoModel(this.id, request.model);
    const resolution = this.resolution(spec, request);
    return spec.api === "model-path" ? this.planModelPath(spec, request, resolution) : this.planLegacy(spec, request, resolution);
  }

  /** `--resolution` when given (it must be one the model renders), else `mode` (`std` 720p, `pro` 1080p), else 720p. */
  private resolution(spec: ModelSpec, request: VideoRequest): string {
    const raw = request.resolution?.trim().toLowerCase();
    if (raw) {
      const resolution = /^\d+$/.test(raw) ? `${raw}p` : raw;
      if (spec.resolutions && !spec.resolutions.includes(resolution)) {
        throw this.invalid(`${spec.label} renders ${spec.resolutions.join(" or ")}, not ${request.resolution}.`);
      }
      return resolution;
    }
    const mode = request.providerOptions?.mode;
    if (mode === undefined || mode === "std") return "720p";
    if (mode === "pro") return "1080p";
    throw this.invalid(`Kling mode is std (720p) or pro (1080p), not "${String(mode)}".`);
  }

  private planLegacy(spec: ModelSpec, request: VideoRequest, resolution: string): KlingPlan {
    const model = spec.id as KlingModel;
    const duration = klingDuration(model, request.durationSec);
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      model_name: model,
      mode: resolution === "1080p" ? "pro" : "std",
      aspect_ratio: request.aspectRatio === "9:16" || request.aspectRatio === "1:1" ? request.aspectRatio : "16:9",
      duration,
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (typeof request.providerOptions?.cfg === "number") body.cfg_scale = request.providerOptions.cfg;
    if (request.image) body.image = request.image;
    const type: KlingTaskType = request.image ? "image2video" : "text2video";
    return { spec, api: "legacy", path: `/v1/videos/${type}`, type, body, usage: this.usage(spec, Number(duration), resolution) };
  }

  /**
   * Kling 4.0 and 3.0 Turbo: text-to-video takes a flat `prompt` and
   * `settings`; image-to-video takes typed `contents` items and follows the
   * first frame's aspect ratio. Neither has a negative prompt, seed, or
   * audio switch, so requests asking for one are refused, not trimmed.
   */
  private planModelPath(spec: ModelSpec, request: VideoRequest, resolution: string): KlingPlan {
    const label = `${spec.label} (${spec.id})`;
    if (request.negativePrompt) {
      throw this.invalid(`${label} has no negative prompt; describe what to avoid in the prompt itself.`);
    }
    if (request.seed !== undefined) throw this.invalid(`${label} does not take a seed.`);
    if (request.references?.length) throw this.invalid(`${label} reference inputs are not supported by VibeFrame yet; use a first frame (-i).`);
    if (request.generateAudio === false) {
      throw this.invalid(`${label} always generates native audio; describe the sound you want (or silence) in the prompt.`);
    }
    if (request.lastFrame && !request.image) throw this.invalid(`${label} needs a first frame with a last frame.`);
    if (request.lastFrame && !LAST_FRAME_MODELS.has(spec.id)) throw this.invalid(`${label} takes a first frame only, not a last frame.`);

    const seconds = request.durationSec ?? 5;
    const problem = durationProblem(spec, seconds);
    if (problem) throw this.invalid(problem);
    const duration = Math.round(seconds);

    let body: Record<string, unknown>;
    let type: KlingTaskType;
    if (request.image) {
      type = "image-to-video";
      const contents: Array<Record<string, string>> = [];
      if (request.prompt) contents.push({ type: "prompt", text: request.prompt });
      contents.push({ type: "first_frame", url: request.image });
      if (request.lastFrame) contents.push({ type: "last_frame", url: request.lastFrame });
      body = { contents, settings: { resolution, duration } };
    } else {
      type = "text-to-video";
      const aspectRatio = request.aspectRatio ?? "16:9";
      if (!MODEL_PATH_RATIOS.has(aspectRatio)) {
        throw this.invalid(`${label} renders 16:9, 9:16, or 1:1, not ${aspectRatio}.`);
      }
      body = { prompt: request.prompt, settings: { resolution, aspect_ratio: aspectRatio, duration } };
    }
    return { spec, api: "model-path", path: `/${type}/${spec.id}`, type, body, usage: this.usage(spec, duration, resolution) };
  }

  private usage(spec: ModelSpec, seconds: number, resolution: string): VideoUsage {
    return { provider: this.id, kind: "video", model: spec.id, amount: { unit: "seconds", count: seconds }, size: resolution };
  }

  // ── New API ───────────────────────────────────────────────────────────

  /** Read a new-API task through `GET /tasks?task_ids=`. */
  private async getTask(job: VideoJob): Promise<VideoJobState> {
    const spec = findModel(this.id, "video", job.model);
    const token = this.apiKeyToken(spec);
    const response = await providerRequest(this.id, `${this.baseUrl}/tasks?task_ids=${encodeURIComponent(job.id)}`, {
      headers: this.headers(token),
    }, this.requestOptions());
    const tasks = this.unwrap((await response.json()) as KlingEnvelope<KlingTask[]>);
    const task = tasks?.find((t) => t.id === job.id);
    if (!task) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: `Kling has no task ${job.id}.` });
    }
    const state: VideoJobState = { status: STATUS[task.status] ?? "pending" };
    const video = task.outputs?.find((o) => o.type === "video" && o.url);
    if (task.status === "succeeded") {
      if (video?.url) {
        state.videoUrl = video.url;
        if (video.id) state.outputId = video.id;
        if (video.duration !== undefined) state.durationSec = parseFloat(video.duration);
      } else {
        state.status = "failed";
        state.error = new ProviderError({ kind: "provider", provider: this.id, message: `Kling task ${job.id} succeeded without a video.` }).toJSON();
      }
    }
    if (task.status === "failed") {
      state.error = classifyProviderError({ provider: this.id, message: task.message || "Generation failed" }).toJSON();
    }
    return state;
  }

  // ── Legacy video extension ────────────────────────────────────────────

  /** Extend a finished legacy Kling video (`POST /v1/videos/video-extend` with its `video_id`). */
  private async submitExtend(request: VideoRequest): Promise<VideoJob> {
    const source = request.from!.job;
    if (source.provider !== this.id) {
      throw this.invalid(`Kling can only extend a Kling video, not a ${source.provider} job.`);
    }
    if (source.meta?.api === "model-path" || findModel(this.id, "video", source.model)?.api === "model-path") {
      throw new ProviderError({
        kind: "unsupported",
        provider: this.id,
        message: `Kling extends videos from its legacy models (v3, v2.6, v2.5 Turbo) only, not ${source.model}.`,
      });
    }
    const token = this.token();
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
    const taskId = (await this.send<KlingLegacyTask>("/v1/videos/video-extend", body, token)).task_id;
    return { provider: this.id, id: taskId, model: source.model, submittedAt: new Date().toISOString(), meta: { type: "video-extend" } };
  }

  // ── Auth and HTTP ─────────────────────────────────────────────────────

  /** A Bearer token for the legacy API: the API key, or a JWT signed from the access/secret pair. */
  private token(): string {
    if (this.apiKey) return this.apiKey;
    if (this.accessKey && this.secretKey) return this.generateToken();
    throw new ProviderError({
      kind: "auth",
      provider: this.id,
      message: "Kling API credentials not configured. Set KLING_API_KEY to your Kling API key (or the legacy ACCESS_KEY:SECRET_KEY pair).",
    });
  }

  /** The API key, for the new API: it answers an access/secret JWT with 401 code 1002 (docs, probe). */
  private apiKeyToken(spec: ModelSpec | undefined): string {
    if (this.apiKey) return this.apiKey;
    const model = spec ? `${spec.label} (${spec.id})` : "This Kling task";
    throw new ProviderError({
      kind: "auth",
      provider: this.id,
      message: this.accessKey
        ? `${model} runs on Kling's new API, which accepts only an API key, but KLING_API_KEY holds a legacy ACCESS_KEY:SECRET_KEY pair. Create an API key in the Kling console and set KLING_API_KEY to it, or use a legacy model (v3, v2.6, v2.5-turbo).`
        : "Kling API credentials not configured. Set KLING_API_KEY to your Kling API key.",
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

  /** POST a task and return its `data`. */
  private async send<T>(path: string, body: Record<string, unknown>, token: string): Promise<T> {
    const response = await providerRequest(this.id, `${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(token),
      body: JSON.stringify(body),
    }, this.requestOptions());
    return this.unwrap((await response.json()) as KlingEnvelope<T>);
  }

  /** A 200 response can still carry a non-zero service code. */
  private unwrap<T>(response: KlingEnvelope<T>): T {
    if (response.code === 0) return response.data;
    const kind = klingErrorKind(response.code);
    const message = `${response.message || "Kling API error"} (code ${response.code})`;
    throw kind
      ? new ProviderError({ kind, provider: this.id, code: String(response.code), message })
      : classifyProviderError({ provider: this.id, code: String(response.code), message });
  }

  private invalid(message: string): ProviderError {
    return new ProviderError({ kind: "invalid-request", provider: this.id, message });
  }
}

export const klingProvider = new KlingProvider();
