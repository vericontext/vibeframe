/**
 * Per-image cost estimates for `vibe generate image`, from model catalog prices.
 *
 * Without these, real runs reported `costUsd: 0`, which reads as "free" to
 * agents that gate spend on the JSON envelope. Values are upper bounds from
 * provider list prices (checked 2026-10-17, see
 * `.agents/references/providers/`), not metered billing:
 * - OpenAI: high quality at 1024x1024 (we default to medium), scaled by pixel
 *   count for an explicit `WxH` size, since output tokens grow with it.
 * - Gemini: the requested size's price (1K when none is asked for).
 * - Grok: grok-imagine-image-2.0 at its 2K medium price.
 */

import { findModel, resolveGrokImageModel } from "@vibeframe/ai-providers";
import { lookupCostEstimateUpperBound } from "../output.js";
import { resolveOpenAIImageModel } from "./openai-image.js";

/** Catalog list price for the model a provider and alias resolve to, at the requested size. */
function catalogPrice(provider: string, model: string | undefined, resolution: string | undefined): number | undefined {
  if (provider === "openai") return findModel("openai", "image", resolveOpenAIImageModel(model).openaiModel)?.price?.usd;
  if (provider === "gemini") {
    const price = (findModel("gemini", "image", model) ?? findModel("gemini", "image"))?.price;
    return (resolution && price?.bySize?.[resolution]) || price?.usd;
  }
  if (provider === "grok") return findModel("grok", "image", resolveGrokImageModel(model).model)?.price?.usd;
  return undefined;
}

/** How many 1024x1024 images' worth of pixels an OpenAI `WxH` size is. */
function openAISizeFactor(size: string | undefined): number {
  const match = size?.match(/^(\d+)x(\d+)$/);
  return match ? (Number(match[1]) * Number(match[2])) / (1024 * 1024) : 1;
}

export function estimateImageCostUsd(
  provider: string,
  model: string | undefined,
  count: number,
  resolution?: string,
  size?: string
): { costUsd: number; warnings: string[] } {
  const images = Math.max(1, count);
  const listPrice = catalogPrice(provider, model, resolution);
  const perImage = listPrice !== undefined && provider === "openai" ? listPrice * openAISizeFactor(size) : listPrice;
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
