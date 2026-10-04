/**
 * @module ai-video
 * @description Video generation, status, cancel, and extension on the video
 * job contract. Powers the manifest tools `generate_video`,
 * `generate_video_cancel`, `generate_video_extend`, and job refreshes in
 * `vibe status`; every provider goes through `VideoGenerator`, so nothing
 * here branches on provider names.
 *
 * @see MODELS.md for AI model configuration
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  isProviderError,
  waitForVideoJob,
  type MediaReference,
  type ProviderErrorKind,
  type VideoGenerator,
  type VideoJob,
  type VideoJobState,
  type VideoRequest,
} from "@vibeframe/ai-providers";
import { resolveProvider } from "../utils/provider-resolver.js";
import { videoModelSpec } from "../utils/model-lifecycle.js";
import {
  canonicalVideoProvider,
  fileToUrlOrDataUri,
  jobFromTaskId,
  openVideoGenerator,
  videoImageInput,
} from "./_shared/video-jobs.js";

/** How long a waiting call polls before handing back the job to check later. */
const WAIT_TIMEOUT_MS = 15 * 60_000;

/** Write a downloaded video to `output` (relative to cwd), creating its directory. */
async function saveOutput(output: string, bytes: Uint8Array): Promise<string> {
  const outputPath = resolve(process.cwd(), output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return outputPath;
}

/** A failed result from a thrown error, keeping the provider error kind. */
function failure(error: unknown, prefix: string): { success: false; error: string; errorKind?: ProviderErrorKind } {
  if (isProviderError(error)) return { success: false, error: error.message, errorKind: error.kind };
  return { success: false, error: `${prefix}: ${error instanceof Error ? error.message : String(error)}` };
}

/** Wait for a job (or read it once), then download the video when asked. */
async function settle(
  generator: VideoGenerator,
  job: VideoJob,
  opts: { wait: boolean; output?: string; onProgress?: (state: VideoJobState) => void }
): Promise<{ state: VideoJobState; outputPath?: string }> {
  const state = opts.wait
    ? await waitForVideoJob(generator, job, { timeoutMs: WAIT_TIMEOUT_MS, onProgress: opts.onProgress })
    : await generator.getVideoJob(job);
  const outputPath =
    opts.output && state.status === "completed"
      ? await saveOutput(opts.output, await generator.downloadVideo(job, state))
      : undefined;
  return { state, outputPath };
}

// ============================================================================
// Video Generation
// ============================================================================

export interface VideoGenerateOptions {
  prompt: string;
  /** Default: the configured or first available video provider. */
  provider?: "grok" | "runway" | "kling" | "veo" | "seedance" | "fal" | "omni";
  image?: string;
  /** Ending frame for providers that interpolate between two frames. */
  endImage?: string;
  refImages?: string[];
  refVideos?: string[];
  refAudio?: string[];
  duration?: number;
  ratio?: string;
  seed?: number;
  mode?: string;
  negative?: string;
  resolution?: string;
  veoModel?: string;
  runwayModel?: string;
  seedanceModel?: string;
  grokModel?: string;
  klingModel?: string;
  generateAudio?: boolean;
  output?: string;
  wait?: boolean;
  apiKey?: string;
  /**
   * Called as soon as the provider accepts the job, before waiting, so the
   * caller can record it: a crash or timeout mid-wait then leaves a job that
   * can still be polled and downloaded.
   */
  onSubmitted?: (job: VideoJob) => void | Promise<void>;
  /** Called after every poll while waiting. */
  onProgress?: (state: VideoJobState) => void;
  /** Veo only: `allow_all` or `allow_adult`. */
  personGeneration?: string;
}

export interface VideoGenerateResult {
  success: boolean;
  taskId?: string;
  /** The provider job handle; store it to poll, cancel, or extend later. */
  job?: VideoJob;
  status?: string;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  provider?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeVideoGenerate(options: VideoGenerateOptions): Promise<VideoGenerateResult> {
  const provider = canonicalVideoProvider(options.provider ?? resolveProvider("video")?.name ?? "seedance");
  try {
    const generator = await openVideoGenerator(provider, options.apiKey);
    const references: MediaReference[] = [];
    for (const [kind, paths, mime] of [
      ["image", options.refImages, "image/png"],
      ["video", options.refVideos, "video/mp4"],
      ["audio", options.refAudio, "audio/mpeg"],
    ] as const) {
      for (const sourcePath of paths ?? []) {
        references.push({ kind, url: await fileToUrlOrDataUri(sourcePath, mime), sourcePath });
      }
    }
    const request: VideoRequest = {
      prompt: options.prompt,
      model: videoModelSpec(provider, options)?.id,
      durationSec: options.duration ?? 5,
      aspectRatio: (options.ratio ?? "16:9") as VideoRequest["aspectRatio"],
      resolution: options.resolution,
      image: options.image ? await videoImageInput(generator, options.image) : undefined,
      lastFrame: options.endImage ? await videoImageInput(generator, options.endImage) : undefined,
      references: references.length > 0 ? references : undefined,
      negativePrompt: options.negative,
      seed: options.seed,
      generateAudio: options.generateAudio,
      providerOptions:
        options.mode || options.personGeneration
          ? { ...(options.mode ? { mode: options.mode } : {}), ...(options.personGeneration ? { personGeneration: options.personGeneration } : {}) }
          : undefined,
    };

    const job = await generator.submitVideo(request);
    await options.onSubmitted?.(job);
    if (options.wait === false) {
      return { success: true, taskId: job.id, job, status: "processing", provider };
    }
    let settled: Awaited<ReturnType<typeof settle>>;
    try {
      settled = await settle(generator, job, { wait: true, output: options.output, onProgress: options.onProgress });
    } catch (error) {
      // Running out of wait time is not a failure: the job may still finish.
      if (isProviderError(error) && error.kind === "timeout") {
        return { success: true, taskId: job.id, job, status: "processing", provider };
      }
      throw error;
    }
    const { state, outputPath } = settled;
    if (state.status !== "completed") {
      return {
        success: false,
        taskId: job.id,
        job,
        provider,
        status: state.status,
        error: state.error?.message ?? `${provider} generation ${state.status}`,
        errorKind: state.error?.kind,
      };
    }
    return {
      success: true,
      taskId: job.id,
      job,
      status: "completed",
      videoUrl: state.videoUrl,
      duration: state.durationSec,
      outputPath,
      provider,
    };
  } catch (error) {
    return { ...failure(error, "Video generation failed"), provider };
  }
}

// ============================================================================
// Video Status
// ============================================================================

export interface VideoStatusOptions {
  taskId: string;
  provider?: string;
  /** The stored job handle; preferred over `taskId` + `taskType`. */
  job?: VideoJob;
  /** Kling task type, for a bare task ID. */
  taskType?: "text2video" | "image2video";
  wait?: boolean;
  output?: string;
  apiKey?: string;
}

export interface VideoStatusResult {
  success: boolean;
  taskId?: string;
  status?: string;
  progress?: number;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeVideoStatus(options: VideoStatusOptions): Promise<VideoStatusResult> {
  const job =
    options.job ?? jobFromTaskId(options.provider ?? "runway", options.taskId, { taskType: options.taskType });
  try {
    const generator = await openVideoGenerator(job.provider, options.apiKey);
    const { state, outputPath } = await settle(generator, job, { wait: options.wait ?? false, output: options.output });
    return {
      success: true,
      taskId: job.id,
      status: state.status,
      progress: state.progress,
      videoUrl: state.videoUrl,
      duration: state.durationSec,
      outputPath,
      error: state.error?.message,
      errorKind: state.error?.kind,
    };
  } catch (error) {
    return failure(error, "Status check failed");
  }
}

// ============================================================================
// Video Cancel
// ============================================================================

export interface VideoCancelOptions {
  taskId: string;
  /** Default: runway. */
  provider?: string;
  job?: VideoJob;
  apiKey?: string;
}

export interface VideoCancelResult {
  success: boolean;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeVideoCancel(options: VideoCancelOptions): Promise<VideoCancelResult> {
  const job = options.job ?? jobFromTaskId(options.provider ?? "runway", options.taskId);
  try {
    const generator = await openVideoGenerator(job.provider, options.apiKey);
    if (!generator.cancelVideoJob) {
      return { success: false, error: `${job.provider} has no cancel API.`, errorKind: "unsupported" };
    }
    await generator.cancelVideoJob(job);
    return { success: true };
  } catch (error) {
    return failure(error, "Cancel failed");
  }
}

// ============================================================================
// Video Extend
// ============================================================================

export interface VideoExtendOptions {
  /** The task ID of the video to extend (Veo: its operation name). */
  videoId: string;
  /** Default: kling. */
  provider?: string;
  job?: VideoJob;
  prompt?: string;
  duration?: number;
  negative?: string;
  veoModel?: string;
  output?: string;
  wait?: boolean;
  apiKey?: string;
}

export interface VideoExtendResult {
  success: boolean;
  taskId?: string;
  job?: VideoJob;
  status?: string;
  videoUrl?: string;
  duration?: number;
  outputPath?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeVideoExtend(options: VideoExtendOptions): Promise<VideoExtendResult> {
  const source = options.job ?? jobFromTaskId(options.provider ?? "kling", options.videoId);
  try {
    const generator = await openVideoGenerator(source.provider, options.apiKey);
    const job = await generator.submitVideo({
      prompt: options.prompt ?? "",
      model: source.provider === "veo" ? videoModelSpec("veo", { veoModel: options.veoModel ?? "3.1" })?.id : undefined,
      durationSec: options.duration,
      negativePrompt: options.negative,
      from: { job: source, kind: "extend" },
    });
    if (options.wait === false) return { success: true, taskId: job.id, job, status: "processing" };
    const { state, outputPath } = await settle(generator, job, { wait: true, output: options.output });
    if (state.status !== "completed") {
      return {
        success: false,
        taskId: job.id,
        job,
        status: state.status,
        error: state.error?.message ?? `${source.provider} extension ${state.status}`,
        errorKind: state.error?.kind,
      };
    }
    return {
      success: true,
      taskId: job.id,
      job,
      status: "completed",
      videoUrl: state.videoUrl,
      duration: state.durationSec,
      outputPath,
    };
  } catch (error) {
    return failure(error, "Video extension failed");
  }
}
