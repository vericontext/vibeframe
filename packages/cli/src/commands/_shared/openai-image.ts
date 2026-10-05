/**
 * @module _shared/openai-image
 *
 * OpenAI image model alias resolution, used by image cost estimates.
 * Generation itself goes through the image contract (`executeImageGenerate`).
 */

import { defaultModel, findModel } from "@vibeframe/ai-providers";
import type { GPTImageModel } from "@vibeframe/ai-providers";

/**
 * Resolve the user-supplied model alias to the API id + display label, from
 * the model catalog. Unknown or empty aliases resolve to the default model.
 * Exported so unit tests can assert label↔model parity (regression cover for
 * v0.52.0 bug).
 */
export function resolveOpenAIImageModel(modelAlias?: string): {
  openaiModel: GPTImageModel;
  modelLabel: string;
} {
  const model = findModel("openai", "image", modelAlias) ?? defaultModel("openai", "image");
  return { openaiModel: model.id as GPTImageModel, modelLabel: model.label };
}
