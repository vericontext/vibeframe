/**
 * Model shutdown checks for commands that call a dated model.
 *
 * The catalog records each model's announced shutdown date. Commands check
 * it before any dry run or paid request: a retiring model adds a warning to
 * the dry run, the result, and stderr; a retired model is a usage error that
 * names the replacement. Providers enforce the same rule on their own, so
 * executors that skip this check still never call a retired model.
 */

import { findModel, modelLifecycle, type ModelSpec } from "@vibeframe/ai-providers";
import { exitWithError, usageError } from "../commands/output.js";

/** Model flags `generate video` reads, keyed by provider. */
export interface VideoModelFlags {
  seedanceModel?: string;
  grokModel?: string;
  klingModel?: string;
  runwayModel?: string;
}

const VIDEO_MODEL_FLAG: Record<string, keyof VideoModelFlags> = {
  seedance: "seedanceModel",
  grok: "grokModel",
  kling: "klingModel",
  runway: "runwayModel",
};

/** The model flag value given for a video provider (`klingModel` for kling), if any. */
export function videoModelFlag(provider: string, flags: VideoModelFlags): string | undefined {
  const flag = VIDEO_MODEL_FLAG[provider];
  return flag ? flags[flag] : undefined;
}

/** The catalog model a video provider will call, given the command's model flags. */
export function videoModelSpec(provider: string, flags: VideoModelFlags): ModelSpec | undefined {
  return findModel(provider, "video", videoModelFlag(provider, flags));
}

/**
 * Exit with a usage error for a retired model; return the shutdown warning
 * for a retiring one, for the caller's envelope and `printWarnings()`.
 */
export function checkModelLifecycle(spec: ModelSpec | undefined, now: Date = new Date()): string[] {
  if (!spec) return [];
  const lifecycle = modelLifecycle(spec, now);
  if (lifecycle.state === "retired") exitWithError(usageError(lifecycle.message));
  return lifecycle.state === "retiring" ? [lifecycle.message] : [];
}

/**
 * The shutdown warning for a retiring model, without exiting. For executors
 * that run inside the MCP server or a pipeline: a retired model is refused by
 * the provider itself (ModelRetiredError), so only the warning is needed here.
 */
export function retiringModelWarnings(spec: ModelSpec | undefined, now: Date = new Date()): string[] {
  if (!spec) return [];
  const lifecycle = modelLifecycle(spec, now);
  return lifecycle.state === "retiring" ? [lifecycle.message] : [];
}
