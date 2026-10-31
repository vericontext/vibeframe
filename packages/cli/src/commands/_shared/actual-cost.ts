/**
 * Actual cost of a command: what its provider calls consumed (the usage
 * meter in `@vibeframe/ai-providers`) times the model catalog's list price.
 *
 * One place turns metered usage into the `costUsd` the JSON envelope, the
 * MCP tool results, and the YAML pipeline budget report. When a call cannot
 * be priced (the catalog lists no price for the model, or the amount was
 * inferred), the figure is the larger of the priced part and the command's
 * COST_ESTIMATES upper bound, flagged `estimated` with a warning naming why.
 * Never zero for a paid call that happened.
 */

import { priceUsage, takeUsageSince, type UsageRecord } from "@vibeframe/ai-providers";

export interface ActualCost {
  costUsd: number;
  /** True when `costUsd` is not consumption times a listed price. */
  estimated: boolean;
  warnings: string[];
}

/** Round to a millionth of a dollar, the resolution of per-token prices. */
export function roundUsd(usd: number): number {
  return Number(usd.toFixed(6));
}

function describe(record: UsageRecord): string {
  return `${record.provider} ${record.model}`;
}

/**
 * Price metered usage. `upperBound` is the command's COST_ESTIMATES maximum
 * (`lookupCostEstimateUpperBound`), used when a call cannot be priced.
 */
export function costOfUsage(usage: readonly UsageRecord[], upperBound: number, now: Date = new Date()): ActualCost {
  if (usage.length === 0) return { costUsd: 0, estimated: false, warnings: [] };
  const priced = priceUsage(usage, now);
  if (priced.unpriced.length > 0) {
    const names = [...new Set(priced.unpriced.map(describe))].join(", ");
    return {
      costUsd: roundUsd(Math.max(priced.costUsd, upperBound)),
      estimated: true,
      warnings: [
        `costUsd is an upper-bound estimate: the model catalog has no list price for ${names}.`,
      ],
    };
  }
  if (priced.estimated) {
    const names = [...new Set(usage.filter((r) => r.estimated).map(describe))].join(", ");
    return {
      costUsd: roundUsd(priced.costUsd),
      estimated: true,
      warnings: [`costUsd is an estimate: the provider did not report how much ${names} billed, so it was inferred.`],
    };
  }
  return { costUsd: roundUsd(priced.costUsd), estimated: false, warnings: [] };
}

/** The cost of everything metered since `startedAt` (a command's start time). */
export function actualCostSince(startedAt: number, upperBound: number): ActualCost {
  return costOfUsage(takeUsageSince(startedAt), upperBound);
}

/**
 * Cost of paid calls nothing meters or prices (video generation outside
 * Seedance): the command's COST_ESTIMATES upper bound per call, flagged as
 * an estimate. Zero calls cost nothing.
 */
export function upperBoundCost(perCallUsd: number, calls: number, provider: string): ActualCost {
  if (calls <= 0) return { costUsd: 0, estimated: false, warnings: [] };
  return {
    costUsd: roundUsd(perCallUsd * calls),
    estimated: true,
    warnings: [
      `costUsd is the tier upper bound for ${provider} - actual provider billing is typically lower and is not metered here.`,
    ],
  };
}
