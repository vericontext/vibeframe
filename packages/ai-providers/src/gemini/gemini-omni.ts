/**
 * @module gemini/gemini-omni
 *
 * Google Gemini Omni 1.1 Flash (`gemini-omni-1.1-flash`) text- and
 * image-to-video, plus multi-turn edits and extensions. GA since 2026-08-27
 * and Google's named replacement for the Veo 3.1 previews that shut down on
 * 2026-10-22.
 *
 * Omni runs on the Interactions API (`/v1beta/interactions`) with the same
 * `GOOGLE_API_KEY`. Request shape per https://ai.google.dev/gemini-api/docs/omni:
 * `input` is a string or typed items (`{type:"image", data, mime_type}`
 * frames, then `{type:"text", text}`), and `response_format` is
 * `{type:"video", aspect_ratio, resolution, delivery}`.
 *
 * We submit with `background: true` and poll `GET /interactions/{id}`. The
 * background docs only list text models, but Omni accepts it, and the
 * completed interaction's `steps[]` carries the video `uri` (probe,
 * 2026-10-04). The `uri` points at a Files API entry that must reach ACTIVE
 * before it downloads, with the key as a header, never in the URL.
 *
 * Edits and extensions chain with `previous_interaction_id`, so an Omni job
 * handle is also its session handle. Omni picks the clip length itself
 * (3-10 s); there is no duration field.
 */

import type { GenerateOptions, VideoResult } from "../interface/types.js";
import type { ProviderConfig } from "../interface/index.js";
import { defaultModel } from "../catalog/catalog.js";
import type { VideoGenerator, VideoJob, VideoJobState, VideoRequest } from "../video/contract.js";
import { ProviderError, classifyProviderError, isProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveVideoModel } from "../video/models.js";
import { waitForVideoJob } from "../video/wait.js";

export const OMNI_MODEL = defaultModel("omni", "video").id;
const API_ROOT = "https://generativelanguage.googleapis.com";

/** Output resolutions Omni accepts; 1080p and 4k are upscaled from 720p. */
export type OmniResolution = "360p" | "720p" | "1080p" | "4k";
const RESOLUTIONS: readonly string[] = ["360p", "720p", "1080p", "4k"];

interface InteractionContent {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
}

interface InteractionResponse {
  id?: string;
  status?: "in_progress" | "requires_action" | "completed" | "failed" | "cancelled" | string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  output_video?: InteractionContent;
  error?: { code?: number | string; message?: string; status?: string };
}

const STATUS: Record<string, VideoJobState["status"]> = {
  in_progress: "processing",
  requires_action: "processing",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

/** The generated video item from a REST interaction response. */
export function findOmniVideo(response: InteractionResponse): InteractionContent | undefined {
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    const video = step.content?.find((c) => c.type === "video");
    if (video) return video;
  }
  return response.output_video;
}

/** `https://.../v1beta/files/abc:download?alt=media` or `files/abc` → `abc`. */
function fileIdFromUri(uri: string): string | undefined {
  return uri.match(/files\/([^/?:]+)/)?.[1];
}

/** A data URI or bare base64 string as an inline image item. */
function inlineImage(ref: string): { type: "image"; data: string; mime_type: string } {
  const m = ref.match(/^data:(.+?);base64,(.*)$/s);
  return m ? { type: "image", mime_type: m[1], data: m[2] } : { type: "image", mime_type: "image/png", data: ref };
}

export class OmniProvider implements VideoGenerator {
  id = "omni";
  label = "Gemini Omni 1.1 Flash";
  private apiKey?: string;
  private pollingInterval = 5000;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── VideoGenerator ────────────────────────────────────────────────────

  async submitVideo(request: VideoRequest): Promise<VideoJob> {
    const apiKey = this.requireKey();
    const model = resolveVideoModel(this.id, request.model).id;
    const from = request.from;
    if (from && from.job.provider !== this.id) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.id,
        message: `Omni can only continue an Omni video, not a ${from.job.provider} job.`,
      });
    }
    if (request.image?.startsWith("http")) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.id,
        message: "Omni takes frames inline; pass the image as a data URI, not a URL.",
      });
    }

    const text = from?.kind === "extend" ? `Extend this video from its last frame. ${request.prompt}` : request.prompt;
    const frames = request.image ? [inlineImage(request.image), ...(request.lastFrame ? [inlineImage(request.lastFrame)] : [])] : [];
    const body: Record<string, unknown> = {
      model,
      input: frames.length === 0 ? text : [...frames, { type: "text", text }],
      background: true,
      response_format: {
        type: "video",
        aspect_ratio: request.aspectRatio === "9:16" ? "9:16" : "16:9",
        resolution: RESOLUTIONS.includes(request.resolution ?? "") ? request.resolution : "720p",
        delivery: "uri",
      },
    };
    if (from) body.previous_interaction_id = from.job.id;

    const response = await providerRequest(this.id, `${API_ROOT}/v1beta/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const created = (await response.json()) as InteractionResponse;
    if (!created.id) {
      throw new ProviderError({ kind: "provider", provider: this.id, message: "Omni accepted the request without an interaction ID." });
    }
    return { provider: this.id, id: created.id, model, submittedAt: new Date().toISOString() };
  }

  async getVideoJob(job: VideoJob): Promise<VideoJobState> {
    const apiKey = this.requireKey();
    const response = await providerRequest(this.id, `${API_ROOT}/v1beta/interactions/${job.id}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    const interaction = (await response.json()) as InteractionResponse;
    const status = STATUS[interaction.status ?? ""] ?? "processing";

    if (status === "failed") {
      const error = interaction.error;
      return {
        status,
        error: classifyProviderError({
          provider: this.id,
          code: error?.status ?? (error?.code !== undefined ? String(error.code) : undefined),
          message: error?.message ?? "Omni generation failed",
        }).toJSON(),
      };
    }
    if (status !== "completed") return { status };

    const video = findOmniVideo(interaction);
    const fileId = video?.uri ? fileIdFromUri(video.uri) : undefined;
    if (!fileId) {
      // Omni's safety filter can finish an interaction with no video.
      return {
        status: "failed",
        error: new ProviderError({
          kind: "moderation",
          provider: this.id,
          message: "Omni finished without a video; the prompt or frame may have been filtered.",
        }).toJSON(),
      };
    }

    // The interaction is done, but the file may still be processing.
    const file = await providerRequest(this.id, `${API_ROOT}/v1beta/files/${fileId}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    const fileState = ((await file.json()) as { state?: string }).state;
    if (fileState === "PROCESSING") return { status: "processing", progress: 95 };
    if (fileState !== "ACTIVE") {
      return {
        status: "failed",
        error: new ProviderError({ kind: "provider", provider: this.id, message: `Omni video file ended in state ${fileState}.` }).toJSON(),
      };
    }
    return { status: "completed", progress: 100, videoUrl: `${API_ROOT}/download/v1beta/files/${fileId}:download?alt=media` };
  }

  /** Background interactions cancel with `POST /interactions/{id}/cancel`. */
  async cancelVideoJob(job: VideoJob): Promise<void> {
    const apiKey = this.requireKey();
    await providerRequest(this.id, `${API_ROOT}/v1beta/interactions/${job.id}/cancel`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey },
    });
  }

  /** The Files API download needs the key as a header. */
  async downloadVideo(_job: VideoJob, state: VideoJobState): Promise<Uint8Array> {
    if (!state.videoUrl) {
      throw new ProviderError({ kind: "not-found", provider: this.id, message: "Omni job has no video to download." });
    }
    const response = await providerRequest(this.id, state.videoUrl, { headers: { "x-goog-api-key": this.requireKey() } });
    return new Uint8Array(await response.arrayBuffer());
  }

  // ── Older interface, kept until every caller uses the contract ────────

  /** Submit and wait for the finished video, as the CLI expects today. */
  async generateVideo(prompt: string, options?: GenerateOptions): Promise<VideoResult> {
    let job: VideoJob | undefined;
    try {
      const frame = options?.referenceImages?.[0]?.base64
        ? `data:${options.referenceImages[0].mimeType};base64,${options.referenceImages[0].base64}`
        : typeof options?.referenceImage === "string" && options.referenceImage
          ? options.referenceImage
          : undefined;
      job = await this.submitVideo({
        prompt,
        aspectRatio: options?.aspectRatio,
        resolution: options?.resolution,
        image: frame,
        lastFrame: frame ? options?.lastFrame : undefined,
      });
      const state = await waitForVideoJob(this, job, { intervalMs: this.pollingInterval, timeoutMs: 15 * 60_000 });
      return {
        id: job.id,
        status: state.status,
        videoUrl: state.videoUrl,
        ...(state.error ? { error: state.error.message } : {}),
      };
    } catch (error) {
      return { id: job?.id ?? "", status: "failed", error: isProviderError(error) || error instanceof Error ? error.message : String(error) };
    }
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.id, message: "GOOGLE_API_KEY not configured for Gemini Omni" });
    }
    return this.apiKey;
  }
}

export const omniProvider = new OmniProvider();
