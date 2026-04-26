/**
 * @module _shared/openai-image
 *
 * Shared OpenAI `generateImage` helper for `vibe ai image` and
 * `vibe generate image`. Both commands had their own near-identical
 * provider initialisation + model-alias parsing + result construction.
 * v0.52.0 added gpt-image-2 wiring to `ai-image.ts` only and
 * `vibe generate image -m 2` silently fell back to gpt-image-1.5 — the
 * duplication guarantees a recurrence next time the OpenAI image flow
 * is touched.
 *
 * Each top-level command keeps its own CLI wiring and output formatting;
 * this helper owns just the API call + label derivation.
 *
 * See issue #58.
 */

import { OpenAIImageProvider } from "@vibeframe/ai-providers";
import type { ImageOptions, ImageResult } from "@vibeframe/ai-providers";

/** Subset of CLI options consumed by the helper. */
export interface OpenAIImageHelperOptions {
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  /** Stringified count from commander; parsed inside the helper. */
  count?: string;
}

export interface OpenAIImageHelperResult {
  result: ImageResult;
  /** Resolved model id passed to the API (`gpt-image-2` or `undefined` for default). */
  openaiModel: "gpt-image-2" | undefined;
  /** Human-friendly label for spinner / success output. */
  modelLabel: "GPT Image 2" | "GPT Image 1.5";
}

/**
 * Resolve the user-supplied model alias to the API id + display label.
 * Exported so unit tests can assert label↔model parity (regression cover
 * for v0.52.0 bug).
 */
export function resolveOpenAIImageModel(modelAlias?: string): {
  openaiModel: "gpt-image-2" | undefined;
  modelLabel: "GPT Image 2" | "GPT Image 1.5";
} {
  const isGptImage2 = modelAlias === "2" || modelAlias === "gpt-image-2";
  return {
    openaiModel: isGptImage2 ? "gpt-image-2" : undefined,
    modelLabel: isGptImage2 ? "GPT Image 2" : "GPT Image 1.5",
  };
}

/**
 * Run an OpenAI image generation. Caller owns: api-key acquisition,
 * spinner lifecycle, output formatting (JSON vs human), and file save.
 */
export async function executeOpenAIImageGenerate(
  prompt: string,
  options: OpenAIImageHelperOptions,
  ctx: { apiKey: string },
): Promise<OpenAIImageHelperResult> {
  const provider = new OpenAIImageProvider();
  await provider.initialize({ apiKey: ctx.apiKey });

  const { openaiModel, modelLabel } = resolveOpenAIImageModel(options.model);

  // commander hands back unconstrained strings for `--size` / `--quality`
  // / `--style`. The provider's `ImageOptions` narrows these to specific
  // unions ("1024x1024" | "1536x1024" | …, etc.). The original duplicated
  // handlers were `any`-typed via commander's loose `OptionValues`, which
  // is why this never tripped before the dedup; the helper makes the
  // shape explicit, so we cast at the single call boundary instead of
  // ANY-laundering through the call sites.
  const result = await provider.generateImage(prompt, {
    model: openaiModel,
    size: options.size as ImageOptions["size"],
    quality: options.quality as ImageOptions["quality"],
    style: options.style as ImageOptions["style"],
    n: options.count !== undefined ? parseInt(options.count, 10) : undefined,
  });

  return { result, openaiModel, modelLabel };
}
