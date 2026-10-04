/**
 * The video job contract every video provider implements.
 *
 * Provider APIs differ (fal queues, Runway tasks, Kling task types, Gemini
 * interactions), but each generation is the same four steps: submit a
 * request, read the job's state, optionally cancel it, and download the
 * result. A `VideoJob` is a plain, serializable handle, so a job submitted
 * in one process can be polled, resumed, or cancelled from another (a build
 * that crashed mid-wait, `vibe status`, an agent's next turn).
 */

import type { GenerationStatus, MediaReference } from "../interface/types.js";
import type { ProviderErrorInfo } from "../shared/errors.js";

/** What to generate. Providers reject fields they cannot honour instead of silently dropping them. */
export interface VideoRequest {
  prompt: string;
  /** Catalog model ID or alias; the provider's default when omitted. */
  model?: string;
  durationSec?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
  resolution?: string;
  /** First frame: an https URL or a data URI. */
  image?: string;
  /** Last frame, for providers that interpolate between two frames. */
  lastFrame?: string;
  /** Labeled multimodal references (Seedance @Image1, @Video1, ...). */
  references?: MediaReference[];
  negativePrompt?: string;
  seed?: number;
  generateAudio?: boolean;
  /**
   * Continue an earlier job instead of starting fresh: `extend` adds time
   * after its last frame, `edit` revises it (a multi-turn session such as
   * Gemini Omni). Providers without the capability throw `unsupported`.
   */
  from?: { job: VideoJob; kind: "extend" | "edit" };
  /** Provider-specific settings with no shared meaning (Kling `mode`). */
  providerOptions?: Record<string, unknown>;
}

/** A submitted generation. Plain data: safe to store and hand to another process. */
export interface VideoJob {
  /** Provider registry id, e.g. "runway". */
  provider: string;
  /** The provider's job, task, or operation ID. */
  id: string;
  /** The model ID the job runs on. */
  model: string;
  /** ISO timestamp of submission. */
  submittedAt: string;
  /** Whatever else the provider needs to poll or continue the job (Kling task type, fal endpoint). */
  meta?: Record<string, string>;
}

/** A job's state at one moment. Terminal states are `completed`, `failed`, and `cancelled`. */
export interface VideoJobState {
  status: GenerationStatus;
  /** 0-100, when the provider reports it. */
  progress?: number;
  /** Where to download the result; set once `completed`. */
  videoUrl?: string;
  /** The provider's ID for the finished video when it differs from the job ID (Kling `video_id`); continuations use it. */
  outputId?: string;
  durationSec?: number;
  /** Why the job failed; set when `failed`. */
  error?: ProviderErrorInfo;
}

export interface VideoGenerator {
  /** Provider registry id; matches `VideoJob.provider`. */
  readonly id: string;
  /** Start a generation. Throws `ProviderError` when the provider refuses it. */
  submitVideo(request: VideoRequest): Promise<VideoJob>;
  /** Read a job's current state. Throws `ProviderError` only when the state cannot be read. */
  getVideoJob(job: VideoJob): Promise<VideoJobState>;
  /** Stop a queued or running job. Absent when the provider has no cancel API. */
  cancelVideoJob?(job: VideoJob): Promise<void>;
  /** Fetch a completed job's video bytes (some providers need auth to download). */
  downloadVideo(job: VideoJob, state: VideoJobState): Promise<Uint8Array>;
}

export const TERMINAL_STATUSES: ReadonlySet<GenerationStatus> = new Set(["completed", "failed", "cancelled"]);

export function isVideoGenerator(value: unknown): value is VideoGenerator {
  const v = value as Partial<VideoGenerator> | null;
  return typeof v?.submitVideo === "function" && typeof v.getVideoJob === "function";
}
