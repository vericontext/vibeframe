/**
 * Price metered usage against the model catalog: consumption times list
 * price, in the unit the catalog prices the model in.
 */

import { listModels, type ModelPrice, type ModelSpec } from "../catalog/catalog.js";
import type { UsageRecord } from "./meter.js";

const SECONDS_PER: Partial<Record<ModelPrice["per"], number>> = { second: 1, minute: 60, hour: 3600 };

export interface UsageCost {
  /** Sum of every priced record, rounded to 6 decimals. */
  costUsd: number;
  /** Records the catalog has no price for (unknown model, no listed price, unit mismatch). */
  unpriced: UsageRecord[];
  /** True when any priced record's amount was itself inferred. */
  estimated: boolean;
}

/** The catalog entry for a served model ID (aliases included), when known. */
function catalogEntry(record: UsageRecord): ModelSpec | undefined {
  if (record.kind === "audio-isolation") return undefined;
  return listModels({ provider: record.provider, kind: record.kind }).find(
    (m) => m.id === record.model || m.aliases?.includes(record.model.toLowerCase()),
  );
}

/** The `usd`/`outputUsd` pair in effect on `now`, honouring a dated price change. */
function ratesOn(price: ModelPrice, now: Date): { usd: number; outputUsd?: number } {
  if (price.until && price.then && now.toISOString().slice(0, 10) > price.until) return price.then;
  return { usd: price.usd, outputUsd: price.outputUsd };
}

/**
 * The per-unit rate for a record that names its output size: that size's
 * `bySize` price, or undefined when the catalog lists sizes but not this one
 * (so the call is reported unpriced instead of at the wrong rate).
 */
function sizedRate(price: ModelPrice, size: string | undefined, fallback: number): number | undefined {
  if (size === undefined || !price.bySize) return fallback;
  return price.bySize[size];
}

/** USD for one record, or undefined when the catalog cannot price it. */
export function priceRecord(record: UsageRecord, now: Date = new Date()): number | undefined {
  const price = catalogEntry(record)?.price;
  if (!price) return undefined;
  const rates = ratesOn(price, now);
  const { amount } = record;
  switch (amount.unit) {
    case "tokens": {
      if (price.per !== "1M input tokens") return undefined;
      let { usd, outputUsd } = rates;
      const tier = price.longContext;
      if (tier && amount.input > tier.aboveInputTokens) {
        if (tier.usd === undefined) return undefined;
        usd = tier.usd;
        outputUsd = tier.outputUsd;
      }
      if (amount.output > 0 && outputUsd === undefined) return undefined;
      return (amount.input * usd + amount.output * (outputUsd ?? 0)) / 1_000_000;
    }
    case "characters":
      return price.per === "1K characters" ? (amount.count / 1000) * rates.usd : undefined;
    case "seconds": {
      const seconds = SECONDS_PER[price.per];
      const usd = sizedRate(price, record.size, rates.usd);
      return seconds && usd !== undefined ? (amount.count / seconds) * usd : undefined;
    }
    case "requests": {
      const usd = sizedRate(price, record.size, rates.usd);
      return price.per === "image" && usd !== undefined ? amount.count * usd : undefined;
    }
  }
}

/** Price every record; the ones the catalog cannot price come back in `unpriced`. */
export function priceUsage(records: readonly UsageRecord[], now: Date = new Date()): UsageCost {
  let total = 0;
  let estimated = false;
  const unpriced: UsageRecord[] = [];
  for (const record of records) {
    const usd = priceRecord(record, now);
    if (usd === undefined) {
      unpriced.push(record);
      continue;
    }
    total += usd;
    if (record.estimated) estimated = true;
  }
  return { costUsd: Number(total.toFixed(6)), unpriced, estimated };
}
