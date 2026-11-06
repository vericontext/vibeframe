/**
 * The cost of a video generation no provider reported: Seedance from its
 * token formula, every other provider at the command's tier upper bound.
 */

import { estimateSeedanceVideoCostUsd, resolveSeedanceVariant } from "@vibeframe/ai-providers";
import { lookupCostEstimateUpperBound } from "../output.js";

/**
 * Cost figure for a REAL (non-dry-run) generation envelope.
 *
 * Seedance has a token-accurate estimator; every other provider reports the
 * command's tier upper bound with a warning naming it an estimate. Without
 * this the success envelope defaulted to costUsd 0, which an agent budget
 * loop reads as "free" - the hybrid-brew dogfood run billed Runway twice
 * while reporting $0.
 */
export function realRunCost(provider: string, options: {
  duration?: string;
  resolution?: string;
  ratio?: string;
  seedanceModel?: string;
  refVideos?: string[];
}): { costUsd: number; warnings: string[] } {
  if (provider === "seedance") {
    const variant = resolveSeedanceVariant(options.seedanceModel);
    return {
      costUsd: estimateSeedanceVideoCostUsd({
        durationSec: Number(options.duration) || 5,
        resolution: options.resolution,
        aspectRatio: options.ratio,
        fast: variant === "seedance-2.0-fast",
        v25: variant === "seedance-2.5",
        hasVideoReference: Boolean(options.refVideos),
      }),
      warnings: [],
    };
  }
  return {
    costUsd: lookupCostEstimateUpperBound("generate video") ?? 5,
    warnings: [
      `costUsd is the tier upper bound for ${provider} - actual provider billing is typically lower and is not metered here.`,
    ],
  };
}
