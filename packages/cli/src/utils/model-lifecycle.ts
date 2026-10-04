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
  veoModel?: string;
  runwayModel?: string;
}

const VIDEO_MODEL_FLAG: Record<string, keyof VideoModelFlags> = {
  seedance: "seedanceModel",
  grok: "grokModel",
  kling: "klingModel",
  veo: "veoModel",
  runway: "runwayModel",
};

/** The catalog model a video provider will call, given the command's model flags. */
export function videoModelSpec(provider: string, flags: VideoModelFlags): ModelSpec | undefined {
  const catalogProvider = provider === "fal" ? "seedance" : provider;
  const flag = VIDEO_MODEL_FLAG[catalogProvider];
  return findModel(catalogProvider, "video", flag ? flags[flag] : undefined);
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
