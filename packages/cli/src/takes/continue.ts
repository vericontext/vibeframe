/**
 * Continuing a take: extend or edit a video take through its provider session.
 *
 * A video take keeps the provider's job handle (`take.session`). Extending
 * adds time after the take's last frame; editing revises it with a new
 * prompt (a follow-up turn on Gemini Omni, an xAI edit on Grok). Either way
 * the result is a new take whose `parent` is the one continued, made for the
 * same beat slot, so `vibe take promote` can put it into the build.
 *
 * Whether a provider can continue a job is the provider's answer
 * (`VideoGenerator.continuations`), asked before any request, so a dry run
 * and a refusal cost nothing.
 */

import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { createVideoGenerator, type VideoContinuation, type VideoJob } from "@vibeframe/ai-providers";

import { executeVideoContinue } from "../commands/ai-video.js";
import { meteredVideoCostUsd } from "../commands/_shared/video-jobs.js";
import { defaultOutputPath } from "../commands/_shared/default-output.js";
import {
  ExitCode,
  costCapError,
  executorFailure,
  lookupCostEstimateUpperBound,
  providerFailure,
  usageError,
  type ExecutorFailure,
} from "../commands/output.js";
import { executeTakeShow } from "./query.js";
import { globalTakeStore, type Take, type TakeVia } from "./take.js";

export interface TakeContinueOptions {
  takeId: string;
  continuation: VideoContinuation;
  /** The directory the call runs from; relative paths and the take lookup start here. */
  cwd: string;
  /** Look for the take in this project first. */
  projectDir?: string;
  /** What to change (edit, required) or how to carry on (extend, optional). */
  prompt?: string;
  /** Seconds to add, for an extension. The provider's default when omitted. */
  duration?: number;
  negative?: string;
  /** Where to write the result. Default: next to the take's output, as `<name>-extended.mp4` or `<name>-edited.mp4`. */
  output?: string;
  /** Wait for the job (default). False returns once the provider accepted it. */
  wait?: boolean;
  dryRun?: boolean;
  /** Refuse, before any request, when the estimate is above this. */
  maxCostUsd?: number;
  apiKey?: string;
  via: TakeVia;
  command: string;
}

export interface TakeContinueEstimate {
  usd: number;
  /** `estimate` when priced from what the provider will meter; `upper-bound` when it does not say ahead of time. */
  basis: "estimate" | "upper-bound";
}

export interface TakeContinueResult {
  success: true;
  dryRun: boolean;
  continuation: VideoContinuation;
  /** The take continued; the new take names it as its parent. */
  parentTakeId: string;
  provider: string;
  /** The provider job the continuation starts from. */
  source: VideoJob;
  prompt: string;
  /** Where the result is written (absolute). */
  output: string;
  estimate: TakeContinueEstimate;
  /** The new take, once the provider accepted the continuation. */
  takeId?: string;
  takeError?: string;
  status?: string;
  taskId?: string;
  job?: VideoJob;
  outputPath?: string;
  duration?: number;
  /** The provider reported the continuation's charge, which was metered. */
  metered?: boolean;
}

const PAST: Record<VideoContinuation, string> = { extend: "extended", edit: "edited" };

/** Where a take's first output is on disk, if it has one. */
function parentOutput(take: Take, storeProject: string | undefined): string | undefined {
  const output = take.outputs[0];
  if (!output) return undefined;
  return isAbsolute(output.path) || !storeProject ? resolve(output.path) : join(storeProject, output.path);
}

/** The default result path: beside the parent's output, else in `cwd`. Never overwrites. */
function defaultOutput(take: Take, storeProject: string | undefined, continuation: VideoContinuation, cwd: string): string {
  const parent = parentOutput(take, storeProject);
  const suffix = PAST[continuation];
  if (!parent) return resolve(cwd, defaultOutputPath(`video-${suffix}.mp4`, 1, cwd));
  const dir = dirname(parent);
  const stem = basename(parent, extname(parent));
  return resolve(dir, defaultOutputPath(`${stem}-${suffix}.mp4`, 1, dir));
}

async function estimateCost(provider: string, options: TakeContinueOptions, source: VideoJob): Promise<TakeContinueEstimate> {
  try {
    const usd = await meteredVideoCostUsd(provider, {
      prompt: options.prompt ?? "",
      durationSec: options.duration,
      from: { job: source, kind: options.continuation },
    });
    if (usd !== undefined) return { usd, basis: "estimate" };
  } catch {
    // A provider that cannot price the continuation ahead of time falls back to the tier bound.
  }
  return { usd: lookupCostEstimateUpperBound(`take ${options.continuation}`), basis: "upper-bound" };
}

export async function executeTakeContinue(options: TakeContinueOptions): Promise<TakeContinueResult | ExecutorFailure> {
  const verb = options.continuation;
  const found = await executeTakeShow(options.takeId, { cwd: options.cwd, projectDir: options.projectDir });
  if (!found) {
    return executorFailure({
      success: false,
      error: `Take not found: ${options.takeId}`,
      code: "NOT_FOUND",
      exitCode: ExitCode.NOT_FOUND,
      suggestion: "Run 'vibe take list --kind video' to see the video takes here.",
      retryable: false,
    });
  }
  const { take } = found;
  // A project store is `<project>/.vibeframe/takes`; a global take has absolute paths.
  const storeProject = found.store === globalTakeStore().dir ? undefined : dirname(dirname(found.store));

  if (take.kind !== "video") {
    return executorFailure(usageError(`Take ${take.id} is ${take.kind === "image" ? "an image" : `an ${take.kind}`} take; only a video take can be ${PAST[verb]}.`));
  }
  const source = take.session;
  if (!source) {
    return executorFailure(usageError(`Take ${take.id} has no provider session to continue.`, `Generate the video again; a take made through a provider job can be ${PAST[verb]}.`));
  }
  if (take.status === "failed") {
    return executorFailure(usageError(`Take ${take.id} failed, so it has no video to ${verb}.`, "Continue a completed take."));
  }
  const can = (await createVideoGenerator(source.provider, "")).continuations(source);
  if (!can.includes(verb)) {
    const message =
      can.length > 0
        ? `${source.provider} can ${can.join(" or ")} this video (${source.model}), not ${verb} it.`
        : `${source.provider} cannot extend or edit this video (${source.model}).`;
    return executorFailure(usageError(message, "See the provider table in docs/take-graph.md."));
  }
  const prompt = options.prompt?.trim() ?? "";
  if (verb === "edit" && !prompt) {
    return executorFailure(usageError("An edit needs a prompt saying what to change.", "Pass --prompt \"<the change>\"."));
  }
  if (options.duration !== undefined && !(Number.isFinite(options.duration) && options.duration > 0)) {
    return executorFailure(usageError(`Invalid duration: ${options.duration}.`, "Pass the seconds to add as a positive number."));
  }

  const output = options.output ? resolve(options.cwd, options.output) : defaultOutput(take, storeProject, verb, options.cwd);
  const estimate = await estimateCost(source.provider, options, source);
  const plan: TakeContinueResult = {
    success: true,
    dryRun: options.dryRun === true,
    continuation: verb,
    parentTakeId: take.id,
    provider: source.provider,
    source,
    prompt,
    output,
    estimate,
  };
  if (options.maxCostUsd !== undefined && estimate.usd > options.maxCostUsd) {
    return executorFailure({
      ...costCapError({
        estimatedCostUsd: estimate.usd,
        maxCostUsd: options.maxCostUsd,
        retryWith: [`vibe take ${verb} ${take.id} --max-cost ${estimate.usd} --json`],
        data: { continuation: verb, parentTakeId: take.id, provider: source.provider, source, prompt, output, estimate },
      }),
      suggestion: `Raise --max-cost to $${estimate.usd} or more to allow this ${verb}.`,
    });
  }
  if (options.dryRun) return plan;

  const result = await executeVideoContinue({
    continuation: verb,
    videoId: source.id,
    job: source,
    prompt,
    duration: options.duration,
    negative: options.negative,
    output,
    wait: options.wait,
    apiKey: options.apiKey,
    take: {
      via: options.via,
      command: options.command,
      // The new take lives beside its parent.
      cwd: storeProject ?? options.cwd,
      parent: take.id,
      ...(take.origin.beatId ? { beatId: take.origin.beatId } : {}),
      ...(take.origin.asset ? { asset: take.origin.asset } : {}),
    },
  });
  if (!result.success) {
    const task = result.taskId ? ` (${source.provider} task ${result.taskId})` : "";
    const failure = providerFailure(`${result.error ?? `Video ${verb} failed`}${task}`, result.errorKind);
    return executorFailure({ ...failure, data: { ...(failure.data ?? {}), ...(result.takeId ? { takeId: result.takeId } : {}), parentTakeId: take.id } });
  }
  return {
    ...plan,
    ...(result.takeId ? { takeId: result.takeId } : {}),
    ...(result.takeError ? { takeError: result.takeError } : {}),
    status: result.status,
    taskId: result.taskId,
    job: result.job,
    outputPath: result.outputPath,
    duration: result.duration,
    metered: result.metered,
  };
}
