/**
 * Per-image cost estimates for `vibe generate image`, from model catalog prices.
 *
 * Without these, real runs reported `costUsd: 0`, which reads as "free" to
 * agents that gate spend on the JSON envelope. Values are upper bounds from
 * provider list prices (checked 2026-10-04, see
 * `.agents/references/providers/`), not metered billing:
 * - OpenAI: high quality at 1024x1024 (we default to medium).
 * - Gemini: 1K output, Nano Banana Pro at 1K-2K.
 * - Grok: grok-imagine-image-2.0 at its 2K medium price.
 */

import { findModel, resolveGrokImageModel } from "@vibeframe/ai-providers";
import { lookupCostEstimateUpperBound } from "../output.js";
import { resolveOpenAIImageModel } from "./openai-image.js";

/** Catalog list price for the model a provider and alias resolve to. */
function catalogPrice(provider: string, model: string | undefined): number | undefined {
  if (provider === "openai") return findModel("openai", "image", resolveOpenAIImageModel(model).openaiModel)?.price?.usd;
  if (provider === "gemini") return findModel("gemini", "image", model ?? "flash")?.price?.usd ?? findModel("gemini", "image")?.price?.usd;
  if (provider === "grok") return findModel("grok", "image", resolveGrokImageModel(model).model)?.price?.usd;
  return undefined;
}

export function estimateImageCostUsd(
  provider: string,
  model: string | undefined,
  count: number
): { costUsd: number; warnings: string[] } {
  const images = Math.max(1, count);
  const perImage = catalogPrice(provider, model);
  if (perImage === undefined) {
    return {
      costUsd: lookupCostEstimateUpperBound("generate image") ?? 5,
      warnings: [
        `costUsd is the tier upper bound for ${provider} - actual provider billing is typically lower and is not metered here.`,
      ],
    };
  }
  return {
    costUsd: Number((perImage * images).toFixed(3)),
    warnings: [
      `costUsd is an upper-bound estimate from ${provider} list prices for ${images} image(s) - not metered billing.`,
    ],
  };
}
