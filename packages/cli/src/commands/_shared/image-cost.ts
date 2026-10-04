/**
 * Per-image cost estimates for `vibe generate image`.
 *
 * Without these, real runs reported `costUsd: 0`, which reads as "free" to
 * agents that gate spend on the JSON envelope. Values are upper bounds from
 * provider list prices (checked 2026-10-04, see
 * `.agents/references/providers/`), not metered billing:
 * - OpenAI: high quality at 1024x1024 (we default to medium).
 * - Gemini: 1K output, Nano Banana Pro at 1K-2K.
 * - Grok: grok-imagine-image-2.0 at its 2K medium price.
 */

import { resolveGrokImageModel } from "@vibeframe/ai-providers";
import { lookupCostEstimateUpperBound } from "../output.js";
import { resolveOpenAIImageModel } from "./openai-image.js";

const OPENAI_HIGH_1024_USD: Record<string, number> = {
  "gpt-image-2.5-sunburst": 0.211,
  "gpt-image-2.5-flare": 0.211,
  "gpt-image-2": 0.211,
  "gpt-image-1.5": 0.133,
};

const GEMINI_USD: Record<string, number> = {
  flash: 0.067,
  "3.1-flash": 0.067,
  latest: 0.067,
  lite: 0.034,
  pro: 0.134,
};

const GROK_USD = { "grok-imagine-image": 0.02, "grok-imagine-image-2.0": 0.08 } as const;

export function estimateImageCostUsd(
  provider: string,
  model: string | undefined,
  count: number
): { costUsd: number; warnings: string[] } {
  const images = Math.max(1, count);
  let perImage: number | undefined;
  if (provider === "openai") {
    perImage = OPENAI_HIGH_1024_USD[resolveOpenAIImageModel(model).openaiModel];
  } else if (provider === "gemini") {
    perImage = GEMINI_USD[model ?? "flash"] ?? GEMINI_USD.flash;
  } else if (provider === "grok") {
    perImage = GROK_USD[resolveGrokImageModel(model).model];
  }

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
